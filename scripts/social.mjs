// Instagram posts rendered from the live map (docs/social.md). Not part of the app.
//
//   node scripts/social.mjs <post> [--site https://cimamap.com/] [--out social/posts/<date>-<post>] [--quick]
//
// Posts:
//   storm   The forecast snowfall building up over South Tyrol: a reel (9:16 MP4), a cover still
//           (4:5) and a story (9:16). Numbers and times come from the site's forecast.json.
//   intro   The carousel that says what the map shows (4:5 slides), from the current data.
//   island  South Tyrol as a block, with the snow the satellite saw last (4:5).
//   fallen  After a storm: the stations with the most new snow in 72 hours, over the depth
//           estimate (4:5 and a 9:16 story). From the site's stations.json.
//   weekend The Friday series: the snow on the ground at 1,500, 2,000 and 2,500 m and the new
//           snow forecast to Sunday, over a slow flight across the depth estimate. A reel (9:16
//           MP4) and a story (9:16). From stations.json and forecast.json.
//   track   The Tour series: a flight along one of our own GPX tracks on the snow of the day it
//           was done, the line drawn as the camera goes, with the height and distance on the way
//           and the tour's numbers at the end. A reel (9:16 MP4).
//             --gpx FILE         the track (required; read here, never copied into the post)
//             --title TEXT       default: the track's name, "Pennes-Campolasta" as "Pennes to Campolasta"
//             --kind TEXT        default: from the file's <type> (Hike, Ski tour, Trail run, Tour)
//             --date YYYY-MM-DD  default: the day of the first timestamp; the snow is that day's
//             --trim M           metres cut from the start and the end, default 400 (a home, a car)
//             --seconds S        length of the reel, default 14
//
// Opens the site in Chromium, captures the bare map canvas the way scripts/share-mockups.mjs
// does (map resized to the export size / 2, pixel ratio 2, read in the `render` event), and
// frames it with HTML in the app's font. Feed pictures are 4:5 (1080 × 1350): the Instagram API
// takes 4:5 to 1.91:1 only, and the frame keeps its text out of the strips the 3:4 profile grid
// cuts off. The reel needs ffmpeg on the PATH.
//
// Env: CHROMIUM_PATH, HTTPS_PROXY as for scripts/smoke.mjs.

import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
};
const POST = process.argv[2];
if (!['storm', 'intro', 'island', 'fallen', 'weekend', 'track'].includes(POST)) {
  console.error('usage: node scripts/social.mjs storm|intro|island|fallen|weekend|track [--site URL] [--out DIR] [--gpx FILE]');
  process.exit(2);
}
if (POST === 'track' && !arg('gpx')) {
  console.error('usage: node scripts/social.mjs track --gpx FILE [--title TEXT] [--kind TEXT] [--date YYYY-MM-DD] [--trim M] [--seconds S]');
  process.exit(2);
}
const QUICK = process.argv.includes('--quick');
const SITE = arg('site', 'https://cimamap.com/').replace(/\/?$/, '/');
const TZ = 'Europe/Rome';
const today = new Date().toLocaleDateString('en-CA', { timeZone: TZ });
const outDir = path.resolve(arg('out', `social/posts/${today}-${POST}`));
await mkdir(outDir, { recursive: true });

const when = (iso, opts) => new Date(iso).toLocaleString('en-GB', { timeZone: TZ, ...opts });
const dayTime = (iso) => `${when(iso, { weekday: 'short', day: 'numeric', month: 'short' })}, ${when(iso, { hour: '2-digit', minute: '2-digit' })}`;
const dayOnly = (iso) => when(iso, { weekday: 'short', day: 'numeric', month: 'short' });

// --- Browser ---------------------------------------------------------------------------------

const browser = await chromium.launch({
  // The cloud sessions' Chromium, else Playwright's own; on a Mac, CHROMIUM_PATH can point at
  // "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome".
  executablePath: process.env.CHROMIUM_PATH || (existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined),
  args: [
    ...(process.env.HTTPS_PROXY ? [`--proxy-server=${process.env.HTTPS_PROXY}`, '--proxy-bypass-list=localhost;127.0.0.1'] : []),
    '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist',
  ],
});
const mapPage = await (await browser.newContext({ viewport: { width: 1440, height: 1000 }, ignoreHTTPSErrors: true })).newPage();
mapPage.on('pageerror', (e) => console.log('pageerror', e.message));
// Through the browser, so it takes the same proxy as the map.
const data = async (name) => (await mapPage.goto(`${SITE}data/${name}?t=${Date.now()}`)).json();

/**
 * The bare map for `hash` at `size` (export pixels). `camera` is zoom/lat/lon/bearing/pitch for
 * that size (zoom as the export would show it, not the screen), `labels` 'none', 'summits' or 'orient' (see openMap).
 */
async function capture({ hash, size, camera, labels = 'summits' }) {
  await openMap({ hash, size, labels });
  return shoot(camera, 600);
}

/**
 * Frames of a camera move over one map state, for a reel. The page loads once; each camera is a
 * jump, an idle wait and a read, so after the first frame the tiles mostly come from the cache.
 */
async function fly({ hash, size, cameras, labels = 'none', textScale = 1, setup, before }) {
  await openMap({ hash, size, labels, textScale });
  // `setup` once after the map is open, `before(i)` ahead of each frame (both on the map page).
  if (setup) await setup();
  const out = [];
  for (const [i, cam] of cameras.entries()) {
    if (before) await before(i);
    out.push(await shoot(cam, i === 0 ? 600 : 0));
    if (i % 25 === 0) console.log(`flight frame ${i + 1}/${cameras.length}`);
  }
  return out;
}

