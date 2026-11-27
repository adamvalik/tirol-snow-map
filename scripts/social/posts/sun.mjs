// sun: The Map trick series: sun and shade on the real terrain, the sun moved with the app's
// own slider, every frame the shade the app draws for that minute. A reel (9:16 MP4).
//   --mode day         sunrise to sunset on one day (default)
//          sunrise     the first light on the summits, slowly
//          sunset      the last light on the summits, slowly
//          year        true noon from 21 June to 21 December: the shade grows
//   --place NAME       dolomites (default), ortler, meran, gardena; see SUN_PLACES
//   --date YYYY-MM-DD  the day, default today; for year only its year counts
//   --seconds S        length of the reel, default 12
//   --layers LIST      the app's layers, default sun,basemap,hillshade,relief,labels (no snow:
//                      the app draws the shade under the snow cells)
// Slow: every frame waits for the app's finer shade. Render --quick first. docs/social.md,
// "The sun reel", has the places, the log messages and how to add a place.

import { execFileSync } from 'node:child_process';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { QUICK, SITE, TERRAIN, TZ, arg, brand, fly, frame, mapPage, today } from '../core.mjs';

export const usage = 'sun [--mode day|sunrise|sunset|year] [--place NAME] [--date YYYY-MM-DD] [--seconds S] [--layers LIST]';
// Every mode but day goes into its own folder.
export const variant = () => (arg('mode', 'day') !== 'day' ? `-${arg('mode')}` : '');

