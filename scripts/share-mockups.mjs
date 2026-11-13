// Concept mock-ups for the share picture (docs/share-snapshot.md). Not part of the app.
//
// 1. Opens the built app in Chromium and captures the map at each export size the way the app
//    would: the visible map is resized to the export size / 2 and drawn at pixel ratio 2, then
//    read in the `render` event (no preserveDrawingBuffer). This is also the spike for that method.
// 2. Composes the frame styles over the captures with HTML and the app's font (Barlow) and saves
//    JPEGs plus a contact sheet into docs/share-snapshot/.
//
//   npm run build && node scripts/share-mockups.mjs [--out docs/share-snapshot]
//
// The QR code uses `uqr` (the encoder the concept proposes, ~4 KB gzipped) when it can be
// imported; set UQR=/path/to/uqr/dist/index.mjs if it is not installed. Without it a placeholder
// box is drawn. Env: CHROMIUM_PATH, HTTPS_PROXY as for scripts/smoke.mjs.
//
// The pictures use whatever data is in dist/ (fixtures: October 2026, little snow). Numbers that
// the fixtures cannot give (snow along the track) are illustrative and marked as such in the doc.

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
import { preview } from 'vite';

const outIdx = process.argv.indexOf('--out');
const outDir = path.resolve(outIdx >= 0 ? process.argv[outIdx + 1] : 'docs/share-snapshot');
await mkdir(outDir, { recursive: true });

const uqr = await import(process.env.UQR ?? 'uqr').catch(() => null);
const SITE = 'https://adamvalik.github.io/tirol-snow-map/';
const ADDRESS = 'adamvalik.github.io/tirol-snow-map';
const APP_NAME = 'South Tyrol Snow';

// --- Scenes: one capture each, several frames can use it --------------------------------------

const BASE = 'labels,hillshade,relief,basemap';
const scenes = [
  {
    name: 'track',
    hash: `#map=12/46.53/11.6/0/58&layers=${BASE}`,
    size: [1080, 1440],
    gpx: 'fixtures/gpx/track-ele.gpx',
    // Room for the title above and the numbers card below.
    fit: { pitch: 58, padding: { top: 300, bottom: 660, left: 140, right: 140 } },
    summitsOnly: true,
  },
  // The same track for the Minimal frame: only a bar below, so the camera can come closer.
  {
    name: 'track-min',
    hash: `#map=12/46.53/11.6/0/58&layers=${BASE}`,
    size: [1080, 1440],
    gpx: 'fixtures/gpx/track-ele.gpx',
    fit: { pitch: 58, padding: { top: 140, bottom: 340, left: 140, right: 140 } },
  },
  { name: 'dolomites-story', hash: `#map=10.85/46.515/11.86/-25/72&layers=forecast,${BASE}&f=20`, size: [1080, 1920], summitsOnly: true },
  { name: 'dolomites-4x5', hash: `#map=10.95/46.515/11.86/-25/68&layers=forecast,${BASE}&f=20`, size: [1080, 1350], summitsOnly: true },
  { name: 'island', hash: '#map=8.15/46.63/11.46/0/40&layers=forecast,hillshade,relief,island&f=20', size: [1080, 1080], minZoom: 6.5 },
  { name: 'ortler-wide', hash: `#map=11.25/46.47/10.64/35/70&layers=forecast,${BASE}&f=20`, size: [1920, 1080] },
];

// --- Capture ---------------------------------------------------------------------------------

const server = await preview({ preview: { port: 4176, strictPort: true }, logLevel: 'silent' });
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || undefined,
  args: [
    ...(process.env.HTTPS_PROXY ? [`--proxy-server=${process.env.HTTPS_PROXY}`, '--proxy-bypass-list=localhost;127.0.0.1'] : []),
    '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist',
  ],
});
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 }, ignoreHTTPSErrors: true })).newPage();
page.on('pageerror', (e) => console.log('pageerror', e.message));