async function openMap({ hash, size, labels, textScale = 1 }) {
  await mapPage.goto('about:blank');
  // `?count=off` is not needed: automated browsers are never counted (web/src/app/analytics.ts).
  await mapPage.goto(`${SITE}${hash}`, { waitUntil: 'load' });
  await mapPage.waitForFunction(() => document.body.dataset.mapReadyMs, null, { timeout: 120_000 });
  await mapPage.evaluate(
    async ({ size: [w, h], labels, textScale }) => {
      const RATIO = 2;
      const map = window.__snowmap.map;
      const idle = () => new Promise((r) => (map.loaded() && map.areTilesLoaded() ? r() : map.once('idle', r)));
      await idle();
      const el = map.getContainer();
      Object.assign(el.style, { position: 'fixed', left: '0', top: '0', width: `${w / RATIO}px`, height: `${h / RATIO}px`, zIndex: '0' });
      map.setPixelRatio(RATIO);
      map.setMinZoom(5);
      // A number, or the outputs of a zoom interpolation, times k (a zoom expression cannot be
      // wrapped in a product).
      const times = (v, k) => (typeof v === 'number' ? v * k : Array.isArray(v) && v[0] === 'interpolate' ? v.map((x, i) => (i >= 4 && i % 2 === 0 && typeof x === 'number' ? x * k : x)) : v);
      // 'orient': what tells a viewer where they are, the mountain groups, the valleys and the
      // towns over about 13,000 people (Bozen, Meran, Brixen, Bruneck, Leifers).
      const ORIENT = ['mountain-ranges', 'valleys', 'places_locality'];
      for (const l of map.getStyle().layers) {
        if (l.type !== 'symbol' || map.getLayoutProperty(l.id, 'visibility') === 'none') continue;
        // 'summits': the map's own names only (mountain groups, valleys, summits); OSM town, road
        // and water names are noise in a picture.
        // 'local': close up along a tour, the summits and the villages (not the hamlets and farms).
        const hide = labels === 'none' || (labels === 'orient' ? !ORIENT.includes(l.id) : labels === 'local' ? ![...ORIENT, 'summits'].includes(l.id) : l.source === 'protomaps');
        if (hide) map.setLayoutProperty(l.id, 'visibility', 'none');
        else {
          if (l.id === 'places_locality' && labels === 'orient') map.setFilter(l.id, ['all', l.filter ?? true, ['>=', ['to-number', ['get', 'population'], 0], 13000]]);
          if (l.id === 'places_locality' && labels === 'local') map.setFilter(l.id, ['all', l.filter ?? true, ['in', ['get', 'kind_detail'], ['literal', ['city', 'town', 'village']]]]);
          if (textScale === 1) continue;
          // Map text is sized for a screen held close; a reel is watched smaller.
          map.setLayoutProperty(l.id, 'text-size', times(map.getLayoutProperty(l.id, 'text-size') ?? 16, textScale));
          map.setPaintProperty(l.id, 'text-halo-width', (map.getPaintProperty(l.id, 'text-halo-width') ?? 1) * textScale);
          if (map.getLayoutProperty(l.id, 'icon-image')) map.setLayoutProperty(l.id, 'icon-size', (map.getLayoutProperty(l.id, 'icon-size') ?? 1) * textScale);
        }
      }
      map.resize();
      window.__shoot = async ([zoom, lat, lon, bearing, pitch], settleMs) => {
        // The camera is given for the export; the canvas is half as wide in CSS pixels.
        map.jumpTo({ center: [lon, lat], zoom: zoom - 1, bearing, pitch });
        await new Promise((r) => map.once('idle', r));
        if (settleMs) await new Promise((r) => setTimeout(r, settleMs));
        await idle();
        const c = Object.assign(document.createElement('canvas'), { width: w, height: h });
        await new Promise((r) => {
          map.once('render', () => {
            c.getContext('2d').drawImage(map.getCanvas(), 0, 0, w, h);
            r();
          });
          map.triggerRepaint();
        });
        return c.toDataURL('image/jpeg', 0.93);
      };
    },
    { size, labels, textScale },
  );
}
const shoot = (camera, settleMs) => mapPage.evaluate(([c, s]) => window.__shoot(c, s), [camera, settleMs]);

// --- Frames ----------------------------------------------------------------------------------

const font = async (wt) => (await readFile(`node_modules/@fontsource/barlow/files/barlow-latin-${wt}-normal.woff2`)).toString('base64');
const fontCss = (await Promise.all([400, 500, 600, 700].map(async (wt) => `@font-face{font-family:Barlow;font-weight:${wt};src:url(data:font/woff2;base64,${await font(wt)}) format('woff2')}`))).join('');
const iconSvg = (await readFile('web/public/icons/icon.svg', 'utf8')).replace(/<!--.*?-->/s, '');
const iconUri = `data:image/svg+xml;base64,${Buffer.from(iconSvg).toString('base64')}`;

// shared/snowColors.ts, without the bare class.
const RAMP = ['#a9d4f5', '#6fb1ea', '#3b86d6', '#1f5cb4', '#183a87', '#4b1a83'];
const TICKS = ['1', '5', '20', '50', '100', '200'];

const CSS = `${fontCss}
*{box-sizing:border-box;margin:0}
body{width:var(--w);height:var(--h);font-family:Barlow,sans-serif;color:#16202a;overflow:hidden;position:relative;-webkit-font-smoothing:antialiased;background:transparent}
.map{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
.abs{position:absolute}
.sky{left:0;right:0;top:0;background:linear-gradient(rgba(255,255,255,.92),rgba(255,255,255,.6) 55%,rgba(255,255,255,0))}
.scrim{left:0;right:0;bottom:0;background:linear-gradient(rgba(12,22,34,0),rgba(12,22,34,.62) 34%,rgba(12,22,34,.86))}
.title{font-weight:700;letter-spacing:-.01em;line-height:1.02}
.sub{font-weight:500;color:#3a4550}
.white{color:#fff}.dim{color:rgba(255,255,255,.8)}
.big{font-weight:700;line-height:1;color:#fff}
.cap{font-weight:500;color:rgba(255,255,255,.78);text-transform:uppercase;letter-spacing:.06em}
.brand{display:flex;align-items:center;font-weight:600;color:#fff}
.legend{display:grid;font-weight:500;color:rgba(255,255,255,.88)}
.lg-bar{display:flex;overflow:hidden}.lg-bar i{flex:1}
.lg-ticks{display:flex;justify-content:space-between}
.chip{display:inline-flex;align-items:center;background:#2563c9;color:#fff;font-weight:600;border-radius:999px}
`;

