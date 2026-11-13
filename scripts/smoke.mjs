// Smoke test for the built app: serves dist/, opens it in Chromium (desktop and phone profiles),
// and reports time to first rendered map, console errors, and a rough frame rate while rotating;
// on desktop also the day slider, forecast playback, the via ferrata layer, a shared link and "Where am I".
//
//   npm run build && node scripts/smoke.mjs [--out <screenshot dir>]
//
// Env: CHROMIUM_PATH to use a specific Chromium; HTTPS_PROXY is passed to the browser if set;
// SMOKE_READY_LIMIT_MS overrides the 5000 ms limit for the first rendered map (CI runners render in software).
// Headless Chromium renders WebGL in software, so frame rates here are a lower bound, not a phone measurement.

import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { chromium, devices } from 'playwright';
import { preview } from 'vite';

const outIdx = process.argv.indexOf('--out');
const outDir = path.resolve(outIdx >= 0 ? process.argv[outIdx + 1] : 'smoke-output');
await mkdir(outDir, { recursive: true });

// CI runners draw WebGL in software, so a screenshot while the map is still drawing new terrain can
// take well over Playwright's default 30 s; every screenshot gets the same allowance.
const SHOT_TIMEOUT_MS = 120_000;

const server = await preview({ preview: { port: 4174, strictPort: true }, logLevel: 'silent' });
const url = 'http://localhost:4174/';
const readyLimitMs = Number(process.env.SMOKE_READY_LIMIT_MS) || 5000;

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || undefined,
  args: [
    ...(process.env.HTTPS_PROXY ? [`--proxy-server=${process.env.HTTPS_PROXY}`, '--proxy-bypass-list=localhost;127.0.0.1'] : []),
   '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});

const profiles = [
  // Desktop also checks "Where am I", with a position near Bolzano and the permission granted.
  {
    name: 'desktop',
    context: { viewport: { width: 1440, height: 900 }, geolocation: { latitude: 46.62, longitude: 11.45, accuracy: 30 }, permissions: ['geolocation'] },
  },
  { name: 'phone', context: { ...devices['Pixel 7'] } },
];

let failed = false;
for (const profile of profiles) {
  const context = await browser.newContext({ ...profile.context, ignoreHTTPSErrors: true });
  const page = await context.newPage();
  const errors = [];
  const external = new Set();
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('request', (r) => {
    const host = new URL(r.url()).host;
    if (host && !host.startsWith('localhost')) external.add(host);
  });

  const t0 = Date.now();
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForFunction(() => document.body.dataset.mapReadyMs, null, { timeout: 90_000 });
  const readyMs = Date.now() - t0;
  const readyInPage = Number(await page.evaluate(() => document.body.dataset.mapReadyMs));
  await page.waitForTimeout(1500);
  await page.screenshot({ path: path.join(outDir, `${profile.name}-start.png`), timeout: SHOT_TIMEOUT_MS });

  // Rotate for 3 s and count animation frames.
  const fps = await page.evaluate(
    () =>
      new Promise((resolve) => {
        const { map } = window.__snowmap;
        let frames = 0;
        const count = () => frames++;
        map.on('render', count);
        map.easeTo({ bearing: map.getBearing() + 90, pitch: 65, duration: 3000 });
        setTimeout(() => {
          map.off('render', count);
          resolve(frames / 3);
        }, 3000);
      }),
  );

  // Click a station with snow data, then a terrain point, and check the panels fill.
  await page.evaluate(() => window.__snowmap.map.jumpTo({ center: [11.69, 46.51], zoom: 11, pitch: 50, bearing: 0 }));
  await page.waitForFunction(() => window.__snowmap.map.loaded(), null, { timeout: 90_000 });
  const stationPoint = await page.evaluate(() => {
    const { map } = window.__snowmap;
    // Pick a snow station that is not covered by a panel.
    // Map coordinates are relative to the map, which starts right of the sidebar on desktop.
    const box = map.getContainer().getBoundingClientRect();
    for (const f of map.queryRenderedFeatures({ layers: ['stations'] })) {
      if (f.properties.hasSnow !== 1) continue;
      const p = map.project(f.geometry.coordinates);
      const x = p.x + box.left;
      const y = p.y + box.top;
      if (document.elementFromPoint(x, y)?.tagName === 'CANVAS') return { x, y };
    }
    return null;
  });
  let stationOk = false;
  if (stationPoint) {
    await page.mouse.click(stationPoint.x, stationPoint.y);
    stationOk = await page
      .waitForFunction(() => document.querySelector('#details-body')?.textContent?.includes('Snow depth'), null, { timeout: 5000 })
      .then(() => true, () => false);
    await page.screenshot({ path: path.join(outDir, `${profile.name}-station.png`), timeout: SHOT_TIMEOUT_MS });
  }

  // Close the station (on a phone this lowers the sheet), then tap the terrain.
  await page.keyboard.press('Escape');
  const box = page.viewportSize();
  await page.mouse.click(box.width * 0.62, box.height * 0.3);
  const forecastOk = await page
    .waitForSelector('.fc-list', { timeout: 20_000 })
    .then(() => true, () => false);
  // Open-Meteo limits are per IP; a shared CI or sandbox IP can hit them. The app shows the error, which is the
  // intended behaviour, so this is reported but does not fail the run.
  const rateLimited = !forecastOk && /limit|in time/i.test((await page.textContent('#details-body')) ?? '');
  const appErrors = errors.filter((e) => !(rateLimited && e.includes('status of 429')));
  await page.screenshot({ path: path.join(outDir, `${profile.name}-forecast.png`), timeout: SHOT_TIMEOUT_MS });

  // The status line, read now: the shared-link check below opens a second tab, which sends this page
  // to the background, where Chromium stops the animation frames Playwright's lookups wait on.
  const stationsText = await page.evaluate(
    () => `stations: ${document.getElementById('stations-count').textContent}, data age: ${document.getElementById('data-age').getAttribute('aria-label')}`,
  );
  // V3 (desktop): the timeline (a past day, forecast playback), and a shared link that restores the view.
  let v3 = '';
  let v3Failed = false;
  if (profile.name === 'desktop') {
    await page.keyboard.press('Escape');
    const dayOk = await page.evaluate(async () => {
      const first = document.querySelector('#days .day');
      if (!first || first.getAttribute('aria-label').endsWith(', now') || first.classList.contains('fc')) return 'no history (only today)';
      first.click();
      const note = document.getElementById('day-note');
      for (let i = 0; i < 50 && !/as of|only snow|no data/i.test(note.textContent); i++) await new Promise((r) => setTimeout(r, 100));
      const ok = /as of|only snow|no data/i.test(note.textContent) && document.getElementById('day-badge').textContent === 'Past';
      document.getElementById('day-back').click();
      return ok ? 'OK' : 'FAILED';
    });
    const forecastAnim = await page.evaluate(async () => {
      const play = document.getElementById('forecast-play');
      if (play.disabled) return 'unavailable';
      const timeline = document.getElementById('timeline');
      const before = timeline.dataset.frame;
      play.click();
      await new Promise((r) => setTimeout(r, 2000));
      const moved = timeline.dataset.frame !== before && document.getElementById('toggle-forecast').checked;
      play.click(); // pause: software GL re-renders the 3D view per frame
      return moved ? 'OK' : 'FAILED';
    });
    // Via ferratas: switch the layer on over the Sella group and open a route's panel.
    await page.evaluate(() => {
      window.__snowmap.map.jumpTo({ center: [11.815, 46.525], zoom: 12.6, pitch: 50, bearing: 150 });
      document.getElementById('toggle-ferratas').click();
    });
    const ferrataPoint = await page
      .waitForFunction(
        () => {
          const { map } = window.__snowmap;
          const box = map.getContainer().getBoundingClientRect();
          for (const f of map.queryRenderedFeatures({ layers: ['ferrata-hit'] })) {
            const coords = f.geometry.type === 'LineString' ? f.geometry.coordinates : f.geometry.coordinates.flat();
            for (const c of coords) {
              const p = map.project(c);
              const hit = map.queryRenderedFeatures([p.x, p.y], { layers: ['ferrata-hit'] }).length;
              if (hit && document.elementFromPoint(p.x + box.left, p.y + box.top)?.tagName === 'CANVAS') return { x: p.x + box.left, y: p.y + box.top };
            }
          }
          return null;
        },
        null,
        { timeout: 60_000, polling: 1000 },
      )
      .then((h) => h.jsonValue(), () => null);
    let ferrata = 'FAILED (no route drawn)';
    if (ferrataPoint) {
      await page.mouse.click(ferrataPoint.x, ferrataPoint.y);
      ferrata = await page
        .waitForFunction(() => document.querySelector('#details-body')?.textContent?.includes('Mapped length'), null, { timeout: 5000 })
        .then(() => 'OK', () => 'FAILED (no panel)');
    }
    await page.screenshot({ path: path.join(outDir, 'desktop-v3.png'), timeout: SHOT_TIMEOUT_MS });
    await page.waitForTimeout(500);
    const hash = await page.evaluate(() => window.location.hash);
    const shared = await context.newPage();
    shared.on('pageerror', (e) => errors.push(`pageerror (shared link): ${e.message}`));
    await shared.goto(`${url}${hash}`, { waitUntil: 'load' });
    await shared.waitForFunction(() => window.__snowmap?.map.loaded(), null, { timeout: 90_000 });
    const restored = await shared.evaluate(() => {
      const m = window.__snowmap.map;
      return {
        zoom: m.getZoom(),
        forecast: document.getElementById('toggle-forecast').checked,
        ferratas: document.getElementById('toggle-ferratas').checked,
        day: document.querySelector('#days [aria-checked="true"]')?.dataset.date ?? null,
      };
    });
    const linkOk = hash.includes('map=') && Math.abs(restored.zoom - 12.6) < 0.05 && restored.forecast && restored.ferratas;
    await shared.close();
    await page.bringToFront();
    // Where am I: the button finds the position, the dot shows, and a second tap switches it off.
    await page.click('#locate-btn');
    const locate = await page
      .waitForFunction(() => document.getElementById('locate-btn').dataset.state === 'on' && document.querySelector('.maplibregl-user-location-dot'), null, { timeout: 20_000 })
      .then(
        async () => {
          await page.click('#locate-btn');
          return (await page.$eval('#locate-btn', (b) => b.dataset.state)) === 'off' ? 'OK' : 'FAILED (does not switch off)';
        },
        () => 'FAILED (no position)',
      );
    v3 = `timeline day ${dayOk}, forecast animation ${forecastAnim}, via ferratas ${ferrata}, shared link ${linkOk ? 'OK' : `FAILED (${hash} -> ${JSON.stringify(restored)})`}, where am I ${locate}`;
    if (dayOk === 'FAILED' || forecastAnim === 'FAILED' || ferrata !== 'OK' || !linkOk || locate !== 'OK') v3Failed = true;
  }

  console.log(
    `${profile.name}: map ready ${readyMs} ms (in-page ${readyInPage} ms), ~${fps.toFixed(0)} fps while rotating (software GL), ` +
      `station panel ${stationOk ? 'OK' : 'FAILED'}, forecast ${forecastOk ? 'OK' : rateLimited ? 'RATE-LIMITED by Open-Meteo (error shown in panel)' : 'FAILED'}`,
  );
  console.log(`  ${stationsText}`);
  if (v3) console.log(`  ${v3}`);
  console.log(`  external hosts: ${[...external].sort().join(', ')}`);
  console.log(`  console errors: ${errors.length ? errors.join(' | ') : 'none'}`);
  const allowed = ['tiles.mapterhorn.com', 'api.open-meteo.com'];
  const disallowed = [...external].filter((h) => !allowed.includes(h));
  if (disallowed.length) console.log(`  DISALLOWED external hosts: ${disallowed.join(', ')}`);
  const problems = [
    appErrors.length && 'console errors',
    !(forecastOk || rateLimited) && 'forecast panel',
    !stationOk && 'station panel',
    v3Failed && 'desktop checks (timeline, ferratas, shared link, where am I)',
    disallowed.length && 'disallowed hosts',
    readyMs > readyLimitMs && `map ready > ${readyLimitMs} ms`,
  ].filter(Boolean);
  if (problems.length) {
    console.log(`  FAIL: ${problems.join(', ')}`);
    failed = true;
  }
  await context.close();
}

await browser.close();
await new Promise((r) => server.httpServer.close(r));
console.log(`screenshots in ${outDir}`);
process.exitCode = failed ? 1 : 0;
