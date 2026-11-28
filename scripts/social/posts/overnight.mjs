// overnight: The Tour series over two days with a night at a bivouac. Day 1 is drawn along the way
// to the hut on the snow map, with the app's sun and shade for the time you were at each point;
// at the hut the camera turns while the night goes by (the evening light, the dark, the first
// light); day 2 goes on from the hut; the end has both days' numbers. A reel (9:16 MP4).
//   --gpx FILE         day 1, ending at the bivouac (required; read here, never copied into the post)
//   --gpx2 FILE        day 2, starting from it (required)
//   --title TEXT       default: "<bivouac> Overnighter"
//   --kind TEXT        default: from day 1's <type>, else Hike
//   --hut-kind KIND    wood or metal: how the hut is drawn, default as the app draws it
//   --trim M           metres cut from the start of day 1 and the end of day 2, default 400
//   --seconds S        length of the reel, default 20
// Files without times (planned routes) get them from the usual hiking-time rule:
//   --date YYYY-MM-DD  day 1, default today (day 2 is the day after)
//   --start HH:MM      when day 1 starts, default 08:00; --start2 the same for day 2
// Slow like the sun reel: every frame waits for the app's finer shade. Render --quick first.
// docs/social.md, "The overnight reel".

import { execFileSync } from 'node:child_process';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { QUICK, SITE, TERRAIN, TZ, arg, brand, credit, fly, frame, mapPage, today } from '../core.mjs';
import { RAD, along, at, bearing, climb, dist, kindOf, readGpx, resample, smooth } from '../gpx.mjs';

export const usage = 'overnight --gpx DAY1 --gpx2 DAY2 [--title TEXT] [--kind TEXT] [--hut-kind wood|metal] [--trim M] [--seconds S] [--date YYYY-MM-DD] [--start HH:MM] [--start2 HH:MM]';
export const needs = ['gpx', 'gpx2'];

const MIN = 60_000;
const HOUR = 60 * MIN;
const parts = (ms) => Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(new Date(ms)).map((p) => [p.type, p.value]));
/** The local date in South Tyrol. */
const localDay = (ms) => {
  const p = parts(ms);
  return `${p.year}-${p.month}-${p.day}`;
};
/** A local wall time in South Tyrol, in ms. */
const localMs = (ymd, hm) => {
  const guess = Date.parse(`${ymd}T${hm}:00Z`);
  const p = parts(guess);
  return guess - (Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - guess);
};
const addDays = (ymd, n) => new Date(Date.parse(`${ymd}T12:00:00Z`) + n * 864e5).toISOString().slice(0, 10);
const clock = (ms) => new Date(ms).toLocaleTimeString('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit' });
const dayText = (ms) => new Date(ms).toLocaleDateString('en-GB', { timeZone: TZ, weekday: 'short', day: 'numeric', month: 'short' });
const num = (v) => Math.round(v).toLocaleString('en');
const km = (m) => `${(m / 1000).toFixed(1)} km`;

/**
 * Times for a planned route: the usual hiking-time rule (DIN 33466) for the whole day, 4 km an
 * hour on the flat, 300 m up or 500 m down an hour, the larger plus half the smaller, spread along
 * the way by the same rule per stretch.
 */
function estimateTimes(raw, startMs) {
  const cum = along(raw);
  const effort = [0];
  for (let i = 1; i < raw.length; i++) {
    const h = (cum[i] - cum[i - 1]) / 4000;
    const dz = raw[i][2] - raw[i - 1][2];
    const v = dz > 0 ? dz / 300 : -dz / 500;
    effort.push(effort[i - 1] + Math.max(h, v) + Math.min(h, v) / 2);
  }
  const eles = resample(raw, 10).map((p) => p[2]);
  const [H, V] = [cum.at(-1) / 4000, climb(eles) / 300 + climb(eles.map((e) => -e)) / 500];
  const hours = Math.max(H, V) + Math.min(H, V) / 2;
  return raw.map((p, i) => [p[0], p[1], p[2], startMs + (effort[i] / effort.at(-1)) * hours * HOUR]);
}

async function readDay(file, n) {
  const g = await readGpx(file);
  if (!g.hasEle) throw new Error(`${path.basename(file)} has no heights`);
  let raw = g.raw;
  if (!g.hasTime) {
    const date = n === 1 ? arg('date', today) : addDays(arg('date', today), 1);
    const start = localMs(date, arg(n === 1 ? 'start' : 'start2', '08:00'));
    raw = estimateTimes(raw, start);
    console.log(`day ${n} has no times: ${clock(raw[0][3])} to ${clock(raw.at(-1)[3])} on ${date}, from the hiking-time rule`);
  }
  const cum = along(raw);
  const eles = resample(raw, 10).map((p) => p[2]);
  return {
    ...g, raw, cum, total: cum.at(-1),
    stats: { distanceM: Math.round(cum.at(-1)), ascentM: Math.round(climb(eles)), highestM: Math.round(Math.max(...raw.map((p) => p[2]))) },
  };
}