const brand = (u = 1) => `<div class="brand" style="gap:${14 * u}px;font-size:${30 * u}px"><img src="${iconUri}" style="width:${50 * u}px;height:${50 * u}px;border-radius:${12 * u}px"><span>Cima Map<br><span style="font-weight:500;font-size:${23 * u}px;opacity:.8">cimamap.com</span></span></div>`;
const legend = (label, u = 1) => `<div class="legend" style="gap:${8 * u}px;font-size:${21 * u}px"><span>${label}</span>
  <span class="lg-bar" style="height:${14 * u}px;border-radius:${7 * u}px">${RAMP.map((c) => `<i style="background:${c}"></i>`).join('')}</span>
  <span class="lg-ticks">${TICKS.map((t) => `<b style="font-weight:500">${t}</b>`).join('')}</span></div>`;
const credit = (extra) => `© OpenStreetMap contributors, © Mapterhorn${extra}. Not for avalanche decisions: avalanche.report`;

const framePage = await (await browser.newContext({ viewport: { width: 1080, height: 1350 }, deviceScaleFactor: 1 })).newPage();
async function frame(file, [w, h], body, { transparent = false } = {}, attempt = 1) {
  try {
    await framePage.setViewportSize({ width: w, height: h });
    await framePage.setContent(`<!doctype html><html><head><meta charset="utf-8"><style>${CSS}</style></head><body style="--w:${w}px;--h:${h}px">${body}</body></html>`, { waitUntil: 'load' });
    await framePage.evaluate(() => document.fonts.ready);
    const png = file.endsWith('.png');
    await framePage.screenshot({ path: file, type: png ? 'png' : 'jpeg', ...(png ? { omitBackground: transparent } : { quality: 88 }) });
  } catch (e) {
    // A reel makes hundreds of these; one stalled screenshot (a Mac that slept) should not lose
    // the flight rendered before it.
    if (attempt >= 3 || e.name !== 'TimeoutError') throw e;
    console.log(`retrying ${path.basename(file)} after ${e.message.split('\n')[0]}`);
    return frame(file, [w, h], body, { transparent }, attempt + 1);
  }
  console.log(`made ${path.relative(process.cwd(), file)}`);
}
const img = (uri) => `<img class="map" src="${uri}">`;

// --- Views -----------------------------------------------------------------------------------

const TERRAIN = 'hillshade,relief';
// South Tyrol as a block on a plain floor; the camera for 1080 px wide.
const ISLAND_45 = [7.72, 46.6, 11.45, 0, 34];
const ISLAND_STORY = [7.6, 46.62, 11.45, 0, 40];

// --- Posts -----------------------------------------------------------------------------------