const shots = {};
for (const s of scenes) {
  // A full load each time: a hash-only change would not reload the app.
  await page.goto('about:blank');
  await page.goto(`http://localhost:4176/${s.hash}`, { waitUntil: 'load' });
  await page.waitForFunction(() => document.body.dataset.mapReadyMs, null, { timeout: 90_000 });
  await page.waitForTimeout(800);
  await page.evaluate(() => window.__snowmap.gpx.remove());
  if (s.gpx) await page.evaluate((t) => window.__snowmap.gpx.load(t, 'tour.gpx'), await readFile(s.gpx, 'utf8'));
  const t0 = Date.now();
  const shot = await page.evaluate(
    async ({ size: [w, h], fit, minZoom, summitsOnly }) => {
      const RATIO = 2;
      const map = window.__snowmap.map;
      const el = map.getContainer();
      const before = { style: el.getAttribute('style') ?? '', ratio: map.getPixelRatio(), width: el.clientWidth };
      const cam = { center: map.getCenter(), zoom: map.getZoom(), pitch: map.getPitch(), bearing: map.getBearing() };
      // The visible map at the export size, behind whatever covers it (the sheet, in the app).
      Object.assign(el.style, { position: 'fixed', left: '0', top: '0', width: `${w / RATIO}px`, height: `${h / RATIO}px` });
      map.setPixelRatio(RATIO);
      // A smaller export than the screen needs a lower zoom for the same ground; the app's
      // minZoom (7.5) would clamp it, so the export lowers it for the capture only.
      const minZoomBefore = map.getMinZoom();
      if (minZoom) map.setMinZoom(minZoom);
      // The track's own label repeats the title, and the frame names the track.
      if (map.getLayer('gpx-label')) map.setLayoutProperty('gpx-label', 'visibility', 'none');
      // Picture labels: the curated summits only, no towns, roads or water names.
      const hidden = [];
      if (summitsOnly) {
        for (const l of map.getStyle().layers) {
          if (l.type === 'symbol' && l.source === 'protomaps' && map.getLayoutProperty(l.id, 'visibility') !== 'none') {
            map.setLayoutProperty(l.id, 'visibility', 'none');
            hidden.push(l.id);
          }
        }
      }
      map.resize();
      // Same ground width as on screen, so what was in view stays in view.
      map.jumpTo({ zoom: cam.zoom + Math.log2(w / RATIO / before.width) });
      const t = window.__snowmap.gpx.track();
      if (fit && t) {
        const all = t.track.lines.flat();
        const lon = all.map((p) => p[0]);
        const lat = all.map((p) => p[1]);
        const [a, z] = [all[0], all[all.length - 1]];
        const r = Math.PI / 180;
        const bearing = (Math.atan2(Math.sin((z[0] - a[0]) * r) * Math.cos(z[1] * r), Math.cos(a[1] * r) * Math.sin(z[1] * r) - Math.sin(a[1] * r) * Math.cos(z[1] * r) * Math.cos((z[0] - a[0]) * r)) / r + 360) % 360;
        const p = fit.padding;
        map.fitBounds([[Math.min(...lon), Math.min(...lat)], [Math.max(...lon), Math.max(...lat)]], {
          padding: { top: p.top / RATIO, bottom: p.bottom / RATIO, left: p.left / RATIO, right: p.right / RATIO },
          bearing, pitch: fit.pitch, maxZoom: 14.5, duration: 0,
        });
      }
      await new Promise((r) => map.once('idle', r));
      const c = Object.assign(document.createElement('canvas'), { width: w, height: h });
      await new Promise((r) => {
        map.once('render', () => {
          c.getContext('2d').drawImage(map.getCanvas(), 0, 0, w, h);
          r();
        });
        map.triggerRepaint();
      });
      const project = (lngLat) => {
        const q = map.project(lngLat);
        return [q.x * RATIO, q.y * RATIO];
      };
      const out = {
        jpeg: c.toDataURL('image/jpeg', 0.92),
        canvas: [map.getCanvas().width, map.getCanvas().height],
        track: t ? { title: t.title, stats: t.stats, profile: t.profile.points.map((q) => [q.distM, q.ele]), highestAt: project(t.stats.highest.slice(0, 2)) } : null,
      };
      el.setAttribute('style', before.style);
      map.setMinZoom(minZoomBefore);
      if (map.getLayer('gpx-label')) map.setLayoutProperty('gpx-label', 'visibility', 'visible');
      for (const id of hidden) map.setLayoutProperty(id, 'visibility', 'visible');
      map.setPixelRatio(before.ratio);
      map.resize();
      map.jumpTo(cam);
      return out;
    },
    { size: s.size, fit: s.fit, minZoom: s.minZoom, summitsOnly: s.summitsOnly },
  );
  shots[s.name] = { ...shot, ms: Date.now() - t0, hash: s.hash };
  console.log(`captured ${s.name}: canvas ${shot.canvas.join('×')} in ${Date.now() - t0} ms`);
}