export async function run({ outDir }) {
  const { getPosition, getTimes } = await import('suncalc');
  // Places for the reel: a start and an end camera (zoom, lat, lon, bearing, pitch, as for
  // capture) with the same zoom and tilt, so the camera only turns and drifts and the terrain
  // does not pop. About 15 km across, close enough for single ridges and their shade.
  const SUN_PLACES = {
    dolomites: { name: 'Sella and Langkofel, Dolomites', cams: [[13.3, 46.528, 11.765, 150, 62], [13.3, 46.52, 11.79, 175, 62]] },
    gardena: { name: 'Val Gardena / Gröden', cams: [[12.6, 46.59, 11.63, 120, 62], [12.6, 46.585, 11.68, 150, 62]] },
    ortler: { name: 'Ortler, Vinschgau', cams: [[12.3, 46.545, 10.5, 160, 62], [12.3, 46.53, 10.53, 190, 62]] },
    meran: { name: 'Meran / Merano', cams: [[11.9, 46.71, 11.12, 150, 60], [11.9, 46.7, 11.17, 175, 60]] },
  };
  const MODE = arg('mode', 'day');
  if (!['day', 'sunrise', 'sunset', 'year'].includes(MODE)) throw new Error('--mode is day, sunrise, sunset or year');
  const place = SUN_PLACES[arg('place', 'dolomites')];
  if (!place) throw new Error(`--place is one of ${Object.keys(SUN_PLACES).join(', ')}`);
  const date = arg('date', today);
  const [, lat, lon] = place.cams[0].map((v, j) => (v + place.cams[1][j]) / 2);

  const MIN = 60_000;
  const FPS = QUICK ? 3 : 30;
  const SECONDS = Number(arg('seconds', 12));
  // The last seconds hold the time and show the address; the camera keeps turning.
  const HOLD = 2.5;
  const count = Math.round(FPS * SECONDS);
  const moveN = Math.round(FPS * (SECONDS - HOLD));
  const ease = (t) => t - (Math.sin(2 * Math.PI * t) / (2 * Math.PI)) * 0.35;
  const lerp = (a, b, t) => a + (b - a) * t;
  const cameras = Array.from({ length: count }, (_, i) => place.cams[0].map((v, j) => lerp(v, place.cams[1][j], ease(i / (count - 1)))));

  // The instants shown, one per frame. Sunrise and sunset over a flat horizon, as the app gives
  // them (the top edge of the sun); the summits see the sun a little earlier and later.
  const times = (ymd) => getTimes(new Date(`${ymd}T11:00:00Z`), lat, lon);
  const addDays = (ymd, n) => new Date(Date.parse(`${ymd}T12:00:00Z`) + n * 864e5).toISOString().slice(0, 10);
  const smooth = (t) => (1 - Math.cos(Math.PI * t)) / 2;
  let tAt;
  let range;
  let year;
  if (MODE === 'year') {
    // True noon each day, from the longest day to the shortest: the sun due south, only its
    // height changes. A clock time would jump when the clocks change on 25 October.
    const y = Number(date.slice(0, 4));
    const days = Math.round((Date.parse(`${y}-12-21`) - Date.parse(`${y}-06-21`)) / 864e5);
    year = { from: `${y}-06-21`, days };
    tAt = (f) => times(addDays(year.from, Math.round(days * smooth(f)))).solarNoon.getTime();
  } else {
    const { sunrise, sunset } = times(date);
    range = MODE === 'day' ? [sunrise.getTime() - 15 * MIN, sunset.getTime() + 20 * MIN]
      : MODE === 'sunrise' ? [sunrise.getTime() - 35 * MIN, sunrise.getTime() + 45 * MIN]
        : [sunset.getTime() - 45 * MIN, sunset.getTime() + 30 * MIN];
    tAt = (f) => lerp(range[0], range[1], MODE === 'day' ? f : smooth(f));
  }
  const tFrames = Array.from({ length: count }, (_, i) => tAt(Math.min(1, i / (moveN - 1))));
  const sunAt = (t) => getPosition(new Date(t), lat, lon);
  const { sunrise, sunset } = MODE === 'year' ? {} : times(date);

  const clock = (t) => new Date(t).toLocaleTimeString('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit' });
  const localDay = (t) => new Date(t).toLocaleDateString('en-CA', { timeZone: TZ });
  const COMPASS = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'];
  const towards = (az) => COMPASS[Math.round((((az % 360) + 360) % 360) / 45) % 8];
  const sunLine = ({ altitude, azimuth }) =>
    altitude >= 0.5 ? `Sun ${Math.round(altitude)}° high in the ${towards(azimuth)}` : altitude > -1 ? `Sun on the horizon in the ${towards(azimuth)}` : 'Sun below the horizon';

  // Each frame: the camera, then the date and the minute set on the app's own controls, as a
  // person would, and the shot once the shade for it is drawn (body[data-shadow-ms] changes with
  // every drawn shade; the quick shade of the slider comes first, then the finer one).
  let lastKey = '';
  // This software-rendered browser is slower than a phone: at a low sun the finer shade can take
  // longer than the app's 8 s watchdog (shadows.ts), which then turns the shade off. For the
  // render only, the watchdog waits a minute; a shade that still fails stops the render.
  await mapPage.addInitScript(() => {
    const st = window.setTimeout;
    window.setTimeout = (fn, ms, ...rest) => st(fn, ms === 8000 ? 60_000 : ms, ...rest);
  });
  mapPage.on('console', (m) => {
    if (m.text().startsWith('Shadows:')) throw new Error(`The shade failed in the page: ${m.text()}`);
  });
  const workerMs = [];
  const t0 = Date.now();
  const shots = await fly({
    hash: `#map=11/${lat.toFixed(4)}/${lon.toFixed(4)}/0/60&layers=${arg('layers', `sun,basemap,${TERRAIN},labels`)}&sun=${new Date(tFrames[0]).toISOString().slice(0, 16)}Z`,
    size: [1080, 1920], cameras, labels: 'summits', textScale: 1.5,
    before: async (i) => {
      const t = tFrames[i];
      const s = sunAt(t);
      // As the app's shade decides to redraw (shadows.ts): a new minute or a new tenth of a degree,
      // but nothing new while every summit of the region is without the sun: below -2.1° at all
      // corners of the model grid (shared/grid.ts), the sun's lowest point there. A little lower
      // here, so a frame near the edge waits rather than being shot before its shade.
      const regionHigh = Math.max(...[10.2, 12.7].flatMap((lo) => [46.1, 47.25].map((la) => getPosition(new Date(t), la, lo).altitude)));
      const key = regionHigh < -2.2 ? 'night' : `${Math.round(t / MIN)}/${s.azimuth.toFixed(1)}`;
      // All in shade is drawn at once, without the worker (and at load, when the reel starts there).
      const expect = key !== lastKey && key !== 'night';
      lastKey = key;
      const day = localDay(t);
      const r = await mapPage.evaluate(
        async ({ cam: [zoom, la, lo, bearing, pitch], t, day, expect, first }) => {
          const map = window.__snowmap.map;
          map.jumpTo({ center: [lo, la], zoom: zoom - 1, bearing, pitch });
          if (!expect) return { n: 0, ms: 0 };
          // The slider's quick shade comes first and leaves out the finer grid; the shot waits for
          // the finer one (its layer shown), or, where there is none (all in shade), for a quiet spell.
          const fine = () => map.getLayoutProperty('sun-shadows-detail', 'visibility') === 'visible';
          let n = 0;
          let last = performance.now();
          const obs = new MutationObserver(() => ((n += 1), (last = performance.now())));
          obs.observe(document.body, { attributes: true, attributeFilter: ['data-shadow-ms'] });
          const dateIn = document.getElementById('sun-date');
          const slider = document.getElementById('sun-time');
          // Finer than the slider's 5 minutes, so the sun moves smoothly.
          slider.step = '0.01';
          if (dateIn.value !== day) {
            dateIn.value = day;
            dateIn.dispatchEvent(new Event('change'));
          }
          // Minutes since local midnight, through the clock change.
          const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Rome', hourCycle: 'h23', hour: 'numeric', minute: 'numeric', second: 'numeric' }).formatToParts(new Date(t)).map((p) => [p.type, Number(p.value)]));
          slider.value = String(parts.hour * 60 + parts.minute + parts.second / 60 + (t % 1000) / 60000);
          slider.dispatchEvent(new Event('input'));
          slider.dispatchEvent(new Event('change'));
          const start = performance.now();
          const limit = first ? 90_000 : 60_000;
          while (performance.now() - start < limit) {
            await new Promise((r) => setTimeout(r, 30));
            if (n && performance.now() - last > (fine() ? 150 : 2500)) break;
          }
          obs.disconnect();
          return { n, ms: Math.round(performance.now() - start), worker: Number(document.body.dataset.shadowMs) };
        },
        { cam: cameras[i], t, day, expect, first: i === 0 },
      );
      if (expect && r.n === 0) console.log(`frame ${i}: no shade drawn in ${r.ms} ms`);
      if (r.worker) workerMs.push(r.worker);
      if (i % 25 === 0) console.log(`frame ${i}/${count}, ${((Date.now() - t0) / 1000).toFixed(0)} s`);
    },
  });
  console.log(`${count} frames in ${((Date.now() - t0) / 1000).toFixed(0)} s; shade worker ${Math.round(Math.max(...workerMs, 0))} ms at most`);

  // The text: what and where on top, the time and the sun at the bottom, the address at the end.
  const sunCredit = '© OpenStreetMap contributors, © Mapterhorn. Clear sky assumed; no trees or buildings in the terrain.';
  const dayText = (ymd) => new Date(`${ymd}T12:00:00Z`).toLocaleDateString('en-GB', { timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short' });
  const dm = (ymd) => new Date(`${ymd}T12:00:00Z`).toLocaleDateString('en-GB', { timeZone: 'UTC', day: 'numeric', month: 'short' });
  const head = MODE === 'year'
    ? { title: 'The sun at noon,<br>June to December', sub: place.name }
    : MODE === 'sunrise' || MODE === 'sunset'
      ? { title: MODE === 'sunrise' ? 'First light<br>on the summits' : 'Last light<br>on the summits', sub: `${place.name}, ${dayText(date)}` }
      : { title: 'Sun and shade,<br>through a day', sub: `${place.name}, ${dayText(date)}` };
  // A bar for the time shown: the day (night, light, night) with the sun on it.
  const bar = (f, gradient, left, right) => `<div style="margin-top:30px;position:relative;height:18px;border-radius:9px;background:${gradient}">
      <div style="position:absolute;top:50%;left:${(f * 100).toFixed(2)}%;width:40px;height:40px;margin:-20px 0 0 -20px;border-radius:50%;background:#ffd35c;border:4px solid #fff;box-shadow:0 0 22px rgba(255,200,80,.9)"></div></div>
    <div style="display:flex;justify-content:space-between;font-size:26px;font-weight:500;color:rgba(255,255,255,.85);margin-top:16px"><span>${left}</span><span>${right}</span></div>`;
  const pct = (t) => `${(Math.min(1, Math.max(0, (t - range[0]) / (range[1] - range[0]))) * 100).toFixed(1)}%`;
  const dayGradient = range && `linear-gradient(to right, #3a4560 ${pct(sunrise.getTime() - 20 * MIN)}, #f2c45a ${pct(sunrise.getTime() + 20 * MIN)}, #f2c45a ${pct(sunset.getTime() - 20 * MIN)}, #3a4560 ${pct(sunset.getTime() + 20 * MIN)})`;
  const bottom = (i) => {
    const t = tFrames[i];
    const s = sunAt(t);
    const f = Math.min(1, i / (moveN - 1));
    if (MODE === 'year') {
      const day = localDay(t);
      return `<div class="cap" style="font-size:26px;margin-bottom:12px">Noon</div>
        <div class="big" style="font-size:150px">${dm(day)}</div>
        <div class="dim" style="font-size:34px;margin-top:14px">Sun ${Math.round(s.altitude)}° high in the south</div>
        ${bar(smooth(f), 'linear-gradient(to right,#f2c45a,#c98a3c 70%,#7b6a8a)', '21 Jun, longest day', '21 Dec, shortest')}`;
    }
    // The summits see the sun before (after) a flat horizon would: a ridge high up looks over the others.
    const flat = MODE === 'sunrise' ? `Sunrise over a flat horizon ${clock(sunrise)}` : `Sunset over a flat horizon ${clock(sunset)}`;
    const rise = MODE !== 'day' ? `<div class="dim" style="font-size:30px;margin-top:10px">${flat}</div>` : '';
    return `<div class="cap" style="font-size:26px;margin-bottom:12px">${MODE === 'day' ? 'Time of day' : MODE === 'sunrise' ? 'Sunrise' : 'Sunset'}</div>
      <div class="big" style="font-size:150px">${clock(t)}</div>
      <div class="dim" style="font-size:34px;margin-top:14px">${sunLine(s)}</div>${rise}
      ${MODE === 'day' ? bar((t - range[0]) / (range[1] - range[0]), dayGradient, `Sunrise ${clock(sunrise)}`, `Sunset ${clock(sunset)}`) : ''}`;
  };
  const END = `<div class="title white" style="font-size:66px;margin-bottom:16px">${MODE === 'year' ? 'Any day of the year' : 'Any day, any time'}</div>
    <div class="dim" style="font-size:34px;margin-bottom:34px">The real ridges cast the shade.<br>Try it on your mountain.</div>${brand(1.25)}`;

  const tmp = path.join(outDir, '.reel');
  await rm(tmp, { recursive: true, force: true });
  await mkdir(tmp);
  const FADE = Math.max(1, Math.round(FPS * 0.3));
  for (let i = 0; i < count; i++) {
    const name = String(i).padStart(4, '0');
    await writeFile(path.join(tmp, `map-${name}.jpg`), Buffer.from(shots[i].split(',')[1], 'base64'));
    const end = i >= moveN;
    const alpha = end ? Math.min(1, (i - moveN + 1) / FADE) : 1;
    await frame(path.join(tmp, `ov-${name}.png`), [1080, 1920], `
      <div class="abs sky" style="height:600px"></div>
      <div class="abs" style="left:80px;right:80px;top:250px">
        <div class="title" style="font-size:76px">${head.title}</div>
        <div class="sub" style="font-size:34px;margin-top:16px">${head.sub}</div>
      </div>
      <div class="abs scrim" style="height:${end ? 900 : 820}px;background:linear-gradient(rgba(12,22,34,0),rgba(12,22,34,.78) 28%,rgba(12,22,34,.92))"></div>
      <div class="abs" style="left:80px;right:180px;bottom:430px;opacity:${alpha}">${end ? END : bottom(i)}</div>
      <div class="abs dim" style="left:80px;right:180px;bottom:350px;font-size:17px">${sunCredit}</div>`, { transparent: true });
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
  const n30 = 30 * SECONDS;
  const pick = [0.04, 0.3, 0.55, 0.78].map((x) => Math.round(n30 * x * (SECONDS - HOLD) / SECONDS));
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', reel, '-vf', `select='${[...pick, n30 - 10].map((n) => `eq(n\\,${n})`).join('+')}',scale=300:-1,tile=5x1`, '-frames:v', '1', '-vsync', 'vfr', path.join(outDir, 'reel-sheet.jpg')]);
  await rm(tmp, { recursive: true, force: true });
  await writeFile(path.join(outDir, 'data.json'), `${JSON.stringify({ site: SITE, mode: MODE, place: arg('place', 'dolomites'), date: MODE === 'year' ? year : date, from: new Date(tFrames[0]).toISOString(), to: new Date(tFrames.at(-1)).toISOString(), sunrise: sunrise?.toISOString(), sunset: sunset?.toISOString(), seconds: SECONDS }, null, 1)}\n`);
}