if (POST === 'storm') {
  const fc = await data('forecast.json');
  if (!fc.available || !fc.frames?.length) throw new Error('No forecast on the site');
  const frames = fc.frames;
  // The post ends where the snow stops growing: a forecast that runs on for two dry days would
  // otherwise hold the same number for a third of the reel and date the total too late.
  const peak = frames.at(-1).maxCm;
  const last = frames.findIndex((f) => f.maxCm >= peak);
  const first = Math.max(0, frames.findIndex((f) => f.maxCm > 0) - 1);
  const until = dayTime(frames[last].time);
  const span = `${dayOnly(frames[0].time)} to ${until}`;
  const fcCredit = credit(', forecast Open-Meteo (CC BY 4.0)');
  const hash = (k, layers = `forecast,${TERRAIN},island`) => `#map=8/46.6/11.45/0/30&layers=${layers}&f=${k}`;

  // Cover still, 4:5.
  if (!QUICK) {
  const cover = await capture({ hash: hash(last), size: [1080, 1350], camera: ISLAND_45, labels: 'none' });
  await frame(path.join(outDir, 'cover-4x5.jpg'), [1080, 1350], `${img(cover)}
    <div class="abs sky" style="height:360px"></div>
    <div class="abs" style="left:80px;right:80px;top:70px">
      <div class="title" style="font-size:80px">Up to ${peak} cm<br>of new snow</div>
      <div class="sub" style="font-size:31px;margin-top:16px">Forecast for South Tyrol, ${span}</div>
    </div>
    <div class="abs scrim" style="height:330px"></div>
    <div class="abs" style="left:80px;right:80px;bottom:52px">
      <div style="display:flex;align-items:flex-end;justify-content:space-between;gap:40px">${brand()}<div style="width:380px">${legend('New snow, cm')}</div></div>
      <div class="dim" style="font-size:16px;margin-top:18px">${fcCredit}</div>
    </div>`);

  // Story, 9:16: the same, with room for the link sticker at the bottom.
  const story = await capture({ hash: hash(last), size: [1080, 1920], camera: ISLAND_STORY, labels: 'none' });
  await frame(path.join(outDir, 'story-9x16.jpg'), [1080, 1920], `${img(story)}
    <div class="abs sky" style="height:620px"></div>
    <div class="abs" style="left:80px;right:80px;top:270px">
      <div class="title" style="font-size:96px">Up to ${peak} cm<br>of new snow</div>
      <div class="sub" style="font-size:36px;margin-top:18px">Forecast for South Tyrol, ${span}</div>
    </div>
    <div class="abs scrim" style="height:760px;background:linear-gradient(rgba(12,22,34,0),rgba(12,22,34,.7) 34%,rgba(12,22,34,.82) 70%,rgba(12,22,34,.5))"></div>
    <div class="abs" style="left:80px;right:80px;bottom:400px">
      <div style="width:460px;margin-bottom:34px">${legend('New snow, cm', 1.15)}</div>
      ${brand(1.1)}
      <div class="dim" style="font-size:18px;margin-top:18px">${fcCredit}</div>
    </div>`);

  }

  // Reel, 9:16: one capture per forecast step from just before the snow starts, a closer and
  // tilted camera so the terrain reads in 3D, blended into a video with a slow push in.
  // Without the island cut, so the terrain fills the tall frame to its edges.
  const reelCam = [9.05, 46.6, 11.5, -10, 50];
  const tmp = path.join(outDir, '.reel');
  await rm(tmp, { recursive: true, force: true });
  await mkdir(tmp);
  const steps = [];
  // --quick: the first and the last step only, to check the camera and the text.
  for (let k = first; k <= last; k++) if (!QUICK || k === first || k === last) steps.push(k);
  // Hold the start a little, and the end long enough to read the address.
  const seq = [steps[0], steps[0], ...steps, ...Array(7).fill(last)];
  const shots = {};
  for (const k of steps) {
    const t0 = Date.now();
    shots[k] = await capture({ hash: hash(k, `forecast,${TERRAIN}`), size: [1080, 1920], camera: reelCam, labels: 'none' });
    console.log(`reel frame ${k}/${last} in ${Date.now() - t0} ms`);
  }
  for (const [i, k] of seq.entries()) {
    const end = i >= seq.length - 5;
    await writeFile(path.join(tmp, `map-${String(i).padStart(3, '0')}.jpg`), Buffer.from(shots[k].split(',')[1], 'base64'));
    await frame(path.join(tmp, `ov-${String(i).padStart(3, '0')}.png`), [1080, 1920], `
      <div class="abs sky" style="height:560px"></div>
      <div class="abs" style="left:80px;right:80px;top:250px">
        <div class="title" style="font-size:72px">Snow is coming<br>to South Tyrol</div>
        <div class="sub" style="font-size:34px;margin-top:16px">Forecast, ${dayTime(frames[k].time)}</div>
      </div>
      <div class="abs scrim" style="height:820px"></div>
      <div class="abs" style="left:80px;right:180px;bottom:430px">
        <div class="cap" style="font-size:26px;margin-bottom:12px">New snow, most anywhere</div>
        <div class="big" style="font-size:150px">${frames[k].maxCm} cm</div>
        ${end ? `<div style="margin-top:34px">${brand(1.25)}</div><div class="dim" style="font-size:30px;margin-top:20px">Free, in your browser</div>` : `<div style="width:440px;margin-top:34px">${legend('New snow, cm', 1.1)}</div>`}
      </div>
      <div class="abs dim" style="left:80px;right:180px;bottom:350px;font-size:17px">${fcCredit}</div>`, { transparent: true });
  }
  // About 6 s for the build-up, however many forecast steps the storm spans.
  const STEP = Math.min(0.7, Math.max(0.42, 6 / steps.length));
  execFileSync('ffmpeg', [
    '-y', '-loglevel', 'error',
    '-framerate', String(1 / STEP), '-i', path.join(tmp, 'map-%03d.jpg'),
    '-framerate', String(1 / STEP), '-i', path.join(tmp, 'ov-%03d.png'),
    '-filter_complex',
    // Blend between forecast steps, push in slowly (scaled up first so the crop does not jitter),
    // then lay the text on top.
    `[0:v]scale=2160:3840,framerate=fps=30:interp_start=0:interp_end=255:scene=100,zoompan=z='1+0.0009*on':x='iw/2-(iw/zoom/2)':y='ih*0.55-(ih/zoom*0.55)':d=1:s=1080x1920:fps=30[m];` +
    `[1:v]fps=30[o];[m][o]overlay=0:0:shortest=1,format=yuv420p[v]`,
    '-map', '[v]', '-c:v', 'libx264', '-preset', 'slow', '-crf', '19', '-movflags', '+faststart', '-r', '30',
    path.join(outDir, 'reel-9x16.mp4'),
  ]);
  console.log(`made ${path.relative(process.cwd(), path.join(outDir, 'reel-9x16.mp4'))} (${(seq.length * STEP).toFixed(1)} s)`);
  // A still from the end of the reel, for the cover in the grid.
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-sseof', '-0.5', '-i', path.join(outDir, 'reel-9x16.mp4'), '-frames:v', '1', '-q:v', '3', path.join(outDir, 'reel-end.jpg')]);
  await rm(tmp, { recursive: true, force: true });
  await writeFile(path.join(outDir, 'data.json'), `${JSON.stringify({ site: SITE, forecastGeneratedAt: fc.generatedAt, peakCm: peak, until: frames[last].time, firstFrame: first }, null, 1)}\n`);
}