// The colour of the sky for a sun this high (degrees), for the night band on the profile.
const SKY = [[6, [242, 196, 90]], [0, [224, 138, 74]], [-6, [122, 79, 122]], [-12, [29, 36, 80]], [-90, [18, 24, 56]]];
const skyColor = (alt) => {
  const k = SKY.findIndex(([a]) => alt >= a);
  if (k <= 0) return `rgb(${SKY[0][1]})`;
  const [[a0, c0], [a1, c1]] = [SKY[k - 1], SKY[k]];
  const f = (alt - a1) / (a0 - a1);
  return `rgb(${c1.map((c, j) => Math.round(c + (c0[j] - c) * f))})`;
};

export async function run({ outDir }) {
  const { getPosition, getTimes } = await import('suncalc');
  const d1 = await readDay(arg('gpx'), 1);
  const d2 = await readDay(arg('gpx2'), 2);

  // The lines that are shown, a point every 10 m with its height and time: the start of day 1 and
  // the end of day 2 cut (docs/social.md, Tours); nothing is cut at the hut.
  const trimM = Math.min(Number(arg('trim', 400)), d1.total / 6, d2.total / 6);
  const STEP = 10;
  const P1 = resample(d1.raw.filter((_, i) => d1.cum[i] >= trimM), STEP);
  const P2 = resample(d2.raw.filter((_, i) => d2.cum[i] <= d2.total - trimM), STEP);
  const [L1, L2] = [along(P1).at(-1), along(P2).at(-1)];
  const L = L1 + L2;
  const gap = dist(P1.at(-1), P2[0]);
  if (gap > 500) console.log(`day 2 starts ${Math.round(gap)} m from where day 1 ends`);

  // The hut: the app's bivouac nearest to the end of day 1.
  const { bivouacs } = JSON.parse(await readFile('web/src/data/bivouacs.json', 'utf8'));
  const hut = bivouacs.map((b) => ({ ...b, d: dist([b.lon, b.lat], P1.at(-1)) })).sort((a, b) => a.d - b.d)[0];
  if (!hut || hut.d > 500) throw new Error('Day 1 does not end at a bivouac on the map (none within 500 m)');
  const hutKind = arg('hut-kind', hut.kind);
  const hutEle = hut.ele ?? P1.at(-1)[2];

  // Per day: the camera's calm line, the height without GPS jitter, the time.
  const days = [[P1, L1], [P2, L2]].map(([P, len]) => ({ len, lon: smooth(P, 15, 0), lat: smooth(P, 15, 1), ele: smooth(P, 3, 2), time: P.map((p) => p[3]) }));
  const onDay = (s) => (s <= L1 ? [days[0], s] : [days[1], s - L1]);
  const camAt = (dayN, s) => [at(days[dayN].lon, s, days[dayN].len), at(days[dayN].lat, s, days[dayN].len)];
  const eleAt = (s) => {
    const [d, x] = onDay(s);
    return at(d.ele, x, d.len);
  };

  // The frames: day 1, the night, day 2, then a hold on the numbers. The night gets about a
  // quarter of the moving time; the days share the rest by their length.
  const FPS = QUICK ? 3 : 30;
  const SECONDS = Number(arg('seconds', 20));
  const HOLD = 3;
  const moving = SECONDS - HOLD;
  const nightS = Math.max(3, moving * 0.24);
  const count = Math.round(FPS * SECONDS);
  const nH = Math.round(FPS * HOLD);
  const nN = Math.round(FPS * nightS);
  const n1 = Math.round(FPS * (moving - nightS) * Math.min(0.7, Math.max(0.3, L1 / L)));
  const n2 = count - nH - nN - n1;
  const phase = (i) => (i < n1 ? 'day1' : i < n1 + nN ? 'night' : i < n1 + nN + n2 ? 'day2' : 'end');
  // Day 1 is already moving at the first frame and glides to a stop at the hut; day 2 sets off from
  // it and glides to a stop at the end.
  const glide = (t) => (t < 0.8 ? 1 : 0.5 + 0.5 * Math.cos((Math.PI * (t - 0.8)) / 0.2));
  const progress = (n, speed) => {
    const p = [0];
    for (let i = 1; i < n; i++) p.push(p[i - 1] + speed(i / (n - 1)));
    return p.map((v) => v / p.at(-1));
  };
  const pr1 = progress(n1, (t) => Math.min(1, 0.55 + (0.45 * t) / 0.15) * glide(t));
  const pr2 = progress(n2, (t) => Math.min(1, 0.1 + (0.9 * t) / 0.2) * glide(t));
  const sAt = Array.from({ length: count }, (_, i) => ({ day1: () => L1 * pr1[i], night: () => L1, day2: () => L1 + L2 * pr2[i - n1 - nN], end: () => L })[phase(i)]());

  // The clock: the time at the dot from the files. At night the evening light and the first light
  // get most of the frames; the dark hours, when the shade does not change, a tenth of their share.
  const [tArrive, tLeave] = [P1.at(-1)[3], P2[0][3]];
  const hutSun = (t) => getPosition(new Date(t), hut.lat, hut.lon).altitude;
  const nightTime = (() => {
    const N = 3000;
    const ts = Array.from({ length: N + 1 }, (_, k) => tArrive + ((tLeave - tArrive) * k) / N);
    const w = [0];
    for (let k = 1; k <= N; k++) w.push(w[k - 1] + (hutSun(ts[k]) > -12 ? 1 : 0.1));
    return (f) => {
      const target = f * w[N];
      let k = 1;
      while (k < N && w[k] < target) k++;
      return ts[k - 1] + (ts[k] - ts[k - 1]) * ((target - w[k - 1]) / (w[k] - w[k - 1] || 1));
    };
  })();
  const nightF = (i) => {
    const f = (i - n1 + 1) / (nN + 1);
    return f - (0.6 * Math.sin(2 * Math.PI * f)) / (2 * Math.PI);
  };
  const tAt = sAt.map((s, i) => {
    const ph = phase(i);
    if (ph === 'night') return nightTime(nightF(i));
    if (ph === 'end') return P2.at(-1)[3];
    const [d, x] = onDay(ph === 'day1' ? Math.min(s, L1) : Math.max(s, L1 + 1e-6));
    return at(d.time, x, d.len);
  });
  const sunset = getTimes(new Date(localMs(localDay(tArrive), '12:00')), hut.lat, hut.lon).sunset;
  const sunrise = getTimes(new Date(localMs(localDay(tLeave), '12:00')), hut.lat, hut.lon).sunrise;

  // The camera: as in the track reel, fixed zoom and tilt, looking along the way over a long
  // stretch; at the hut it turns from the way in to the way on while the night goes by.
  const viewM = Math.max(2000, Math.min(7000, L * 0.3));
  const lat0 = (P1[0][1] + P2.at(-1)[1]) / 2;
  const ZOOM = Math.log2((156543.03 * Math.cos(lat0 * RAD)) / (viewM / 1080));
  const PITCH = 60;
  const look = (dayN, s) => {
    const len = days[dayN].len;
    const D = Math.max(300, Math.min(1500, len * 0.08));
    const c = (x) => Math.max(0, Math.min(len, x));
    return bearing(camAt(dayN, c(s - D)), camAt(dayN, c(s + D)));
  };
  let headings = sAt.map((s, i) => (phase(i) === 'day1' ? look(0, s) : phase(i) === 'night' ? null : look(1, s - L1)));
  for (let i = 1; i < n1; i++) headings[i] -= 360 * Math.round((headings[i] - headings[i - 1]) / 360);
  const h1 = headings[n1 - 1];
  const turnAtHut = ((((headings[n1 + nN] - h1) % 360) + 540) % 360) - 180;
  for (let k = 0; k < nN; k++) {
    const f = (k + 1) / (nN + 1);
    headings[n1 + k] = h1 + turnAtHut * (f - Math.sin(2 * Math.PI * f) / (2 * Math.PI));
  }
  headings[n1 + nN] = h1 + turnAtHut;
  for (let i = n1 + nN + 1; i < count; i++) headings[i] -= 360 * Math.round((headings[i] - headings[i - 1]) / 360);
  const sigma = 0.8 * FPS;
  headings = headings.map((_, i) => {
    let [sum, wsum] = [0, 0];
    for (let m = Math.max(0, i - 3 * sigma); m <= Math.min(count - 1, i + 3 * sigma); m++) {
      const w = Math.exp(-(((m - i) / sigma) ** 2) / 2);
      [sum, wsum] = [sum + w * headings[Math.round(m)], wsum + w];
    }
    return sum / wsum;
  });
  const cameras = sAt.map((s, i) => {
    // In the hold the camera turns a little and eases back, so the dot rises above the numbers.
    const h = phase(i) === 'end' ? (i - (count - nH) + 1) / nH : 0;
    const ease = h - Math.sin(2 * Math.PI * h) / (2 * Math.PI);
    const back = viewM * 0.22 * ease;
    const b = (headings[i] + 22 * ease) * RAD;
    const [lon0, lat0c] = s <= L1 ? camAt(0, s) : camAt(1, s - L1);
    const lat = lat0c - (back * Math.cos(b)) / 111_320;
    const lon = lon0 - (back * Math.sin(b)) / (111_320 * Math.cos(lat0c * RAD));
    return [ZOOM, lat, lon, headings[i] + 22 * ease, PITCH];
  });

  // The snow of day 1 (the day slider), white on the land cover as in the track reel, with the sun.
  const date1 = localDay(tArrive);
  const layers = arg('layers', `snow,sun,basemap,${TERRAIN},labels,bivouacs`);
  const hash = `#map=12/${lat0.toFixed(4)}/${P1[0][0].toFixed(4)}/0/${PITCH}&layers=${layers}&day=${date1}&sun=${new Date(tAt[0]).toISOString().slice(0, 16)}Z`;
  const line = [...P1, ...P2].map((p) => [p[0], p[1]]);
  const gpxText = `<?xml version="1.0"?><gpx version="1.1" xmlns="http://www.topografix.com/GPX/1/1"><trk><trkseg>${[...P1, ...P2].map((p) => `<trkpt lat="${p[1].toFixed(6)}" lon="${p[0].toFixed(6)}"><ele>${p[2].toFixed(1)}</ele></trkpt>`).join('')}</trkseg></trk></gpx>`;
  const fracAt = sAt.map((s) => {
    // The share of the line drawn: the line is the two days joined, its points every 10 m.
    const k = s <= L1 ? (s / L1) * (P1.length - 1) : P1.length + ((s - L1) / L2) * (P2.length - 1);
    return Math.min(1, k / (line.length - 1));
  });

  // The shade of each frame is waited for, as in the sun reel, but by its requests: the shade
  // worker's messages are counted, and a frame is shot once the last shade asked for is drawn
  // (the camera moves on the way, so the finer shade is asked again for a new place too). The
  // app's 8 s watchdog waits a minute for the render, as there.
  await mapPage.addInitScript(() => {
    const st = window.setTimeout;
    window.setTimeout = (fn, ms, ...rest) => st(fn, ms === 8000 ? 60_000 : ms, ...rest);
    const shade = { asked: 0, drawn: 0 };
    window.__shade = shade;
    const Base = window.Worker;
    window.Worker = class extends Base {
      constructor(...a) {
        super(...a);
        this.addEventListener('message', (e) => {
          if (e.data && typeof e.data.id === 'number' && 'coarse' in e.data) shade.drawn = Math.max(shade.drawn, e.data.id);
        });
      }
      postMessage(m, ...rest) {
        if (m && m.type === 'sun') shade.asked = Math.max(shade.asked, m.id);
        return super.postMessage(m, ...rest);
      }
    };
  });
  mapPage.on('console', (m) => {
    if (m.text().startsWith('Shadows:')) throw new Error(`The shade failed in the page: ${m.text()}`);
  });

  let snow = null;
  let hutIcon = null;
  const t0 = Date.now();
  const shots = await fly({
    hash, size: [1080, 1920], cameras, labels: 'local', textScale: 1.5,
    setup: async () => {
      ({ snow, hutIcon } = await mapPage.evaluate(async ({ line, gpxText, hut, hutKind }) => {
        const { map, gpx } = window.__snowmap;
        let along = null;
        try {
          await gpx.load(gpxText, 'track.gpx');
          for (let k = 0; k < 60 && !(along = gpx.snow()); k++) await new Promise((r) => setTimeout(r, 500));
        } catch (e) {
          console.log('snow along the track:', e.message);
        }
        for (const id of ['gpx-casing', 'gpx-line', 'gpx-ends', 'gpx-hit', 'gpx-label']) if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', 'none');
        // The app draws the shade under the snow cells, which would hide it on the snow: here it goes
        // right above them.
        const ids = map.getStyle().layers.map((l) => l.id);
        const top = Math.max(...['snow-white', 'snow-cover', 'snow-depth', 'snow-confidence'].map((id) => ids.indexOf(id)));
        if (top >= 0 && ids[top + 1]) for (const id of ['sun-shadows', 'sun-shadows-detail']) if (map.getLayer(id)) map.moveLayer(id, ids[top + 1]);

        // The line, growing with the flight, as in the track reel.
        const color = '#7048e8';
        map.addSource('reel-track', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
        const below = map.getStyle().layers.find((l) => l.type === 'symbol')?.id;
        const round = { 'line-cap': 'round', 'line-join': 'round' };
        const role = (r) => ['==', ['get', 'role'], r];
        map.addLayer({ id: 'reel-ahead', type: 'line', source: 'reel-track', filter: role('ahead'), layout: round, paint: { 'line-color': color, 'line-width': 3, 'line-opacity': 0.6, 'line-dasharray': [1.2, 1.6] } }, below);
        map.addLayer({ id: 'reel-casing', type: 'line', source: 'reel-track', filter: role('done'), layout: round, paint: { 'line-color': '#ffffff', 'line-width': 8 } }, below);
        map.addLayer({ id: 'reel-line', type: 'line', source: 'reel-track', filter: role('done'), layout: round, paint: { 'line-color': color, 'line-width': 4.5 } }, below);
        map.addLayer({ id: 'reel-head', type: 'circle', source: 'reel-track', filter: role('head'), paint: { 'circle-radius': 8, 'circle-color': color, 'circle-stroke-color': '#ffffff', 'circle-stroke-width': 3, 'circle-pitch-alignment': 'viewport' } });
        window.__trackAt = (f) => {
          const x = f * (line.length - 1);
          const i = Math.min(line.length - 2, Math.floor(x));
          const head = [0, 1].map((j) => line[i][j] + (line[i + 1][j] - line[i][j]) * (x - i));
          const feature = (r, geometry) => ({ type: 'Feature', properties: { role: r }, geometry });
          map.getSource('reel-track').setData({ type: 'FeatureCollection', features: [
            feature('ahead', { type: 'LineString', coordinates: line }),
            feature('done', { type: 'LineString', coordinates: [...line.slice(0, i + 1), head] }),
            feature('head', { type: 'Point', coordinates: head }),
          ] });
        };

        // Only the hut of the night, as the app's icon (not the 3D cabin, a few pixels at this
        // zoom), with its name, on top of everything: it stays lit when the night comes.
        const B = 'bivouacs';
        if (map.getLayer('bivouac-cabins')) map.setLayoutProperty('bivouac-cabins', 'visibility', 'none');
        map.setFilter(B, ['==', ['get', 'name'], hut.name]);
        const layout = {
          visibility: 'visible', 'icon-image': `bivouac-${hutKind}`, 'icon-size': 1.5, 'icon-offset': [0, 0], 'icon-allow-overlap': true,
          'text-field': hut.name, 'text-size': 19, 'text-offset': [0, 0.3], 'text-allow-overlap': true,
        };
        for (const [k, v] of Object.entries(layout)) map.setLayoutProperty(B, k, v);
        for (const [k, v] of Object.entries({ 'icon-opacity': 1, 'text-color': '#4e2c12', 'text-halo-width': 2.2 })) map.setPaintProperty(B, k, v);
        map.moveLayer(B);
        // The same icon for the profile.
        let hutIcon = null;
        const im = map.getImage(`bivouac-${hutKind}`);
        if (im) {
          const c = Object.assign(document.createElement('canvas'), { width: im.data.width, height: im.data.height });
          c.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(im.data.data), im.data.width, im.data.height), 0, 0);
          hutIcon = c.toDataURL('image/png');
        }
        return { hutIcon, snow: along && { date: along.date, sensor: along.sensor, day: along.day, route: along.route, points: along.points } };
      }, { line, gpxText, hut: { name: hut.name }, hutKind }));
      console.log('snow along the track:', JSON.stringify({ ...snow, points: snow?.points.length }));
    },
    // Each frame: the line, the camera, then the date and the minute on the app's own sun controls,
    // as a person would set them, and the shot once the shade for it is drawn.
    before: async (i) => {
      const t = tAt[i];
      const p = parts(t);
      const r = await mapPage.evaluate(
        async ({ f, cam: [zoom, la, lo, bearing, pitch], day, minute, first }) => {
          const map = window.__snowmap.map;
          window.__trackAt(f);
          map.jumpTo({ center: [lo, la], zoom: zoom - 1, bearing, pitch });
          const dateIn = document.getElementById('sun-date');
          const slider = document.getElementById('sun-time');
          slider.step = '0.01';
          if (dateIn.value !== day) {
            dateIn.value = day;
            dateIn.dispatchEvent(new Event('change'));
          }
          slider.value = String(minute);
          slider.dispatchEvent(new Event('input'));
          slider.dispatchEvent(new Event('change'));
          const shade = window.__shade;
          const start = performance.now();
          while (performance.now() - start < (first ? 120_000 : 70_000)) {
            await new Promise((r) => setTimeout(r, 30));
            if (shade.drawn >= shade.asked && (!first || document.body.dataset.shadowMs !== undefined)) break;
          }
          return { ms: Math.round(performance.now() - start), waiting: shade.asked - shade.drawn, label: document.getElementById('sun-label').textContent };
        },
        { f: fracAt[i], cam: cameras[i], day: `${p.year}-${p.month}-${p.day}`, minute: +p.hour * 60 + +p.minute + +p.second / 60, first: i === 0 },
      );
      if (r.waiting > 0) console.log(`frame ${i}: the shade was not drawn in ${r.ms} ms`);
      if (i % 25 === 0) console.log(`frame ${i}/${count} (${phase(i)}, ${r.label}), ${((Date.now() - t0) / 1000).toFixed(0)} s`);
    },
  });
  console.log(`${count} frames in ${((Date.now() - t0) / 1000).toFixed(0)} s`);

  // The overlay. On top the title; at the bottom the day, the clock, the height and the distance
  // (at night the sunset and the sunrise), and one profile over both days with the night between.
  const d1Day = localDay(P1[0][3]);
  const d2Day = localDay(P2.at(-1)[3]);
  const kind = arg('kind', d1.type ? kindOf(d1.type) : 'Hike');
  const title = arg('title', `${hut.name} Overnighter`);
  const [y1, y2] = [d1Day.slice(0, 4), d2Day.slice(0, 4)];
  const dm = (ymd, month = true) => new Date(`${ymd}T12:00:00Z`).toLocaleDateString('en-GB', { timeZone: 'UTC', day: 'numeric', ...(month ? { month: 'short' } : {}) });
  const dates = d1Day.slice(0, 7) === d2Day.slice(0, 7) ? `${dm(d1Day, false)}–${dm(d2Day)} ${y2}` : y1 === y2 ? `${dm(d1Day)} – ${dm(d2Day)} ${y2}` : `${dm(d1Day)} ${y1} – ${dm(d2Day)} ${y2}`;
  const sub = `Two-day ${kind.toLowerCase()}, ${dates}, South Tyrol`;

  const PW = 820;
  const PH = 150;
  const WN = Math.round(PW * 0.13);
  const W1 = ((PW - WN) * L1) / L;
  const xOf = (s) => (s <= L1 ? (s / L1) * W1 : W1 + WN + ((s - L1) / L2) * (PW - WN - W1));
  const allEle = [...days[0].ele, ...days[1].ele];
  const [minE, maxE] = [Math.min(...allEle), Math.max(...allEle)];
  // Room above the line for the hut on the band.
  const TOP = 34;
  const py = (e) => TOP + ((maxE - e) / (maxE - minE || 1)) * (PH - TOP - 8);
  const yHut = py(eleAt(L1));
  const curve = (from, to) => Array.from({ length: 121 }, (_, k) => from + ((to - from) * k) / 120).map((s) => `${xOf(s).toFixed(1)},${py(eleAt(s)).toFixed(1)}`);
  const c1 = curve(0, L1);
  const c2 = curve(L1 + 1e-6, L);
  const area1 = `M0,${PH} L${c1.join(' L')} L${W1.toFixed(1)},${PH} Z`;
  const area2 = `M${(W1 + WN).toFixed(1)},${PH} L${c2.join(' L')} L${PW},${PH} Z`;
  const band = `<rect x="${W1.toFixed(1)}" y="0" width="${WN}" height="${PH}" rx="10"/>`;
  // What the satellite saw along the way; the app's points are evenly spaced over both days.
  const FILL = { snow: '#f4f7fa', bare: '#a8916f', unseen: 'url(#hatch)', null: 'rgba(255,255,255,.2)' };
  const states = snow?.points ?? [];
  const runs = [];
  states.forEach((st, k) => {
    const ds = L / Math.max(1, states.length - 1);
    const s = k * ds;
    const pieces = [[Math.max(0, s - ds / 2), Math.min(L, s + ds / 2)]];
    if (pieces[0][0] < L1 && pieces[0][1] > L1) pieces.splice(0, 1, [pieces[0][0], L1], [L1 + 1e-6, pieces[0][1]]);
    for (const [a, b] of pieces) {
      const [x0, x1] = [xOf(a), xOf(b)];
      const last = runs.at(-1);
      if (last && last.st === String(st) && Math.abs(last.x1 - x0) < 1) last.x1 = x1;
      else runs.push({ st: String(st), x0, x1 });
    }
  });
  const unseenShare = states.length ? states.filter((x) => x === 'unseen').length / states.length : 0;
  // The night band in the colours of the sky at the times the night frames show.
  const bandStops = Array.from({ length: 13 }, (_, k) => {
    const f = k / 12;
    return `<stop offset="${(f * 100).toFixed(1)}%" stop-color="${skyColor(hutSun(nightTime(f)))}"/>`;
  }).join('');
  const dotAt = (i) => {
    const ph = phase(i);
    if (ph === 'night') return [W1 + WN * ((i - n1 + 1) / (nN + 1)), yHut];
    return [xOf(sAt[i]), py(eleAt(sAt[i]))];
  };
  const swatch = (bg) => `<i style="display:inline-block;width:26px;height:14px;border-radius:3px;background:${bg};margin-right:9px"></i>`;
  const route = snow?.route;
  const lowest = route?.lowestSnowM ? num(Math.round(route.lowestSnowM / 10) * 10) : null;
  const profile = (i) => {
    const [x, y] = dotAt(i);
    const iw = 58;
    return `<svg width="${PW}" height="${PH}" viewBox="0 0 ${PW} ${PH}" style="display:block;margin-top:26px;overflow:visible">
      <defs><clipPath id="area"><path d="${area1}"/><path d="${area2}"/></clipPath><clipPath id="band">${band}</clipPath>
        <linearGradient id="night" x1="0" x2="1" y1="0" y2="0">${bandStops}</linearGradient>
        <pattern id="hatch" width="12" height="12" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="12" height="12" fill="rgba(120,132,144,.55)"/><rect width="4" height="12" fill="rgba(255,255,255,.55)"/></pattern></defs>
      <g clip-path="url(#area)">
        ${runs.length ? runs.map((r) => `<rect x="${r.x0.toFixed(1)}" y="0" width="${(r.x1 - r.x0 + 0.6).toFixed(1)}" height="${PH}" fill="${FILL[r.st] ?? FILL.null}"/>`).join('') : `<rect width="${PW}" height="${PH}" fill="${FILL.null}"/>`}
        <rect x="${x.toFixed(1)}" y="0" width="${(PW - x).toFixed(1)}" height="${PH}" fill="rgba(12,22,34,.6)"/>
      </g>
      <g clip-path="url(#band)"><rect x="${W1.toFixed(1)}" y="0" width="${WN}" height="${PH}" fill="url(#night)"/>
        <rect x="${x.toFixed(1)}" y="0" width="${(PW - x).toFixed(1)}" height="${PH}" fill="rgba(12,22,34,.5)"/></g>
      <path d="M${c1.join(' L')}" fill="none" stroke="rgba(255,255,255,.9)" stroke-width="3"/>
      <path d="M${W1.toFixed(1)},${yHut.toFixed(1)} H${(W1 + WN).toFixed(1)}" stroke="rgba(255,255,255,.55)" stroke-width="3" stroke-dasharray="6 7"/>
      <path d="M${c2.join(' L')}" fill="none" stroke="rgba(255,255,255,.9)" stroke-width="3"/>
      ${hutIcon ? `<image href="${hutIcon}" x="${(W1 + WN / 2 - iw / 2).toFixed(1)}" y="${(yHut - iw * 0.875 - 4).toFixed(1)}" width="${iw}" height="${(iw * 0.875).toFixed(1)}"/>` : ''}
      <circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="11" fill="#7048e8" stroke="#fff" stroke-width="4"/></svg>
      ${runs.length ? `<div class="dim" style="display:flex;gap:30px;font-size:23px;margin-top:14px;align-items:center">
        <span>${swatch(FILL.snow)}snow${lowest ? `, from ${lowest} m` : ''}</span><span>${swatch(FILL.bare)}bare</span>
        ${unseenShare >= 0.02 ? `<span><svg width="26" height="14" style="vertical-align:-1px;margin-right:9px"><defs><pattern id="h2" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="8" height="8" fill="rgba(120,132,144,.55)"/><rect width="3" height="8" fill="rgba(255,255,255,.55)"/></pattern></defs><rect width="26" height="14" rx="3" fill="url(#h2)"/></svg>not seen (cloud)</span>` : ''}
      </div>` : ''}`;
  };
  const live = (i) => {
    const ph = phase(i);
    const s = sAt[i];
    const head = ph === 'night' ? `Night at ${hut.name}, ${num(hutEle)} m` : `Day ${ph === 'day1' ? 1 : 2}, ${dayText(tAt[i])}`;
    const stats = ph === 'night'
      ? [['Sunset', clock(sunset)], ['Sunrise', clock(sunrise)]]
      : [['Height', `${num(eleAt(s))} m`], ['Distance', km(ph === 'day1' ? trimM + s : s - L1)]];
    return `<div class="cap" style="font-size:26px;margin-bottom:4px">${head}</div>
      <div style="display:flex;align-items:flex-end;justify-content:space-between;font-variant-numeric:tabular-nums">
        <div class="big" style="font-size:150px">${clock(tAt[i])}</div>
        <div style="display:grid;gap:16px;width:300px;padding-bottom:16px">${stats.map(([k, v]) => `<div><div class="cap" style="font-size:22px;margin-bottom:6px">${k}</div><div class="big" style="font-size:56px;white-space:nowrap">${v}</div></div>`).join('')}</div>
      </div>
      ${profile(i)}`;
  };
  const row = (label, value) => `<div style="display:flex;justify-content:space-between;align-items:baseline;padding:12px 0;border-top:2px solid rgba(255,255,255,.16)">
      <span style="font-size:34px;font-weight:600;color:#fff">${label}</span><b style="font-size:50px;color:#fff;font-weight:700">${value}</b></div>`;
  const snowLine = !route ? null
    : route.snow >= 0.05 && lowest ? `Snow on ${Math.round(route.snow * 100)} % of the way, from ${lowest} m`
      : route.unseen < 0.5 ? 'No snow seen along the way' : null;
  const snowWhen = snow ? `seen from space ${dayText(Date.parse(`${snow.date}T12:00:00Z`))}` : null;
  const dayRow = (n, d) => row(`Day ${n}`, `${km(d.stats.distanceM)}, ${num(d.stats.ascentM)} m up`);
  const end = `<div class="cap" style="font-size:26px;margin-bottom:10px">Two days, one night</div>
      ${dayRow(1, d1)}${dayRow(2, d2)}${row('Highest point', `${num(Math.max(d1.stats.highestM, d2.stats.highestM))} m`)}${row(`Night at ${hut.name}`, `${num(hutEle)} m`)}
      ${snowLine ? `<div class="dim" style="font-size:28px;margin-top:16px">${snowLine}, ${snowWhen}</div>` : ''}
      <div style="margin-top:34px">${brand(1.25)}</div><div class="dim" style="font-size:30px;margin-top:20px">Put your own GPX on the snow</div>`;
  const ovCredit = credit(', snow Copernicus Sentinel-2. Shade for a clear sky, without trees');

  const tmp = path.join(outDir, '.reel');
  await rm(tmp, { recursive: true, force: true });
  await mkdir(tmp);
  const FADE = Math.max(1, Math.round(FPS * 0.35));
  for (let i = 0; i < count; i++) {
    const name = String(i).padStart(4, '0');
    await writeFile(path.join(tmp, `map-${name}.jpg`), Buffer.from(shots[i].split(',')[1], 'base64'));
    const atEnd = phase(i) === 'end';
    const alpha = atEnd ? Math.min(1, (i - (count - nH) + 1) / FADE) : 1;
    await frame(path.join(tmp, `ov-${name}.png`), [1080, 1920], `
      <div class="abs sky" style="height:560px"></div>
      <div class="abs" style="left:80px;right:80px;top:250px">
        <div class="title" style="font-size:80px">${title}</div>
        <div class="sub" style="font-size:34px;margin-top:16px">${sub}</div>
      </div>
      <div class="abs scrim" style="height:${atEnd ? 1120 : 880}px;background:linear-gradient(rgba(12,22,34,0),rgba(12,22,34,.85) 26%,rgba(12,22,34,.94))"></div>
      <div class="abs" style="left:80px;right:180px;bottom:430px;opacity:${alpha}">${atEnd ? end : live(i)}</div>
      <div class="abs dim" style="left:80px;right:180px;bottom:350px;font-size:17px">${ovCredit}</div>`, { transparent: true });
  }
  const reel = path.join(outDir, 'reel-9x16.mp4');
  execFileSync('ffmpeg', [
    '-y', '-loglevel', 'error',
    '-framerate', String(FPS), '-i', path.join(tmp, 'map-%04d.jpg'),
    '-framerate', String(FPS), '-i', path.join(tmp, 'ov-%04d.png'),
    '-filter_complex', `[0:v]fps=30[m];[1:v]fps=30[o];[m][o]overlay=0:0:shortest=1,format=yuv420p[v]`,
    '-map', '[v]', '-c:v', 'libx264', '-preset', 'slow', '-crf', '19', '-movflags', '+faststart', '-r', '30',
    reel,
  ]);
  console.log(`made ${path.relative(process.cwd(), reel)} (${SECONDS} s)`);
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-sseof', '-0.5', '-i', reel, '-frames:v', '1', '-q:v', '3', path.join(outDir, 'reel-end.jpg')]);
  // Contact sheet: day 1, the evening, the dark, the first light, day 2, the end.
  const n30 = (i) => Math.round((i / FPS) * 30);
  const pick = [n30(n1 * 0.5), n30(n1 + nN * 0.2), n30(n1 + nN * 0.5), n30(n1 + nN * 0.8), n30(n1 + nN + n2 * 0.5), 30 * SECONDS - 10];
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', reel, '-vf', `select='${pick.map((n) => `eq(n\\,${n})`).join('+')}',scale=300:-1,tile=6x1`, '-frames:v', '1', '-vsync', 'vfr', path.join(outDir, 'reel-sheet.jpg')]);
  await rm(tmp, { recursive: true, force: true });
  // The numbers in the post, for the caption; no positions.
  await writeFile(path.join(outDir, 'data.json'), `${JSON.stringify({
    site: SITE, title, kind, dates: [d1Day, d2Day], hut: { name: hut.name, ele: hutEle, kind: hutKind },
    day1: { ...d1.stats, start: clock(d1.raw[0][3]), arrive: clock(tArrive) }, day2: { ...d2.stats, leave: clock(tLeave), end: clock(d2.raw.at(-1)[3]) },
    sunset: clock(sunset), sunrise: clock(sunrise), trimM: Math.round(trimM), seconds: SECONDS, snow: snow && { ...snow, points: undefined },
  }, null, 1)}\n`);
}
