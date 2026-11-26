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
if (!['storm', 'intro', 'island', 'fallen', 'weekend'].includes(POST)) {
  console.error('usage: node scripts/social.mjs storm|intro|island|fallen|weekend [--site URL] [--out DIR]');
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
async function fly({ hash, size, cameras, labels = 'none', textScale = 1 }) {
  await openMap({ hash, size, labels, textScale });
  const out = [];
  for (const [i, cam] of cameras.entries()) {
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
        const hide = labels === 'none' || (labels === 'orient' ? !ORIENT.includes(l.id) : l.source === 'protomaps');
        if (hide) map.setLayoutProperty(l.id, 'visibility', 'none');
        else {
          if (l.id === 'places_locality') map.setFilter(l.id, ['all', l.filter ?? true, ['>=', ['to-number', ['get', 'population'], 0], 13000]]);
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
async function frame(file, [w, h], body, { transparent = false } = {}) {
  await framePage.setViewportSize({ width: w, height: h });
  await framePage.setContent(`<!doctype html><html><head><meta charset="utf-8"><style>${CSS}</style></head><body style="--w:${w}px;--h:${h}px">${body}</body></html>`, { waitUntil: 'load' });
  await framePage.evaluate(() => document.fonts.ready);
  const png = file.endsWith('.png');
  await framePage.screenshot({ path: file, type: png ? 'png' : 'jpeg', ...(png ? { omitBackground: transparent } : { quality: 88 }) });
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

await browser.close();
