// What the posts in scripts/social/posts/ share: the arguments, the browser and the map
// captures, the frame in the app's font, and the views. scripts/social.mjs starts the browser
// with start() and closes it with stop(); nothing here runs on import.

import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

export const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
};
export const QUICK = process.argv.includes('--quick');
export const SITE = arg('site', 'https://cimamap.com/').replace(/\/?$/, '/');
export const TZ = 'Europe/Rome';
export const today = new Date().toLocaleDateString('en-CA', { timeZone: TZ });

export const when = (iso, opts) => new Date(iso).toLocaleString('en-GB', { timeZone: TZ, ...opts });
export const dayTime = (iso) => `${when(iso, { weekday: 'short', day: 'numeric', month: 'short' })}, ${when(iso, { hour: '2-digit', minute: '2-digit' })}`;
export const dayOnly = (iso) => when(iso, { weekday: 'short', day: 'numeric', month: 'short' });

// --- Browser ---------------------------------------------------------------------------------

// Set by start(); a post that imports them sees them once it has run.
export let browser;
export let mapPage;
let framePage;
let CSS;
let iconUri;

export async function start() {
  browser = await chromium.launch({
    // The cloud sessions' Chromium, else Playwright's own; on a Mac, CHROMIUM_PATH can point at
    // "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome".
    executablePath: process.env.CHROMIUM_PATH || (existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined),
    args: [
      ...(process.env.HTTPS_PROXY ? [`--proxy-server=${process.env.HTTPS_PROXY}`, '--proxy-bypass-list=localhost;127.0.0.1'] : []),
      '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist',
    ],
  });
  mapPage = await (await browser.newContext({ viewport: { width: 1440, height: 1000 }, ignoreHTTPSErrors: true })).newPage();
  mapPage.on('pageerror', (e) => console.log('pageerror', e.message));

  const font = async (wt) => (await readFile(`node_modules/@fontsource/barlow/files/barlow-latin-${wt}-normal.woff2`)).toString('base64');
  const fontCss = (await Promise.all([400, 500, 600, 700].map(async (wt) => `@font-face{font-family:Barlow;font-weight:${wt};src:url(data:font/woff2;base64,${await font(wt)}) format('woff2')}`))).join('');
  CSS = `${fontCss}\n${RULES}`;
  const iconSvg = (await readFile('web/public/icons/icon.svg', 'utf8')).replace(/<!--.*?-->/s, '');
  iconUri = `data:image/svg+xml;base64,${Buffer.from(iconSvg).toString('base64')}`;
  framePage = await (await browser.newContext({ viewport: { width: 1080, height: 1350 }, deviceScaleFactor: 1 })).newPage();
}

export const stop = () => browser.close();

// Through the browser, so it takes the same proxy as the map.
export const data = async (name) => (await mapPage.goto(`${SITE}data/${name}?t=${Date.now()}`)).json();

/**
 * The bare map for `hash` at `size` (export pixels). `camera` is zoom/lat/lon/bearing/pitch for
 * that size (zoom as the export would show it, not the screen), `labels` 'none', 'summits' or 'orient' (see openMap).
 */
export async function capture({ hash, size, camera, labels = 'summits' }) {
  await openMap({ hash, size, labels });
  return shoot(camera, 600);
}

/**
 * Frames of a camera move over one map state, for a reel. The page loads once; each camera is a
 * jump, an idle wait and a read, so after the first frame the tiles mostly come from the cache.
 */
export async function fly({ hash, size, cameras, labels = 'none', textScale = 1, setup, before }) {
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

export async function openMap({ hash, size, labels, textScale = 1 }) {
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
export const shoot = (camera, settleMs) => mapPage.evaluate(([c, s]) => window.__shoot(c, s), [camera, settleMs]);

// --- Frames ----------------------------------------------------------------------------------

// shared/snowColors.ts, without the bare class.
export const RAMP = ['#a9d4f5', '#6fb1ea', '#3b86d6', '#1f5cb4', '#183a87', '#4b1a83'];
export const TICKS = ['1', '5', '20', '50', '100', '200'];

// The frame's rules; start() puts the fonts in front.
const RULES = `*{box-sizing:border-box;margin:0}
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

export const brand = (u = 1) => `<div class="brand" style="gap:${14 * u}px;font-size:${30 * u}px"><img src="${iconUri}" style="width:${50 * u}px;height:${50 * u}px;border-radius:${12 * u}px"><span>Cima Map<br><span style="font-weight:500;font-size:${23 * u}px;opacity:.8">cimamap.com</span></span></div>`;
export const legend = (label, u = 1) => `<div class="legend" style="gap:${8 * u}px;font-size:${21 * u}px"><span>${label}</span>
  <span class="lg-bar" style="height:${14 * u}px;border-radius:${7 * u}px">${RAMP.map((c) => `<i style="background:${c}"></i>`).join('')}</span>
  <span class="lg-ticks">${TICKS.map((t) => `<b style="font-weight:500">${t}</b>`).join('')}</span></div>`;
export const credit = (extra) => `© OpenStreetMap contributors, © Mapterhorn${extra}. Not for avalanche decisions: avalanche.report`;

export async function frame(file, [w, h], body, { transparent = false } = {}, attempt = 1) {
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
export const img = (uri) => `<img class="map" src="${uri}">`;

// --- Views -----------------------------------------------------------------------------------

export const TERRAIN = 'hillshade,relief';
// South Tyrol as a block on a plain floor; the camera for 1080 px wide.
export const ISLAND_45 = [7.72, 46.6, 11.45, 0, 34];
export const ISLAND_STORY = [7.6, 46.62, 11.45, 0, 40];

// South Tyrol as a block with a title on top, the brand and `extra` (the whole credit) at the
// bottom: the island post and the first slide of the carousel.
export const islandBody = (shot, title, sub, extra) => `${img(shot)}
  <div class="abs sky" style="height:340px"></div>
  <div class="abs" style="left:80px;right:80px;top:70px">
    <div class="title" style="font-size:80px">${title}</div>
    <div class="sub" style="font-size:31px;margin-top:16px">${sub}</div>
  </div>
  <div class="abs scrim" style="height:260px"></div>
  <div class="abs" style="left:80px;right:80px;bottom:52px">${brand()}<div class="dim" style="font-size:16px;margin-top:18px">${extra}</div></div>`;
