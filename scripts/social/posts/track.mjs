// track: The Tour series: a flight along one of our own GPX tracks on the snow of the day it
// was done, the line drawn as the camera goes, with the height and distance on the way
// and the tour's numbers at the end. A reel (9:16 MP4).
//   --gpx FILE         the track (required; read here, never copied into the post)
//   --title TEXT       default: the track's name, "Pennes-Campolasta" as "Pennes to Campolasta"
//   --kind TEXT        default: from the file's <type> (Hike, Ski tour, Trail run, Tour)
//   --date YYYY-MM-DD  default: the day of the first timestamp; the snow is that day's
//   --trim M           metres cut from the start and the end, default 400 (a home, a car)
//   --seconds S        length of the reel, default 14
//   --depth            add the estimated snow depth: a third number with a bar that rises
//                      and falls with the depth at the dot, and a snow cap on the profile
//                      as deep as the snow along the way (into social/posts/<date>-track-depth)

import { execFileSync } from 'node:child_process';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { QUICK, SITE, TERRAIN, TZ, arg, brand, credit, dayOnly, fly, frame, mapPage } from '../core.mjs';

export const usage = 'track --gpx FILE [--title TEXT] [--kind TEXT] [--date YYYY-MM-DD] [--trim M] [--seconds S] [--depth]';
export const needs = ['gpx'];
const DEPTH = process.argv.includes('--depth');
// The depth reel goes into its own folder.
export const variant = () => (DEPTH ? '-depth' : '');