// --- Frames ----------------------------------------------------------------------------------

const font = async (wt) => (await readFile(`node_modules/@fontsource/barlow/files/barlow-latin-${wt}-normal.woff2`)).toString('base64');
const fontCss = (await Promise.all([400, 500, 600, 700].map(async (wt) => `@font-face{font-family:Barlow;font-weight:${wt};src:url(data:font/woff2;base64,${await font(wt)}) format('woff2')}`))).join('');
const iconSvg = (await readFile('web/public/icons/icon.svg', 'utf8')).replace(/<!--.*?-->/s, '');
const iconUri = `data:image/svg+xml;base64,${Buffer.from(iconSvg).toString('base64')}`;

/** QR as an SVG, from the trimmed picture link (only what differs from the defaults, plus `s`). */
function qrSvg(link, px, dark = '#16202a') {
  if (!uqr) return `<div class="qr-ph" style="width:${px}px;height:${px}px">QR</div>`;
  const q = uqr.encode(link, { ecc: 'M', border: 0 });
  let d = '';
  q.data.forEach((row, y) => row.forEach((on, x) => on && (d += `M${x} ${y}h1v1h-1z`)));
  return `<svg class="qr" width="${px}" height="${px}" viewBox="0 0 ${q.size} ${q.size}" shape-rendering="crispEdges"><path fill="${dark}" d="${d}"/></svg>`;
}

const SNOW_RAMP = ['#c6dbef', '#9ecae1', '#6baed6', '#3182bd', '#08519c', '#3f007d'];
const legend = (label, ticks, dark) => `<div class="legend ${dark ? 'on-dark' : ''}"><span class="lg-label">${label}</span>
  <span class="lg-bar">${SNOW_RAMP.map((c) => `<i style="background:${c}"></i>`).join('')}</span>
  <span class="lg-ticks">${ticks.map((t) => `<b>${t}</b>`).join('')}</span></div>`;