if (POST === 'island' || POST === 'intro') {
  const sat = await data('satellite.json');
  const satDay = sat.available ? dayOnly(`${sat.date}T12:00:00Z`) : null;
  const satCredit = credit(POST === 'island' ? ', snow Copernicus Sentinel-2' : ', snow from stations and Copernicus Sentinel-2');

  // The island post shows what the satellite saw; the carousel the depth estimate, which reads
  // at a glance in blue even when the satellite's last clear day had little snow.
  const islandLayer = POST === 'island' ? 'snow' : 'depth';
  const island = await capture({ hash: `#map=8/46.6/11.45/0/30&layers=${islandLayer},${TERRAIN},island`, size: [1080, 1350], camera: ISLAND_45, labels: 'none' });
  const islandBody = (title, sub) => `${img(island)}
    <div class="abs sky" style="height:340px"></div>
    <div class="abs" style="left:80px;right:80px;top:70px">
      <div class="title" style="font-size:80px">${title}</div>
      <div class="sub" style="font-size:31px;margin-top:16px">${sub}</div>
    </div>
    <div class="abs scrim" style="height:260px"></div>
    <div class="abs" style="left:80px;right:80px;bottom:52px">${brand()}<div class="dim" style="font-size:16px;margin-top:18px">${satCredit}</div></div>`;

  if (POST === 'island') {
    await frame(path.join(outDir, 'island-4x5.jpg'), [1080, 1350], islandBody('South Tyrol', `Snow seen from space, ${satDay}`));
  } else {
    // 1. Cover: what it is.
    await frame(path.join(outDir, '1-cover.jpg'), [1080, 1350], islandBody('Where is the snow<br>in South Tyrol?', 'A 3D map with the snow on the real terrain'));

    const fc = await data('forecast.json');
    const lastFrame = Math.max(0, (fc.frames?.length ?? 1) - 1);
    // 2–5. One thing per slide: a 3D view, a title and one line.
    const slides = [
      { n: 2, layers: `snow,${TERRAIN},labels,basemap`, cam: [11.3, 46.5, 10.6, 25, 64], title: 'Seen from space', sub: `Sentinel-2 snow cover at about 60 m, last clear look ${satDay}`, extra: ', snow Copernicus Sentinel-2' },
      { n: 3, layers: `stations,depth,${TERRAIN},labels,basemap`, cam: [10.6, 46.72, 11.1, 15, 55], title: 'Measured on the ground', sub: 'About 350 weather stations: snow depth, new snow, wind, temperature', extra: ', stations avalanche.report and Province of Bolzano' },
      { n: 4, layers: `forecast,${TERRAIN},basemap`, cam: [10.4, 46.62, 11.55, 0, 55], title: 'Forecast, hour by hour', sub: 'New snow for the next 3 days on the terrain', extra: ', forecast Open-Meteo (CC BY 4.0)', f: lastFrame },
      // Mid-afternoon in late November: long shadows, lit slopes facing south-west.
      { n: 5, layers: `sun,${TERRAIN},labels,basemap`, cam: [12.2, 46.51, 11.85, 160, 62], title: 'Sun and shade', sub: 'The real ridges cast the shadows, for any day and time', extra: '', sun: `${today}T13:30Z` },
    ];
    for (const s of slides) {
      const shot = await capture({ hash: `#map=10/46.6/11.45/0/50&layers=${s.layers}${s.f !== undefined ? `&f=${s.f}` : ''}${s.sun ? `&sun=${s.sun}` : ''}`, size: [1080, 1350], camera: s.cam, labels: 'summits' });
      await frame(path.join(outDir, `${s.n}-${s.title.split(' ')[0].replace(/\W/g, '').toLowerCase()}.jpg`), [1080, 1350], `${img(shot)}
        <div class="abs sky" style="height:330px"></div>
        <div class="abs" style="left:80px;right:80px;top:70px">
          <div class="title" style="font-size:76px">${s.title}</div>
          <div class="sub" style="font-size:31px;margin-top:16px">${s.sub}</div>
        </div>
        <div class="abs scrim" style="height:200px"></div>
        <div class="abs dim" style="left:80px;right:80px;bottom:46px;font-size:16px">${credit(s.extra)}</div>`);
    }

    // 6. The call to action, on the island again.
    await frame(path.join(outDir, '6-open.jpg'), [1080, 1350], `${img(island)}
      <div class="abs" style="inset:0;background:rgba(12,22,34,.55)"></div>
      <div class="abs" style="left:80px;right:80px;top:0;bottom:0;display:flex;flex-direction:column;justify-content:center;gap:36px">
        <div class="title white" style="font-size:84px">Free, in your browser.<br>No account.</div>
        <div class="dim" style="font-size:36px;line-height:1.35">Updated three times a day.<br>Tap the snow anywhere for the forecast at that height.</div>
        <div>${brand(1.5)}</div>
      </div>
      <div class="abs dim" style="left:80px;right:80px;bottom:46px;font-size:16px">${satCredit}</div>`);
  }
}