export async function run({ outDir }) {
  // The track. Only its line and its heights are used: no times besides the day, no heart rate,
  // and nothing of the file is written into the post folder.
  const { DOMParser } = await import('@xmldom/xmldom');
  const doc = new DOMParser().parseFromString(await readFile(path.resolve(arg('gpx')), 'utf8'), 'application/xml');
  const tags = (root, name) => Array.from(root.getElementsByTagName('*')).filter((e) => e.localName === name);
  const childText = (el, name) => Array.from(el.childNodes).find((n) => n.localName === name)?.textContent?.trim() || null;
  const pts = tags(doc, 'trkpt').length ? tags(doc, 'trkpt') : tags(doc, 'rtept');
  const raw = pts
    .map((p) => [Number(p.getAttribute('lon')), Number(p.getAttribute('lat')), Number(childText(p, 'ele') ?? NaN), childText(p, 'time')])
    .filter(([lon, lat]) => Number.isFinite(lon) && Number.isFinite(lat));
  if (raw.length < 2) throw new Error('The GPX file has no track to fly along');
  const hasEle = raw.every((p) => Number.isFinite(p[2]));
  const trk = tags(doc, 'trk')[0];
  const fileName = trk ? childText(trk, 'name') : null;
  const fileType = (trk ? childText(trk, 'type') : null) ?? '';

  // As shared/geo.ts: metres on a sphere, a point every `step` metres, climb with 5 m hysteresis.
  const RAD = Math.PI / 180;
  const dist = (a, b) => 6371008.8 * Math.hypot((b[0] - a[0]) * RAD * Math.cos(((a[1] + b[1]) / 2) * RAD), (b[1] - a[1]) * RAD);
  const along = (line) => line.reduce((acc, p, i) => (acc.push(i ? acc[i - 1] + dist(line[i - 1], p) : 0), acc), []);
  const resample = (line, step) => {
    const cum = along(line);
    const out = [];
    let k = 0;
    for (let d = 0; d < cum.at(-1); d += step) {
      while (cum[k + 1] < d) k++;
      const t = (d - cum[k]) / (cum[k + 1] - cum[k] || 1);
      out.push([0, 1, 2].map((j) => line[k][j] + (line[k + 1][j] - line[k][j]) * t));
    }
    out.push(line.at(-1).slice(0, 3));
    return out;
  };
  const climb = (eles) => {
    let [up, ref, dir] = [0, eles[0], 0];
    for (const e of eles.slice(1)) {
      if (dir >= 0 && e > ref && (dir === 1 || e - ref >= 5)) [up, ref, dir] = [up + e - ref, e, 1];
      else if (dir <= 0 && e < ref && (dir === -1 || ref - e >= 5)) [ref, dir] = [e, -1];
      else if (dir === 1 && ref - e >= 5) [ref, dir] = [e, -1];
      else if (dir === -1 && e - ref >= 5) [up, ref, dir] = [up + e - ref, e, 1];
    }
    return up;
  };

  // The tour's numbers, of the whole recording.
  const cumRaw = along(raw);
  const totalM = cumRaw.at(-1);
  const stats = {
    distanceM: Math.round(totalM),
    ascentM: hasEle ? Math.round(climb(resample(raw, 10).map((p) => p[2]))) : null,
    highestM: hasEle ? Math.round(Math.max(...raw.map((p) => p[2]))) : null,
  };

  // The line that is shown: the start and the end cut (docs/social.md, Tours), a point every 10 m.
  const trimM = Math.min(Number(arg('trim', 400)), totalM / 6);
  const kept = raw.filter((_, i) => cumRaw[i] >= trimM && cumRaw[i] <= totalM - trimM).map((p) => [p[0], p[1], hasEle ? p[2] : 0]);
  const STEP = 10;
  const P = resample(kept, STEP);
  const cumP = along(P);
  const L = cumP.at(-1);
  // Box averages over ±k points: the camera follows a calm line, the height reads without GPS jitter.
  const smooth = (k, j) => P.map((_, i) => {
    let [sum, n] = [0, 0];
    for (let m = Math.max(0, i - k); m <= Math.min(P.length - 1, i + k); m++) [sum, n] = [sum + P[m][j], n + 1];
    return sum / n;
  });
  const [camLon, camLat, eleS] = [smooth(15, 0), smooth(15, 1), smooth(3, 2)];
  const at = (arr, s) => {
    const x = Math.max(0, Math.min(arr.length - 1, (s / L) * (arr.length - 1)));
    const i = Math.min(arr.length - 2, Math.floor(x));
    return arr[i] + (arr[i + 1] - arr[i]) * (x - i);
  };
  const camAt = (s) => [at(camLon, s), at(camLat, s)];
  const bearing = (a, b) => {
    const dLon = (b[0] - a[0]) * RAD;
    const y = Math.sin(dLon) * Math.cos(b[1] * RAD);
    const x = Math.cos(a[1] * RAD) * Math.sin(b[1] * RAD) - Math.sin(a[1] * RAD) * Math.cos(b[1] * RAD) * Math.cos(dLon);
    return Math.atan2(y, x) / RAD;
  };

  // The flight: along the line, then a hold at the end with a slow turn while the numbers show.
  // Zoom and tilt stay fixed, as in the weekend reel, so the terrain does not pop.
  const FPS = QUICK ? 3 : 30;
  const SECONDS = Number(arg('seconds', 14));
  const HOLD = 3;
  const count = Math.round(FPS * SECONDS);
  const followN = Math.round(FPS * (SECONDS - HOLD));
  // Already moving at the first frame, gliding to a stop at the end.
  const speed = (t) => Math.min(1, 0.55 + (0.45 * t) / 0.15) * (t < 0.8 ? 1 : 0.5 + 0.5 * Math.cos((Math.PI * (t - 0.8)) / 0.2));
  const prog = [0];
  for (let i = 1; i < followN; i++) prog.push(prog[i - 1] + speed(i / (followN - 1)));
  const sAt = Array.from({ length: count }, (_, i) => (i < followN ? (L * prog[i]) / prog[followN - 1] : L));
  // About a third of the tour across the frame, between 2 and 7 km.
  const viewM = Math.max(2000, Math.min(7000, L * 0.3));
  const lat0 = camLat.reduce((a, b) => a + b, 0) / camLat.length;
  const ZOOM = Math.log2((156543.03 * Math.cos(lat0 * RAD)) / (viewM / 1080));
  const PITCH = 60;
  // Looking along the way the track goes over a long stretch, so switchbacks do not swing it.
  const D = Math.max(300, Math.min(1500, L * 0.08));
  const clampS = (s) => Math.max(0, Math.min(L, s));
  let headings = sAt.map((s) => bearing(camAt(clampS(s - D)), camAt(clampS(s + D))));
  for (let i = 1; i < count; i++) headings[i] -= 360 * Math.round((headings[i] - headings[i - 1]) / 360);
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
    const h = i < followN ? 0 : (i - followN + 1) / (count - followN);
    const turn = 22 * (h - Math.sin(2 * Math.PI * h) / (2 * Math.PI));
    // The dot about in the middle, between the title and the numbers; in the hold the camera eases
    // back towards the viewer, so the dot rises above the taller panel with the numbers.
    const back = viewM * 0.22 * (h - Math.sin(2 * Math.PI * h) / (2 * Math.PI));
    const b = (headings[i] + turn) * RAD;
    const [lon0, lat0c] = camAt(s);
    const lat = lat0c - (back * Math.cos(b)) / 111_320;
    const lon = lon0 - (back * Math.sin(b)) / (111_320 * Math.cos(lat0c * RAD));
    return [ZOOM, lat, lon, headings[i] + turn, PITCH];
  });

  const firstTime = raw.find((p) => p[3])?.[3];
  const date = arg('date', firstTime ? new Date(firstTime).toLocaleDateString('en-CA', { timeZone: TZ }) : null);
  const dateText = date ? `${dayOnly(`${date}T12:00:00Z`)} ${date.slice(0, 4)}` : null;
  const kind = arg('kind', /ski|backcountry/i.test(fileType) ? 'Ski tour' : /hik|walk|trek/i.test(fileType) ? 'Hike' : /run/i.test(fileType) ? 'Trail run' : /bik|cycl/i.test(fileType) ? 'Bike ride' : 'Tour');
  const parts = (fileName ?? '').split(/\s*(?:→|->|–|-)\s*/).filter(Boolean);
  const title = arg('title', parts.length === 2 ? `${parts[0]} to ${parts[1]}` : fileName || 'A tour in South Tyrol');

  // The snow of that day (the day slider) as the satellite saw it, white on the land cover: forest,
  // meadows and rock read as a real place, and white needs no legend.
  const layers = arg('layers', `snow,basemap,${TERRAIN},labels`);
  const hash = `#map=12/${lat0.toFixed(4)}/${camLon[0].toFixed(4)}/0/${PITCH}&layers=${layers}${date ? `&day=${date}` : ''}`;
  // A plain GPX of the shown line only, for the app's own snow-along-the-track check.
  const gpxText = `<?xml version="1.0"?><gpx version="1.1" xmlns="http://www.topografix.com/GPX/1/1"><trk><trkseg>${P.map((p) => `<trkpt lat="${p[1].toFixed(6)}" lon="${p[0].toFixed(6)}">${hasEle ? `<ele>${p[2].toFixed(1)}</ele>` : ''}</trkpt>`).join('')}</trkseg></trk></gpx>`;
  let snow = null;
  const t0 = Date.now();
  const shots = await fly({
    hash, size: [1080, 1920], cameras, labels: 'local', textScale: 1.5,
    setup: async () => {
      snow = await mapPage.evaluate(async ({ line, gpxText, wantDepth }) => {
        const { map, gpx } = window.__snowmap;
        let along = null;
        try {
          await gpx.load(gpxText, 'track.gpx');
          for (let k = 0; k < 60 && !(along = gpx.snow()); k++) await new Promise((r) => setTimeout(r, 500));
        } catch (e) {
          console.log('snow along the track:', e.message);
        }
        // The depth estimate at the same profile points: the app reads it from the day's data PNG
        // only for a tap, so it is decoded here as web/src/snow.ts SnowValues does, on the
        // shared/grid.ts cells. Everything comes from the site itself.
        let depths = null;
        if (wantDepth && along) {
          try {
            const base = new URL('data/', location.href);
            const json = async (p) => (await fetch(new URL(p, base))).json();
            const snowPath = along.day ? (await json('history.json')).days.find((d) => d.date === along.day)?.snow ?? 'snow.json' : 'snow.json';
            const file = await json(snowPath);
            if (file.depth && file.files.data) {
              const bitmap = await createImageBitmap(await (await fetch(new URL(file.files.data, base))).blob(), { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
              const ctx = new OffscreenCanvas(bitmap.width, bitmap.height).getContext('2d', { willReadFrequently: true });
              ctx.drawImage(bitmap, 0, 0);
              const px = ctx.getImageData(0, 0, bitmap.width, bitmap.height).data;
              const g = file.grid;
              const my = (lat) => Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360));
              depths = gpx.track().profile.points.map(({ lon, lat }) => {
                if (lon < g.west || lon >= g.east || lat <= g.south || lat > g.north) return null;
                const col = Math.min(g.width - 1, Math.floor(((lon - g.west) / (g.east - g.west)) * g.width));
                const row = Math.min(g.height - 1, Math.floor(((my(g.north) - my(lat)) / (my(g.north) - my(g.south))) * g.height));
                const i = (row * g.width + col) * 4;
                return ((px[i] & 3) << 8) + px[i + 1];
              });
            }
          } catch (e) {
            console.log('depth along the track:', e.message);
          }
        }
        // The app's own drawing of the track is replaced by one that grows with the flight.
        for (const id of ['gpx-casing', 'gpx-line', 'gpx-ends', 'gpx-hit', 'gpx-label']) if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', 'none');
        const color = '#7048e8';
        map.addSource('reel-track', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
        const below = map.getStyle().layers.find((l) => l.type === 'symbol')?.id;
        const round = { 'line-cap': 'round', 'line-join': 'round' };
        const role = (r) => ['==', ['get', 'role'], r];
        // The way on, dashed: in the track's colour, which shows on snow and on grass alike.
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
        return along && { date: along.date, sensor: along.sensor, day: along.day, route: along.route, points: along.points, depths };
      }, { line: P.map((p) => [p[0], p[1]]), gpxText, wantDepth: DEPTH });
      console.log('snow along the track:', JSON.stringify({ ...snow, points: snow?.points.length, depths: snow?.depths && Math.max(...snow.depths.filter((d) => d !== null)) }));
      if (DEPTH && !snow?.depths) throw new Error('No snow depth estimate for this day');
    },
    before: (i) => mapPage.evaluate((f) => window.__trackAt(f), sAt[i] / L),
  });
  console.log(`flight of ${count} frames in ${((Date.now() - t0) / 1000).toFixed(0)} s`);

  // The overlay: the title, the height and the distance on the way with a profile, then the numbers.
  const num = (v) => Math.round(v).toLocaleString('en');
  const km = (m) => `${(m / 1000).toFixed(1)} km`;
  const route = snow?.route;
  const snowLine = !route ? null
    : route.snow >= 0.05 && route.lowestSnowM ? `Snow on ${Math.round(route.snow * 100)} % of the way, from ${num(Math.round(route.lowestSnowM / 10) * 10)} m`
      : route.unseen < 0.5 ? 'No snow seen along the way' : null;
  const snowWhen = snow ? `seen from space ${dayOnly(`${snow.date}T12:00:00Z`)}` : null;
  const [minE, maxE] = [Math.min(...eleS), Math.max(...eleS)];
  const PW = 820;
  const PH = 150;
  const px = (s) => (s / L) * PW;
  // With --depth the profile keeps room above it for the snow cap.
  const CAP = 30;
  const TOP = DEPTH ? CAP + 6 : 8;
  const py = (e) => TOP + ((maxE - e) / (maxE - minE || 1)) * (PH - TOP - 8);
  // The depth estimate at the profile points (250 m cells), a little smoothed so the bar moves
  // rather than jumps from cell to cell; the scale reaches a round number above the deepest.
  const rawD = snow?.depths ?? [];
  const dSm = rawD.map((_, i) => {
    let [sum, n] = [0, 0];
    for (let m = Math.max(0, i - 4); m <= Math.min(rawD.length - 1, i + 4); m++) if (rawD[m] !== null) [sum, n] = [sum + rawD[m], n + 1];
    return n ? sum / n : 0;
  });
  const maxD = Math.max(0, ...rawD.filter((d) => d !== null));
  const scaleMax = [20, 30, 40, 50, 60, 80, 100, 150, 200, 300].find((v) => v >= maxD * 1.15) ?? Math.ceil(maxD / 100) * 100;
  const depthAt = (s) => (dSm.length ? at(dSm, s) : 0);
  const prof = Array.from({ length: 201 }, (_, k) => [px((L * k) / 200), py(at(eleS, (L * k) / 200))]);
  const area = `M0,${PH} ${prof.map(([x, y]) => `L${x.toFixed(1)},${y.toFixed(1)}`).join(' ')} L${PW},${PH} Z`;
  // What the satellite saw along the way, as runs of one state; the app's points are evenly spaced.
  // With --depth the ground is one tone and the snow sits on it as a cap as deep as the estimate.
  const FILL = DEPTH
    ? { snow: 'rgba(255,255,255,.2)', bare: 'rgba(255,255,255,.2)', unseen: 'url(#hatch)', null: 'rgba(255,255,255,.2)' }
    : { snow: '#f4f7fa', bare: '#a8916f', unseen: 'url(#hatch)', null: 'rgba(255,255,255,.2)' };
  const capPts = dSm.map((d, k) => {
    const x = (k / (dSm.length - 1)) * PW;
    const y = py(at(eleS, (x / PW) * L));
    return [x, y, y - (Math.min(d, scaleMax) / scaleMax) * CAP];
  });
  const capPath = capPts.length ? `M${capPts.map(([x, , t]) => `${x.toFixed(1)},${t.toFixed(1)}`).join(' L')} L${[...capPts].reverse().map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' L')} Z` : '';
  const swatch = (bg) => `<i style="display:inline-block;width:26px;height:14px;border-radius:3px;background:${bg};margin-right:9px"></i>`;
  const runs = [];
  const states = snow?.points ?? [];
  states.forEach((st, k) => {
    const [x0, x1] = [Math.max(0, k - 0.5), Math.min(states.length - 1, k + 0.5)].map((v) => (v / (states.length - 1)) * PW);
    if (runs.at(-1)?.st === String(st)) runs.at(-1).x1 = x1;
    else runs.push({ st: String(st), x0, x1 });
  });
  const unseenShare = states.length ? states.filter((x) => x === 'unseen').length / states.length : 0;
  const profile = (s) => `<svg width="${PW}" height="${PH}" viewBox="0 0 ${PW} ${PH}" style="display:block;margin-top:26px;overflow:visible">
      <defs><clipPath id="area"><path d="${area}"/></clipPath>
        <pattern id="hatch" width="12" height="12" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="12" height="12" fill="rgba(120,132,144,.55)"/><rect width="4" height="12" fill="rgba(255,255,255,.55)"/></pattern></defs>
      <g clip-path="url(#area)">
        ${DEPTH ? `<rect x="0" y="0" width="${PW}" height="${PH}" fill="${FILL.null}"/>${runs.filter((r) => r.st === 'unseen').map((r) => `<rect x="${r.x0.toFixed(1)}" y="0" width="${(r.x1 - r.x0).toFixed(1)}" height="${PH}" fill="${FILL.unseen}"/>`).join('')}`
          : runs.length ? runs.map((r) => `<rect x="${r.x0.toFixed(1)}" y="0" width="${(r.x1 - r.x0 + 0.6).toFixed(1)}" height="${PH}" fill="${FILL[r.st] ?? FILL.null}"/>`).join('') : `<rect x="0" y="0" width="${px(s).toFixed(1)}" height="${PH}" fill="#7048e8"/>`}
        <rect x="${px(s).toFixed(1)}" y="0" width="${(PW - px(s)).toFixed(1)}" height="${PH}" fill="rgba(12,22,34,.6)"/>
      </g>
      ${capPath ? `<defs><clipPath id="done"><rect x="0" y="0" width="${px(s).toFixed(1)}" height="${PH}"/></clipPath><clipPath id="ahead"><rect x="${px(s).toFixed(1)}" y="0" width="${(PW - px(s)).toFixed(1)}" height="${PH}"/></clipPath></defs>
        <path d="${capPath}" fill="#eef4fb" clip-path="url(#done)"/><path d="${capPath}" fill="#eef4fb" opacity=".35" clip-path="url(#ahead)"/>` : ''}
      <path d="${prof.map(([x, y], k) => `${k ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ')}" fill="none" stroke="rgba(255,255,255,.9)" stroke-width="3"/>
      <circle cx="${px(s).toFixed(1)}" cy="${py(at(eleS, s)).toFixed(1)}" r="11" fill="#7048e8" stroke="#fff" stroke-width="4"/></svg>
      ${runs.length ? `<div class="dim" style="display:flex;gap:30px;font-size:23px;margin-top:14px;align-items:center">
        ${DEPTH ? `<span>${swatch('#eef4fb')}snow depth, up to ${maxD} cm (estimate)</span>`
          : `<span>${swatch(FILL.snow)}snow${route?.lowestSnowM ? `, from ${num(Math.round(route.lowestSnowM / 10) * 10)} m` : ''}</span><span>${swatch(FILL.bare)}bare</span>`}
        ${unseenShare >= 0.02 ? `<span><svg width="26" height="14" style="vertical-align:-1px;margin-right:9px"><defs><pattern id="h2" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="8" height="8" fill="rgba(120,132,144,.55)"/><rect width="3" height="8" fill="rgba(255,255,255,.55)"/></pattern></defs><rect width="26" height="14" rx="3" fill="url(#h2)"/></svg>not seen (cloud)</span>` : ''}
      </div>` : ''}`;
  const row = (label, value) => `<div style="display:flex;justify-content:space-between;align-items:baseline;padding:12px 0;border-top:2px solid rgba(255,255,255,.16)">
      <span style="font-size:34px;font-weight:600;color:#fff">${label}</span><b style="font-size:52px;color:#fff;font-weight:700">${value}</b></div>`;
  // With --depth a third number, the snow at the dot, with a thin bar under it that fills to the
  // depth on the scale of the deepest along the way. The units are set smaller so three fit, and
  // the columns have fixed widths, so the snow does not shift when the distance gains a digit.
  const unit = (u) => `<span style="font-size:.5em;font-weight:600;margin-left:.14em">${u}</span>`;
  const stat = (label, value, width, extra = '') => `<div style="${DEPTH ? `width:${width}px;flex:none` : ''}"><div class="cap" style="font-size:26px;margin-bottom:10px">${label}</div><div class="big" style="font-size:${DEPTH ? 96 : 104}px;white-space:nowrap">${value}</div>${extra}</div>`;
  const live = (s) => {
    const d = Math.round(depthAt(s));
    const bar = `<div style="height:8px;border-radius:4px;margin-top:14px;background:rgba(255,255,255,.22);overflow:hidden"><div style="height:100%;width:${((Math.min(d, scaleMax) / scaleMax) * 100).toFixed(1)}%;background:#eef4fb;border-radius:4px"></div></div>`;
    return `<div style="display:flex;gap:${DEPTH ? 44 : 70}px;font-variant-numeric:tabular-nums">
      ${hasEle ? stat('Height', DEPTH ? `${num(at(eleS, s))}${unit('m')}` : `${num(at(eleS, s))} m`, 290) : ''}
      ${stat('Distance', DEPTH ? `${((trimM + s) / 1000).toFixed(1)}${unit('km')}` : km(trimM + s), 260)}
      ${DEPTH ? stat('Snow', `${d}${unit('cm')}`, 180, bar) : ''}</div>
      ${hasEle ? profile(s) : ''}`;
  };
  const end = `<div class="cap" style="font-size:26px;margin-bottom:10px">The ${kind.toLowerCase()}</div>
      ${row('Distance', km(stats.distanceM))}${stats.ascentM !== null ? row('Climb', `${num(stats.ascentM)} m`) : ''}${stats.highestM !== null ? row('Highest point', `${num(stats.highestM)} m`) : ''}${DEPTH && maxD >= 1 ? row('Deepest snow, estimated', `~${maxD} cm`) : ''}
      ${snowLine ? `<div class="dim" style="font-size:28px;margin-top:16px">${snowLine}, ${snowWhen}</div>` : ''}
      <div style="margin-top:${DEPTH ? 28 : 36}px">${brand(1.25)}</div><div class="dim" style="font-size:30px;margin-top:20px">Put your own GPX on the snow</div>`;
  const trCredit = credit(DEPTH || layers.includes('depth') ? ', snow from stations and Copernicus Sentinel-2' : ', snow Copernicus Sentinel-2');

  const tmp = path.join(outDir, '.reel');
  await rm(tmp, { recursive: true, force: true });
  await mkdir(tmp);
  const FADE = Math.max(1, Math.round(FPS * 0.35));
  for (let i = 0; i < count; i++) {
    const name = String(i).padStart(4, '0');
    await writeFile(path.join(tmp, `map-${name}.jpg`), Buffer.from(shots[i].split(',')[1], 'base64'));
    const atEnd = i >= followN;
    const alpha = atEnd ? Math.min(1, (i - followN + 1) / FADE) : 1;
    await frame(path.join(tmp, `ov-${name}.png`), [1080, 1920], `
      <div class="abs sky" style="height:540px"></div>
      <div class="abs" style="left:80px;right:80px;top:250px">
        <div class="title" style="font-size:80px">${title}</div>
        <div class="sub" style="font-size:34px;margin-top:16px">${kind}${dateText ? `, ${dateText}` : ''}, South Tyrol</div>
      </div>
      <div class="abs scrim" style="height:${atEnd ? 1040 : 820}px;background:linear-gradient(rgba(12,22,34,0),rgba(12,22,34,.85) 26%,rgba(12,22,34,.94))"></div>
      <div class="abs" style="left:80px;right:180px;bottom:430px;opacity:${alpha}">${atEnd ? end : live(sAt[i])}</div>
      <div class="abs dim" style="left:80px;right:180px;bottom:350px;font-size:17px">${trCredit}</div>`, { transparent: true });
  }
  execFileSync('ffmpeg', [
    '-y', '-loglevel', 'error',
    '-framerate', String(FPS), '-i', path.join(tmp, 'map-%04d.jpg'),
    '-framerate', String(FPS), '-i', path.join(tmp, 'ov-%04d.png'),
    '-filter_complex', `[0:v]fps=30[m];[1:v]fps=30[o];[m][o]overlay=0:0:shortest=1,format=yuv420p[v]`,
    '-map', '[v]', '-c:v', 'libx264', '-preset', 'slow', '-crf', '19', '-movflags', '+faststart', '-r', '30',
    path.join(outDir, 'reel-9x16.mp4'),
  ]);
  console.log(`made ${path.relative(process.cwd(), path.join(outDir, 'reel-9x16.mp4'))} (${SECONDS} s)`);
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-sseof', '-0.5', '-i', path.join(outDir, 'reel-9x16.mp4'), '-frames:v', '1', '-q:v', '3', path.join(outDir, 'reel-end.jpg')]);
  // Contact sheet: early, middle, late in the flight and the end.
  const n30 = 30 * SECONDS;
  const pick = [Math.round(n30 * 0.08), Math.round(n30 * 0.35), Math.round(n30 * 0.65), n30 - 10];
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', path.join(outDir, 'reel-9x16.mp4'), '-vf', `select='${pick.map((n) => `eq(n\\,${n})`).join('+')}',scale=360:-1,tile=4x1`, '-frames:v', '1', '-vsync', 'vfr', path.join(outDir, 'reel-sheet.jpg')]);
  await rm(tmp, { recursive: true, force: true });
  // The numbers in the post, for the caption; no positions or times.
  await writeFile(path.join(outDir, 'data.json'), `${JSON.stringify({ site: SITE, title, kind, date, ...stats, trimM: Math.round(trimM), shownM: Math.round(L), seconds: SECONDS, ...(DEPTH ? { maxDepthCm: maxD } : {}), snow: snow && { ...snow, points: undefined, depths: undefined } }, null, 1)}\n`);
}