/** Elevation profile with the snow along it: snow white, bare ground earth, not seen hatched. */
function profileSvg(points, states, w, h) {
  const xs = points.map((p) => p[0]);
  const es = points.map((p) => p[1]);
  const [x0, x1] = [Math.min(...xs), Math.max(...xs)];
  const [e0, e1] = [Math.min(...es) - 40, Math.max(...es) + 20];
  const X = (d) => ((d - x0) / (x1 - x0)) * w;
  const Y = (e) => h - ((e - e0) / (e1 - e0)) * h;
  const fill = { snow: '#ffffff', bare: '#a08c72', unseen: 'url(#hatch)' };
  let bands = '';
  for (let i = 0; i < points.length - 1; i++) {
    const [a, b] = [points[i], points[i + 1]];
    bands += `<path d="M${X(a[0])} ${h}L${X(a[0])} ${Y(a[1])}L${X(b[0])} ${Y(b[1])}L${X(b[0])} ${h}Z" fill="${fill[states[i]]}" fill-opacity="${states[i] === 'snow' ? 0.92 : 0.75}"/>`;
  }
  const line = points.map((p, i) => `${i ? 'L' : 'M'}${X(p[0]).toFixed(1)} ${Y(p[1]).toFixed(1)}`).join('');
  return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" style="overflow:visible"><defs><pattern id="hatch" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="8" height="8" fill="rgba(255,255,255,.12)"/><line x1="0" y1="0" x2="0" y2="8" stroke="rgba(255,255,255,.45)" stroke-width="3"/></pattern></defs>
    <g shape-rendering="crispEdges">${bands}</g><path d="${line}" fill="none" stroke="#fff" stroke-width="3" stroke-linejoin="round"/></svg>`;
}

const CSS = `${fontCss}
*{box-sizing:border-box;margin:0}
body{width:var(--w);height:var(--h);font-family:Barlow,sans-serif;color:#16202a;overflow:hidden;position:relative;-webkit-font-smoothing:antialiased}
.map{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
.abs{position:absolute}
.sky{left:0;right:0;top:0;background:linear-gradient(rgba(255,255,255,.9),rgba(255,255,255,.55) 55%,rgba(255,255,255,0))}
.scrim{left:0;right:0;bottom:0;background:linear-gradient(rgba(12,22,34,0),rgba(12,22,34,.62) 32%,rgba(12,22,34,.86))}
.title{font-weight:700;letter-spacing:-.01em;line-height:1}
.sub{font-weight:500;color:#3a4550}
.white{color:#fff}.dim{color:rgba(255,255,255,.78)}
.stats{display:flex}
.stat{display:flex;flex-direction:column}
.stat b{font-weight:700;line-height:1;color:#fff}
.stat span{font-weight:500;color:rgba(255,255,255,.75);text-transform:uppercase;letter-spacing:.06em}
.stat + .stat{border-left:2px solid rgba(255,255,255,.22)}
.foot{display:flex;align-items:center;justify-content:space-between}
.brand{display:flex;align-items:center;font-weight:600}
.brand img{display:block}
.credits{font-weight:400}
.legend{display:grid;grid-template-columns:auto;font-weight:500}
.lg-bar{display:flex}.lg-bar i{flex:1}
.lg-ticks{display:flex;justify-content:space-between}
.lg-ticks b{font-weight:500}
.legend.on-dark{color:rgba(255,255,255,.85)}
.qrbox{background:#fff;display:flex;align-items:center;justify-content:center}
.qr-ph{border:3px dashed #5a6672;display:flex;align-items:center;justify-content:center;font-weight:700;color:#5a6672}
.bar{left:0;right:0;bottom:0;background:#fff;display:flex;align-items:center;justify-content:space-between}
.pin{display:flex;flex-direction:column;align-items:center;transform:translate(-50%,-100%)}
.pin span{background:#16202a;color:#fff;font-weight:700;border-radius:999px;white-space:nowrap}
.pin i{width:0;height:0;border-left:9px solid transparent;border-right:9px solid transparent;border-top:12px solid #16202a}
.guide{left:0;right:0;background:repeating-linear-gradient(45deg,rgba(225,29,72,.22) 0 14px,rgba(225,29,72,.08) 14px 28px);border:3px dashed #e11d48;color:#9f1239;font:700 28px Barlow;display:flex;align-items:center;justify-content:center}
.badge{display:flex;align-items:center;background:rgba(255,255,255,.92);border-radius:999px;font-weight:600}
`;

const page2 = await (await browser.newContext({ viewport: { width: 1080, height: 1080 }, deviceScaleFactor: 1 })).newPage();
const made = [];
async function render(name, [w, h], body, note) {
  await page2.setViewportSize({ width: w, height: h });
  await page2.setContent(`<!doctype html><html><head><meta charset="utf-8"><style>${CSS}</style></head><body style="--w:${w}px;--h:${h}px">${body}</body></html>`, { waitUntil: 'load' });
  await page2.evaluate(() => document.fonts.ready);
  const file = path.join(outDir, `${name}.jpg`);
  await page2.screenshot({ path: file, type: 'jpeg', quality: 86 });
  made.push({ name, w, h, note });
  console.log(`framed ${name}`);
}

const img = (s) => `<img class="map" src="${shots[s].jpeg}">`;
const link = (hash) => `${SITE}${hash.replace(/&?layers=[^&]*/, (m) => m.replace(/,?(labels|hillshade|relief|basemap)/g, '').replace('=,', '='))}&s`;
const credit = (extra = '') => `© OpenStreetMap contributors · © Mapterhorn${extra}`;
const FORECAST_CREDIT = ' · Forecast: Open-Meteo';

// Track, illustrative snow along it: snow above 2150 m, not seen 2050–2150 m (cloud), bare below.
const tr = shots.track.track;
const states = tr.profile.map(([, e]) => (e >= 2150 ? 'snow' : e >= 2050 ? 'unseen' : 'bare'));
const snowShare = Math.round((100 * states.filter((s) => s === 'snow').length) / states.length);
const km = (tr.stats.distanceM / 1000).toFixed(1);
const up = Math.round(tr.stats.ascentM).toLocaleString('en');
const top = Math.round(tr.stats.highest[2]).toLocaleString('en');
const brand = (u, dark) => `<div class="brand ${dark ? 'white' : ''}" style="gap:${14 * u}px;font-size:${28 * u}px"><img src="${iconUri}" style="width:${46 * u}px;height:${46 * u}px;border-radius:${11 * u}px"><span>${APP_NAME}<br><span style="font-weight:500;font-size:${22 * u}px;opacity:.78">${ADDRESS}</span></span></div>`;

// 1. Track, poster, 3:4 (Strava, Instagram feed).
{
  const [w, h] = [1080, 1440];
  const u = 1;
  const [px, py] = tr.highestAt;
  await render('track-poster-3x4', [w, h], `${img('track')}
    <div class="abs sky" style="height:330px"></div>
    <div class="abs" style="left:72px;top:64px;right:72px">
      <div class="title" style="font-size:78px">${tr.title}</div>
      <div class="sub" style="font-size:32px;margin-top:14px">Hike · Sun 18 Oct 2026 · snow seen 16 Oct</div>
    </div>
    <div class="abs pin" style="left:${px}px;top:${py - 8}px"><span style="font-size:26px;padding:8px 16px">${top} m</span><i></i></div>
    <div class="abs scrim" style="height:700px"></div>
    <div class="abs" style="left:72px;right:72px;bottom:56px">
      <div class="stats" style="margin-bottom:30px">
        ${[[`${km}`, 'km'], [up, 'm up'], [top, 'm top'], [`${snowShare}%`, 'on snow']].map(([v, l], i) => `<div class="stat" style="flex:1;padding-left:${i ? 30 : 0}px"><b style="font-size:66px">${v}</b><span style="font-size:22px;margin-top:8px">${l}</span></div>`).join('')}
      </div>
      ${profileSvg(tr.profile, states, w - 144, 120)}
      <div class="dim" style="font-size:21px;margin:12px 0 26px;display:flex;gap:26px"><span>▬ snow</span><span style="color:#cbb79c">▬ bare</span><span>▨ not seen (cloud)</span></div>
      <div class="foot">${brand(u, true)}<div class="qrbox" style="width:150px;height:150px;border-radius:14px">${qrSvg(`${SITE}#map=12.2/46.525/11.588/222/58&s`, 126)}</div></div>
      <div class="dim credits" style="font-size:17px;margin-top:18px">${credit(' · Snow: Copernicus Sentinel-2')} · Not for avalanche decisions</div>
    </div>`, 'Track, Poster, 3:4. Snow along the track is illustrative (fixtures have no satellite day).');
}

// 2. Track, minimal, 3:4: same capture, a white bar.
{
  const [w, h] = [1080, 1440];
  await render('track-minimal-3x4', [w, h], `${img('track-min')}
    <div class="abs bar" style="height:230px;padding:0 60px;gap:30px">
      <div style="flex:1;min-width:0">
        <div class="title" style="font-size:46px">${tr.title}</div>
        <div class="sub" style="font-size:26px;margin-top:8px">${km} km · ${up} m up · ${top} m · ${snowShare}% on snow</div>
        <div style="font-size:21px;color:#5a6672;margin-top:14px;display:flex;align-items:center;gap:10px"><img src="${iconUri}" style="width:30px;height:30px;border-radius:7px">${ADDRESS} · 18 Oct 2026</div>
        <div style="font-size:15px;color:#5a6672;margin-top:8px">${credit(' · Copernicus Sentinel-2')} · Not for avalanche decisions</div>
      </div>
      ${qrSvg(`${SITE}#map=12.2/46.525/11.588/222/58&s`, 150)}
    </div>`, 'Track, Minimal, 3:4.');
}

// 3. Story 9:16, poster, with and without the Instagram safe zones drawn.
for (const guides of [false, true]) {
  const [w, h] = [1080, 1920];
  await render(guides ? 'view-poster-story-safe-zones' : 'view-poster-story', [w, h], `${img('dolomites-story')}
    <div class="abs sky" style="height:640px"></div>
    <div class="abs" style="left:72px;right:72px;top:290px">
      <div class="title" style="font-size:96px">Sella &amp; Marmolada</div>
      <div class="sub" style="font-size:36px;margin-top:18px">New snow by Fri 23 Oct, 06:00 · forecast</div>
    </div>
    <div class="abs scrim" style="height:900px;background:linear-gradient(rgba(12,22,34,0),rgba(12,22,34,.7) 30%,rgba(12,22,34,.8) 62%,rgba(12,22,34,.35))"></div>
    <div class="abs" style="left:72px;right:72px;bottom:370px">
      <div class="stats"><div class="stat"><b style="font-size:118px">96 cm</b><span style="font-size:24px;margin-top:10px">new snow, highest in view</span></div></div>
      <div style="margin:34px 0 34px">${legend('New snow, cm', ['1', '5', '20', '50', '100', '200'], true).replace('class="legend on-dark"', 'class="legend on-dark" style="gap:10px;font-size:22px"').replace('class="lg-bar"', 'class="lg-bar" style="height:16px;border-radius:8px;overflow:hidden"')}</div>
      <div class="foot">${brand(1.1, true)}</div>
      <div class="dim credits" style="font-size:18px;margin-top:18px">${credit(FORECAST_CREDIT)} · Not for avalanche decisions</div>
    </div>
    ${guides ? '<div class="abs guide" style="top:0;height:250px">Story UI: top 250 px</div><div class="abs guide" style="bottom:0;height:340px">Reply bar, link sticker: bottom 340 px</div>' : ''}`,
  guides ? 'Story with Instagram\'s covered zones marked.' : 'View, Poster, 9:16 story. No QR: the link goes in a link sticker.');
}

// 4. View 4:5 with the 3:4 grid crop shown, poster.
const GRID_CUT = Math.round((1080 - 1350 * 0.75) / 2);
{
  const [w, h] = [1080, 1350];
  await render('view-poster-4x5-grid-crop', [w, h], `${img('dolomites-4x5')}
    <div class="abs sky" style="height:330px"></div>
    <div class="abs" style="left:72px;right:72px;top:96px">
      <div class="title" style="font-size:78px">Sella &amp; Marmolada</div>
      <div class="sub" style="font-size:31px;margin-top:14px">New snow by Fri 23 Oct, 06:00 · forecast</div>
    </div>
    <div class="abs scrim" style="height:470px"></div>
    <div class="abs" style="left:72px;right:72px;bottom:86px">
      <div class="stats"><div class="stat"><b style="font-size:92px">96 cm</b><span style="font-size:22px;margin-top:8px">new snow, highest in view</span></div></div>
      <div class="foot" style="margin-top:30px">${brand(1, true)}</div>
      <div class="dim credits" style="font-size:16px;margin-top:14px">${credit(FORECAST_CREDIT)} · Not for avalanche decisions</div>
    </div>
    <div class="abs guide" style="top:0;bottom:0;left:0;right:auto;width:${GRID_CUT}px"></div>
    <div class="abs guide" style="top:0;bottom:0;right:0;left:auto;width:${GRID_CUT}px"></div>`,
  `4:5 with the strips the 3:4 profile grid cuts off (${GRID_CUT} px left and right).`);
}

// 5. Island, poster, 1:1.
{
  const [w, h] = [1080, 1080];
  await render('island-poster-1x1', [w, h], `${img('island')}
    <div class="abs sky" style="height:300px"></div>
    <div class="abs" style="left:64px;right:64px;top:56px">
      <div class="title" style="font-size:72px">South Tyrol</div>
      <div class="sub" style="font-size:30px;margin-top:12px">New snow by Fri 23 Oct, 06:00 · forecast</div>
    </div>
    <div class="abs scrim" style="height:300px"></div>
    <div class="abs" style="left:64px;right:64px;bottom:44px">
      <div class="foot">${brand(0.95, true)}<div style="width:330px">${legend('New snow, cm', ['1', '5', '20', '50', '100', '200'], true).replace('class="legend on-dark"', 'class="legend on-dark" style="gap:8px;font-size:19px"').replace('class="lg-bar"', 'class="lg-bar" style="height:12px;border-radius:6px;overflow:hidden"')}</div></div>
      <div class="dim credits" style="font-size:16px;margin-top:16px">${credit(FORECAST_CREDIT)} · Not for avalanche decisions</div>
    </div>`, 'Island look, Poster, 1:1. The island cut reads as an object on a plain floor.');
}

// 6. Wide 16:9, minimal with a QR (desktop, slides, chats on a laptop: here a QR can be scanned).
{
  const [w, h] = [1920, 1080];
  await render('view-minimal-wide', [w, h], `${img('ortler-wide')}
    <div class="abs" style="left:56px;bottom:56px;background:rgba(255,255,255,.94);border-radius:20px;padding:30px 34px;display:flex;gap:34px;align-items:center;box-shadow:0 4px 24px rgba(15,23,42,.18)">
      <div>
        <div class="title" style="font-size:52px">Ortler · Ortles</div>
        <div class="sub" style="font-size:26px;margin-top:8px">New snow by Fri 23 Oct, 06:00 · up to 96 cm</div>
        <div style="margin-top:20px;width:420px">${legend('New snow, cm', ['1', '5', '20', '50', '100', '200'], false).replace('class="legend "', 'class="legend" style="gap:6px;font-size:18px;color:#3a4550"').replace('class="lg-bar"', 'class="lg-bar" style="height:12px;border-radius:6px;overflow:hidden"')}</div>
        <div style="font-size:21px;color:#5a6672;margin-top:18px;display:flex;align-items:center;gap:10px"><img src="${iconUri}" style="width:30px;height:30px;border-radius:7px">${ADDRESS}</div>
      </div>
      ${qrSvg(link(scenes[4].hash), 190)}
    </div>
    <div class="abs dim credits" style="right:40px;bottom:22px;font-size:17px;text-shadow:0 1px 3px rgba(0,0,0,.6)">${credit(FORECAST_CREDIT)} · Not for avalanche decisions</div>`,
  'View, Minimal card, 16:9, with QR.');
}

// Contact sheet of everything above.
{
  const files = await Promise.all(made.map(async (m) => (await readFile(path.join(outDir, `${m.name}.jpg`))).toString('base64')));
  const H = 560;
  const cells = made.map((m, i) => `<figure style="margin:0;width:${(m.w / m.h) * H}px"><img src="data:image/jpeg;base64,${files[i]}" style="height:${H}px;width:100%;display:block;border-radius:10px;box-shadow:0 2px 10px rgba(0,0,0,.15)"><figcaption style="font:500 18px Barlow;color:#3a4550;margin-top:10px">${m.name}</figcaption></figure>`).join('');
  const sheetW = 2400;
  await page2.setViewportSize({ width: sheetW, height: 1400 });
  await page2.setContent(`<!doctype html><html><head><style>${fontCss}body{margin:0;padding:40px;background:#f3f5f7;width:${sheetW}px;box-sizing:border-box}</style></head><body><div style="display:flex;flex-wrap:wrap;gap:36px">${cells}</div></body></html>`);
  await page2.evaluate(() => document.fonts.ready);
  await page2.screenshot({ path: path.join(outDir, 'overview.jpg'), type: 'jpeg', quality: 80, fullPage: true });
}

await writeFile(path.join(outDir, 'captures.json'), `${JSON.stringify(Object.fromEntries(Object.entries(shots).map(([k, v]) => [k, { hash: v.hash, canvas: v.canvas, ms: v.ms }])), null, 1)}\n`);
await browser.close();
await server.close();