if (POST === 'fallen') {
  const st = await data('stations.json');
  // South Tyrol and the ridges around it, where the island shows terrain.
  const [w, s, e, n] = [10.3, 46.2, 12.6, 47.15];
  const rows = st.stations
    .filter((x) => x.lon >= w && x.lon <= e && x.lat >= s && x.lat <= n && x.snowDepthCm !== null && x.snowChange72hCm > 0)
    .sort((a, b) => b.snowChange72hCm - a.snowChange72hCm)
    .slice(0, 6);
  if (!rows.length) throw new Error('No station measured new snow in the last 72 hours');
  const observed = rows.map((x) => x.observedAt).sort().at(-1);
  const top = Math.round(rows[0].snowChange72hCm);
  // German and Italian names as the map writes them: "Rinner Scharte / Passo Romano".
  const name = (x) => x.name.replace(/\s*\(.*?\)\s*/g, ' ').replace(/\s+-\s+/g, ' / ').trim();
  const list = (u) => rows.map((x) => `<div style="display:flex;justify-content:space-between;align-items:baseline;gap:${24 * u}px;padding:${12 * u}px 0;border-top:${2 * u}px solid rgba(255,255,255,.16)">
      <span style="font-size:${30 * u}px;font-weight:600;color:#fff;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${name(x)} <span style="font-weight:500;color:rgba(255,255,255,.7)">${x.elevation.toLocaleString('en')} m</span></span>
      <b style="font-size:${40 * u}px;color:#fff;font-weight:700">+${Math.round(x.snowChange72hCm)} cm</b></div>`).join('');
  const stCredit = credit(', stations avalanche.report and Province of Bolzano, depth estimate Cima Map');
  const shot = await capture({ hash: `#map=8/46.6/11.45/0/30&layers=depth,${TERRAIN},island`, size: [1080, 1350], camera: [7.72, 46.3, 11.45, 0, 34], labels: 'none' });
  await frame(path.join(outDir, 'fallen-4x5.jpg'), [1080, 1350], `${img(shot)}
    <div class="abs sky" style="height:330px"></div>
    <div class="abs" style="left:80px;right:80px;top:70px">
      <div class="title" style="font-size:80px">Up to ${top} cm<br>in 72 hours</div>
      <div class="sub" style="font-size:31px;margin-top:16px">New snow at the stations, to ${dayTime(observed)}</div>
    </div>
    <div class="abs scrim" style="height:700px;background:linear-gradient(rgba(12,22,34,0),rgba(12,22,34,.78) 22%,rgba(12,22,34,.9))"></div>
    <div class="abs" style="left:80px;right:80px;bottom:52px">
      <div style="margin-bottom:30px">${list(1)}</div>
      ${brand()}
      <div class="dim" style="font-size:16px;margin-top:18px">${stCredit}</div>
    </div>`);
  // Story, 9:16: the top four, the rest of the frame free for the link and a poll.
  const tall = await capture({ hash: `#map=8/46.6/11.45/0/30&layers=depth,${TERRAIN},island`, size: [1080, 1920], camera: ISLAND_STORY, labels: 'none' });
  const four = rows.slice(0, 4);
  await frame(path.join(outDir, 'story-9x16.jpg'), [1080, 1920], `${img(tall)}
    <div class="abs sky" style="height:620px"></div>
    <div class="abs" style="left:80px;right:80px;top:270px">
      <div class="title" style="font-size:96px">Up to ${top} cm<br>in 72 hours</div>
      <div class="sub" style="font-size:34px;margin-top:18px">New snow at the stations, to ${dayTime(observed)}</div>
    </div>
    <div class="abs scrim" style="height:820px;background:linear-gradient(rgba(12,22,34,0),rgba(12,22,34,.8) 26%,rgba(12,22,34,.88) 70%,rgba(12,22,34,.55))"></div>
    <div class="abs" style="left:80px;right:80px;bottom:420px">
      ${four.map((x) => `<div style="display:flex;justify-content:space-between;align-items:baseline;gap:24px;padding:14px 0;border-top:2px solid rgba(255,255,255,.16)"><span style="font-size:34px;font-weight:600;color:#fff;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${name(x).split(' / ')[0]}</span><b style="font-size:46px;color:#fff">+${Math.round(x.snowChange72hCm)} cm</b></div>`).join('')}
      <div style="margin-top:30px">${brand(1.1)}</div>
      <div class="dim" style="font-size:18px;margin-top:16px">${stCredit}</div>
    </div>`);
  await writeFile(path.join(outDir, 'data.json'), `${JSON.stringify({ site: SITE, stationsGeneratedAt: st.generatedAt, rows: rows.map((x) => ({ id: x.id, name: x.name, elevation: x.elevation, snowChange72hCm: x.snowChange72hCm, snowDepthCm: x.snowDepthCm, observedAt: x.observedAt })) }, null, 1)}\n`);
}

if (POST === 'weekend') {
  // One after the other: both load in the same page.
  const st = await data('stations.json');
  const fc = await data('forecast.json');
  if (st.stale) throw new Error('The stations on the site are stale');

  // The coming weekend in South Tyrol's time: tomorrow and the day after on a Friday.
  const localDay = (iso) => new Date(iso).toLocaleDateString('en-CA', { timeZone: TZ });
  const addDay = (ymd, n) => new Date(Date.parse(`${ymd}T12:00:00Z`) + n * 864e5).toISOString().slice(0, 10);
  const wd = new Date(`${today}T12:00:00Z`).getUTCDay();
  const sat = addDay(today, wd === 0 ? -1 : (6 - wd + 7) % 7);
  const sun = addDay(sat, 1);
  const short = (ymd, month = true) => new Date(`${ymd}T12:00:00Z`).toLocaleDateString('en-GB', { timeZone: 'UTC', weekday: 'short', day: 'numeric', ...(month ? { month: 'short' } : {}) });
  const weekend = `${short(sat, false)} and ${short(sun)}`;

  // Snow on the ground: the median of the stations within 250 m of each height, in and around
  // South Tyrol (the area of the island), from readings of the last day.
  const [w, s, e, n] = [10.3, 46.2, 12.6, 47.15];
  const fresh = Date.parse(st.generatedAt) - 24 * 3600e3;
  const near = st.stations.filter((x) => x.lon >= w && x.lon <= e && x.lat >= s && x.lat <= n && x.snowDepthCm !== null && x.observedAt && Date.parse(x.observedAt) >= fresh);
  const median = (xs) => { const v = [...xs].sort((a, b) => a - b); return v.length % 2 ? v[(v.length - 1) / 2] : (v[v.length / 2 - 1] + v[v.length / 2]) / 2; };
  const ladder = [2500, 2000, 1500].map((h) => {
    const at = near.filter((x) => Math.abs(x.elevation - h) <= 250).map((x) => x.snowDepthCm);
    return { h, n: at.length, cm: at.length >= 4 ? Math.round(median(at) / 5) * 5 : null };
  }).filter((r) => r.cm !== null);
  if (!ladder.length) throw new Error('Too few stations with a snow depth');
  const observed = near.map((x) => x.observedAt).sort().at(-1);

  // New snow forecast from now to the end of Sunday (the most anywhere).
  if (!fc.available || !fc.frames?.length) throw new Error('No forecast on the site');
  const toSun = fc.frames.filter((f) => localDay(f.time) <= sun);
  const lastFrame = toSun.at(-1) ?? fc.frames[0];
  const newCm = Math.round(lastFrame.maxCm);
  const forecastLine = newCm >= 10 ? 'Snow on the way' : newCm >= 3 ? 'A little new snow' : 'Hardly any new snow';

  const wkCredit = credit(', stations avalanche.report and Province of Bolzano, forecast Open-Meteo (CC BY 4.0)');
  const ladderRows = (u, dark = true) => ladder.map((r) => `<div style="display:flex;justify-content:space-between;align-items:baseline;padding:${12 * u}px 0;border-top:${2 * u}px solid rgba(255,255,255,.16)">
      <span style="font-size:${34 * u}px;font-weight:600;color:#fff">${r.h.toLocaleString('en')} m</span>
      <b style="font-size:${56 * u}px;color:#fff;font-weight:700">${r.cm} cm</b></div>`).join('');

  // Reel, 9:16: a slow turn over South Tyrol on the depth estimate; the text in three beats.
  // Every frame of the video is a render: blending fewer renders up to 30 fps reads as stutter.
  // --quick renders 3 a second to check the text and the labels.
  const FPS = QUICK ? 3 : 30;
  const SECONDS = 11;
  const count = Math.round(FPS * SECONDS);
  // Gentle in and out, mostly an even turn.
  const ease = (t) => t - Math.sin(2 * Math.PI * t) / (2 * Math.PI) * 0.35;
  const lerp = (a, b, t) => a + (b - a) * t;
  // Close enough that the snow fills the frame, looking north-east so the edge of the data stays
  // out of sight: from Ulten over Meran towards the Sarntal Alps. Zoom and tilt stay fixed, so the
  // terrain tiles keep their detail level and the mountains do not pop; the camera only turns
  // and drifts.
  const [c0, c1] = [[9.7, 46.53, 10.98, 4, 60], [9.7, 46.6, 11.28, 34, 60]];
  const cameras = Array.from({ length: count }, (_, i) => c0.map((v, j) => lerp(v, c1[j], ease(i / (count - 1)))));
  const t0 = Date.now();
  // Mountain groups, valleys in German and Italian and the main towns,
  // larger than on screen, so a viewer knows where it is.
  const shots = await fly({ hash: `#map=8/46.6/11.45/0/30&layers=depth,${TERRAIN},labels`, size: [1080, 1920], cameras, labels: 'orient', textScale: 1.6 });
  console.log(`flight of ${count} frames in ${((Date.now() - t0) / 1000).toFixed(0)} s`);

  const beats = [
    { until: 4.6, body: `<div class="cap" style="font-size:26px;margin-bottom:10px">Snow on the ground now</div>${ladderRows(1)}
      <div class="dim" style="font-size:22px;margin-top:14px">Typical depth at the weather stations, ${dayTime(observed)}</div>` },
    { until: 7.8, body: `<div class="cap" style="font-size:26px;margin-bottom:12px">New snow forecast to Sunday</div>
      <div class="big" style="font-size:150px">${newCm <= 0 ? 'None' : `${newCm} cm`}</div>
      <div class="dim" style="font-size:30px;margin-top:14px">${forecastLine}: the most anywhere,<br>forecast as of ${dayTime(fc.fetchedAt ?? fc.generatedAt)}</div>` },
    { until: Infinity, body: `<div class="title white" style="font-size:64px;margin-bottom:34px">Check the snow<br>at your height</div>${brand(1.25)}
      <div class="dim" style="font-size:30px;margin-top:20px">Free, in your browser</div>` },
  ];
  const tmp = path.join(outDir, '.reel');
  await rm(tmp, { recursive: true, force: true });
  await mkdir(tmp);
  // One overlay per beat, faded in over its first frames; frames copy the overlay they need.
  const FADE = Math.max(1, Math.round(FPS * 0.3));
  const made = new Map();
  const overlay = async (b, alpha) => {
    const key = `${b}-${alpha.toFixed(2)}`;
    if (!made.has(key)) {
      const file = path.join(tmp, `beat-${key}.png`);
      await frame(file, [1080, 1920], `
        <div class="abs sky" style="height:560px"></div>
        <div class="abs" style="left:80px;right:80px;top:250px">
          <div class="title" style="font-size:80px">Snow this weekend</div>
          <div class="sub" style="font-size:34px;margin-top:16px">South Tyrol, ${weekend}</div>
        </div>
        <div class="abs scrim" style="height:980px;background:linear-gradient(rgba(12,22,34,0),rgba(12,22,34,.9) 24%,rgba(12,22,34,.96))"></div>
        <div class="abs" style="left:80px;right:180px;bottom:430px;opacity:${alpha}">${beats[b].body}</div>
        <div class="abs dim" style="left:80px;right:180px;bottom:350px;font-size:17px">${wkCredit}</div>`, { transparent: true });
      made.set(key, file);
    }
    return made.get(key);
  };
  const beatOf = Array.from({ length: count }, (_, i) => beats.findIndex((x) => i / FPS < x.until));
  for (let i = 0; i < count; i++) {
    const b = beatOf[i];
    const alpha = b === 0 ? 1 : Math.min(1, (i - beatOf.indexOf(b) + 1) / FADE);
    const name = String(i).padStart(3, '0');
    await writeFile(path.join(tmp, `map-${name}.jpg`), Buffer.from(shots[i].split(',')[1], 'base64'));
    await copyFile(await overlay(b, alpha), path.join(tmp, `ov-${name}.png`));
  }
  execFileSync('ffmpeg', [
    '-y', '-loglevel', 'error',
    '-framerate', String(FPS), '-i', path.join(tmp, 'map-%03d.jpg'),
    '-framerate', String(FPS), '-i', path.join(tmp, 'ov-%03d.png'),
    '-filter_complex',
    // The flight as rendered (repeated frames in --quick), the text on top.
    `[0:v]fps=30[m];[1:v]fps=30[o];[m][o]overlay=0:0:shortest=1,format=yuv420p[v]`,
    '-map', '[v]', '-c:v', 'libx264', '-preset', 'slow', '-crf', '19', '-movflags', '+faststart', '-r', '30',
    path.join(outDir, 'reel-9x16.mp4'),
  ]);
  console.log(`made ${path.relative(process.cwd(), path.join(outDir, 'reel-9x16.mp4'))} (${SECONDS} s)`);
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-sseof', '-0.5', '-i', path.join(outDir, 'reel-9x16.mp4'), '-frames:v', '1', '-q:v', '3', path.join(outDir, 'reel-end.jpg')]);
  // Contact sheet of the three beats, to check the text without playing the video.
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', path.join(outDir, 'reel-9x16.mp4'), '-vf', `select='eq(n\\,45)+eq(n\\,180)+eq(n\\,${30 * SECONDS - 10})',scale=360:-1,tile=3x1`, '-frames:v', '1', '-vsync', 'vfr', path.join(tmp, '..', 'reel-sheet.jpg')]);
  await rm(tmp, { recursive: true, force: true });

  // Story, 9:16: the numbers on one picture, room for the link sticker at the bottom.
  if (!QUICK) {
    const tall = await capture({ hash: `#map=8/46.6/11.45/0/30&layers=depth,${TERRAIN},island`, size: [1080, 1920], camera: ISLAND_STORY, labels: 'none' });
    await frame(path.join(outDir, 'story-9x16.jpg'), [1080, 1920], `${img(tall)}
      <div class="abs sky" style="height:620px"></div>
      <div class="abs" style="left:80px;right:80px;top:270px">
        <div class="title" style="font-size:96px">Snow this<br>weekend</div>
        <div class="sub" style="font-size:36px;margin-top:18px">South Tyrol, ${weekend}</div>
      </div>
      <div class="abs scrim" style="height:900px;background:linear-gradient(rgba(12,22,34,0),rgba(12,22,34,.8) 24%,rgba(12,22,34,.88) 70%,rgba(12,22,34,.55))"></div>
      <div class="abs" style="left:80px;right:80px;bottom:420px">
        <div class="cap" style="font-size:26px;margin-bottom:10px">Snow on the ground now</div>
        ${ladderRows(1)}
        <div style="display:flex;justify-content:space-between;align-items:baseline;padding:12px 0;border-top:2px solid rgba(255,255,255,.16)"><span style="font-size:34px;font-weight:600;color:#fff">New snow to Sunday</span><b style="font-size:56px;color:#fff">${newCm <= 0 ? 'none' : `${newCm} cm`}</b></div>
        <div style="margin-top:30px">${brand(1.1)}</div>
        <div class="dim" style="font-size:18px;margin-top:16px">${wkCredit}</div>
      </div>`);
  }
  await writeFile(path.join(outDir, 'data.json'), `${JSON.stringify({ site: SITE, stationsGeneratedAt: st.generatedAt, observedAt: observed, ladder, forecastGeneratedAt: fc.generatedAt, newSnowToSundayCm: newCm, forecastUntil: lastFrame.time, weekend: [sat, sun] }, null, 1)}\n`);
}

if (POST === 'track') {
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
      snow = await mapPage.evaluate(async ({ line, gpxText }) => {
        const { map, gpx } = window.__snowmap;
        let along = null;
        try {
          await gpx.load(gpxText, 'track.gpx');
          for (let k = 0; k < 60 && !(along = gpx.snow()); k++) await new Promise((r) => setTimeout(r, 500));
        } catch (e) {
          console.log('snow along the track:', e.message);
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
        return along && { date: along.date, sensor: along.sensor, day: along.day, route: along.route, points: along.points };
      }, { line: P.map((p) => [p[0], p[1]]), gpxText });
      console.log('snow along the track:', JSON.stringify({ ...snow, points: snow?.points.length }));
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
  const py = (e) => 8 + ((maxE - e) / (maxE - minE || 1)) * (PH - 16);
  const prof = Array.from({ length: 201 }, (_, k) => [px((L * k) / 200), py(at(eleS, (L * k) / 200))]);
  const area = `M0,${PH} ${prof.map(([x, y]) => `L${x.toFixed(1)},${y.toFixed(1)}`).join(' ')} L${PW},${PH} Z`;
  // What the satellite saw along the way, as runs of one state; the app's points are evenly spaced.
  const FILL = { snow: '#f4f7fa', bare: '#a8916f', unseen: 'url(#hatch)', null: 'rgba(255,255,255,.2)' };
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
        ${runs.length ? runs.map((r) => `<rect x="${r.x0.toFixed(1)}" y="0" width="${(r.x1 - r.x0 + 0.6).toFixed(1)}" height="${PH}" fill="${FILL[r.st] ?? FILL.null}"/>`).join('') : `<rect x="0" y="0" width="${px(s).toFixed(1)}" height="${PH}" fill="#7048e8"/>`}
        <rect x="${px(s).toFixed(1)}" y="0" width="${(PW - px(s)).toFixed(1)}" height="${PH}" fill="rgba(12,22,34,.6)"/>
      </g>
      <path d="${prof.map(([x, y], k) => `${k ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ')}" fill="none" stroke="rgba(255,255,255,.9)" stroke-width="3"/>
      <circle cx="${px(s).toFixed(1)}" cy="${py(at(eleS, s)).toFixed(1)}" r="11" fill="#7048e8" stroke="#fff" stroke-width="4"/></svg>
      ${runs.length ? `<div class="dim" style="display:flex;gap:30px;font-size:23px;margin-top:14px;align-items:center">
        <span><i style="display:inline-block;width:26px;height:14px;border-radius:3px;background:${FILL.snow};margin-right:9px"></i>snow${route?.lowestSnowM ? `, from ${num(Math.round(route.lowestSnowM / 10) * 10)} m` : ''}</span>
        <span><i style="display:inline-block;width:26px;height:14px;border-radius:3px;background:${FILL.bare};margin-right:9px"></i>bare</span>
        ${unseenShare >= 0.02 ? `<span><svg width="26" height="14" style="vertical-align:-1px;margin-right:9px"><defs><pattern id="h2" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="8" height="8" fill="rgba(120,132,144,.55)"/><rect width="3" height="8" fill="rgba(255,255,255,.55)"/></pattern></defs><rect width="26" height="14" rx="3" fill="url(#h2)"/></svg>not seen (cloud)</span>` : ''}
      </div>` : ''}`;
  const row = (label, value) => `<div style="display:flex;justify-content:space-between;align-items:baseline;padding:12px 0;border-top:2px solid rgba(255,255,255,.16)">
      <span style="font-size:34px;font-weight:600;color:#fff">${label}</span><b style="font-size:52px;color:#fff;font-weight:700">${value}</b></div>`;
  const live = (s) => `<div style="display:flex;gap:70px;font-variant-numeric:tabular-nums">
      ${hasEle ? `<div><div class="cap" style="font-size:26px;margin-bottom:10px">Height</div><div class="big" style="font-size:104px">${num(at(eleS, s))} m</div></div>` : ''}
      <div><div class="cap" style="font-size:26px;margin-bottom:10px">Distance</div><div class="big" style="font-size:104px">${km(trimM + s)}</div></div></div>
      ${hasEle ? profile(s) : ''}`;
  const end = `<div class="cap" style="font-size:26px;margin-bottom:10px">The ${kind.toLowerCase()}</div>
      ${row('Distance', km(stats.distanceM))}${stats.ascentM !== null ? row('Climb', `${num(stats.ascentM)} m`) : ''}${stats.highestM !== null ? row('Highest point', `${num(stats.highestM)} m`) : ''}
      ${snowLine ? `<div class="dim" style="font-size:28px;margin-top:16px">${snowLine}, ${snowWhen}</div>` : ''}
      <div style="margin-top:36px">${brand(1.25)}</div><div class="dim" style="font-size:30px;margin-top:20px">Put your own GPX on the snow</div>`;
  const trCredit = credit(layers.includes('depth') ? ', snow from stations and Copernicus Sentinel-2' : ', snow Copernicus Sentinel-2');

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
  await writeFile(path.join(outDir, 'data.json'), `${JSON.stringify({ site: SITE, title, kind, date, ...stats, trimM: Math.round(trimM), shownM: Math.round(L), seconds: SECONDS, snow: snow && { ...snow, points: undefined } }, null, 1)}\n`);
}

await browser.close();
