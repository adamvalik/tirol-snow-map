// Renders the link preview picture, dist/og.jpg (1200 × 630), from the built app: the default view
// with today's data, the panels hidden, and a card with the name and the date. index.html points
// og:image and twitter:image at it (see vite.config.ts). Run by the deploy workflow after the build.
//
//   npm run build && node scripts/og-image.mjs [--out dist/og.jpg]
//
// Env: CHROMIUM_PATH to use a specific Chromium; HTTPS_PROXY is passed to the browser if set.
// Exits non-zero when the map does not render; the workflow then keeps the live site's picture.

import { stat } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
import { preview } from 'vite';

const outIdx = process.argv.indexOf('--out');
const out = path.resolve(outIdx >= 0 ? process.argv[outIdx + 1] : 'dist/og.jpg');
const WIDTH = 1200;
const HEIGHT = 630;
// WhatsApp drops preview pictures much above 300 KB, so the JPEG quality steps down until it fits.
const MAX_BYTES = 280_000;
// Software WebGL on a runner is slow, and terrain tiles come cold from Mapterhorn.
const TIMEOUT_MS = 120_000;

const server = await preview({ preview: { port: 4175, strictPort: true }, logLevel: 'silent' });
let browser;
let code = 0;
try {
  browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || undefined,
    args: [
      ...(process.env.HTTPS_PROXY ? [`--proxy-server=${process.env.HTTPS_PROXY}`, '--proxy-bypass-list=localhost;127.0.0.1'] : []),
      '--use-angle=swiftshader',
      '--enable-unsafe-swiftshader',
      '--ignore-gpu-blocklist',
    ],
  });
  const context = await browser.newContext({ viewport: { width: WIDTH, height: HEIGHT }, deviceScaleFactor: 1, ignoreHTTPSErrors: true });
  const page = await context.newPage();
  page.on('pageerror', (e) => console.warn(`pageerror: ${e.message}`));
  await page.goto('http://localhost:4175/', { waitUntil: 'load' });
  await page.waitForFunction(() => document.body.dataset.mapReadyMs, null, { timeout: TIMEOUT_MS });

  // Only the map, over the whole frame; the scale and the attribution go into the card instead.
  await page.addStyleTag({
    content: `
      body > *:not(#map):not(#og-card):not(#og-credit) { display: none !important; }
      #map { inset: 0 !important; }
      .maplibregl-control-container { display: none !important; }
      /* Centred: chat apps often show the picture as a square cut from the middle. */
      #og-card {
        position: fixed; left: 50%; bottom: 34px; transform: translateX(-50%); white-space: nowrap;
        display: flex; align-items: center; gap: 18px;
        padding: 18px 26px 18px 18px; border-radius: 18px; background: rgb(255 255 255 / 0.94);
        box-shadow: var(--shadow); color: var(--ink); font-family: var(--font);
      }
      #og-card img { width: 84px; height: 84px; border-radius: 18px; }
      #og-card strong { display: block; font-size: 44px; font-weight: 700; line-height: 1.05; letter-spacing: -0.01em; }
      #og-card span { display: block; margin-top: 6px; font-size: 26px; font-weight: 500; color: var(--ink-2); }
      #og-credit {
        position: fixed; right: 10px; bottom: 8px; font: 500 14px var(--font); color: var(--ink-2);
        background: rgb(255 255 255 / 0.7); padding: 2px 8px; border-radius: 6px;
      }
    `,
  });

  // The date of the data in the build, as the app's own panels show it (South Tyrol's day).
  await page.evaluate(async () => {
    const status = await fetch('./data/status.json').then((r) => (r.ok ? r.json() : null), () => null);
    const at = status?.generatedAt ? new Date(status.generatedAt) : new Date();
    const day = at.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Europe/Rome' });
    const card = document.createElement('div');
    card.id = 'og-card';
    card.innerHTML = '<img src="./icons/icon.svg" alt="" /><div><strong>South Tyrol Snow Map</strong><span></span></div>';
    card.querySelector('span').textContent = `Snow on ${day}`;
    const credit = document.createElement('div');
    credit.id = 'og-credit';
    credit.textContent = '© OpenStreetMap, Mapterhorn, Copernicus Sentinel data';
    document.body.append(card, credit);
    await document.fonts.ready;
  });

  // The map was laid out next to the sidebar; let it take the frame, then wait until everything is
  // drawn: the terrain and basemap tiles, and the snow layers, which arrive after the first idle.
  // A little wider than the app's start, since the frame is low: more peaks, and the sky at the top.
  await page.evaluate(() => {
    const { map } = window.__snowmap;
    map.resize();
    map.jumpTo({ zoom: map.getZoom() - 0.35, pitch: 68 });
  });
  await page.waitForTimeout(3000);
  await page.evaluate(
    (timeout) =>
      new Promise((resolve, reject) => {
        const { map } = window.__snowmap;
        setTimeout(() => reject(new Error(`map not drawn after ${timeout / 1000} s`)), timeout);
        if (map.loaded() && map.areTilesLoaded()) resolve(true);
        else map.once('idle', () => resolve(true));
        map.triggerRepaint();
      }),
    TIMEOUT_MS,
  );
  await page.waitForTimeout(1500);

  for (const quality of [85, 78, 70, 62, 55]) {
    await page.screenshot({ path: out, type: 'jpeg', quality, timeout: TIMEOUT_MS });
    const { size } = await stat(out);
    console.log(`og image: ${path.relative(process.cwd(), out)}, quality ${quality}, ${Math.round(size / 1000)} KB`);
    if (size <= MAX_BYTES) break;
  }
} catch (e) {
  console.error(`og image failed: ${e.message}`);
  code = 1;
} finally {
  await browser?.close();
  await server.close();
}
process.exit(code);
