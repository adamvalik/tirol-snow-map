// Smoke test for the built app: serves dist/, opens it in Chromium (desktop and phone profiles),
// and reports time to first rendered map, console errors, and a rough frame rate while rotating.
//
//   npm run build && node scripts/smoke.mjs [--out <screenshot dir>]
//
// Env: CHROMIUM_PATH to use a specific Chromium; HTTPS_PROXY is passed to the browser if set.
// Headless Chromium renders WebGL in software, so frame rates here are a lower bound, not a phone measurement.

import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { chromium, devices } from 'playwright';
import { preview } from 'vite';

const outIdx = process.argv.indexOf('--out');
const outDir = path.resolve(outIdx >= 0 ? process.argv[outIdx + 1] : 'smoke-output');
await mkdir(outDir, { recursive: true });

const server = await preview({ preview: { port: 4174, strictPort: true }, logLevel: 'silent' });
const url = 'http://localhost:4174/';

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || undefined,
  args: [
    ...(process.env.HTTPS_PROXY ? [`--proxy-server=${process.env.HTTPS_PROXY}`, '--proxy-bypass-list=localhost;127.0.0.1'] : []),
   '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});

const profiles = [
  { name: 'desktop', context: { viewport: { width: 1440, height: 900 } } },
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
  await page.waitForFunction(() => document.body.dataset.mapReadyMs, null, { timeout: 30_000 });
  const readyMs = Date.now() - t0;
  const readyInPage = Number(await page.evaluate(() => document.body.dataset.mapReadyMs));
  await page.waitForTimeout(1500);
  await page.screenshot({ path: path.join(outDir, `${profile.name}-start.png`) });

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
  await page.waitForFunction(() => window.__snowmap.map.loaded(), null, { timeout: 30_000 });
  const stationPoint = await page.evaluate(() => {
    const { map } = window.__snowmap;
    // Pick a snow station that is not covered by a panel.
    for (const f of map.queryRenderedFeatures({ layers: ['stations'] })) {
      if (f.properties.hasSnow !== 1) continue;
      const p = map.project(f.geometry.coordinates);
      if (document.elementFromPoint(p.x, p.y)?.tagName === 'CANVAS') return { x: p.x, y: p.y };
    }
    return null;
  });
  let stationOk = false;
  if (stationPoint) {
    await page.mouse.click(stationPoint.x, stationPoint.y);
    stationOk = await page
      .waitForFunction(() => document.querySelector('#details-body')?.textContent?.includes('Snow depth'), null, { timeout: 5000 })
      .then(() => true, () => false);
    await page.screenshot({ path: path.join(outDir, `${profile.name}-station.png`) });
  }

  const box = page.viewportSize();
  await page.mouse.click(box.width * 0.62, box.height * 0.3);
  const forecastOk = await page
    .waitForSelector('table.forecast', { timeout: 20_000 })
    .then(() => true, () => false);
  // Open-Meteo limits are per IP; a shared CI or sandbox IP can hit them. The app shows the error, which is the
  // intended behaviour, so this is reported but does not fail the run.
  const rateLimited = !forecastOk && /limit|in time/i.test((await page.textContent('#details-body')) ?? '');
  const appErrors = errors.filter((e) => !(rateLimited && e.includes('status of 429')));
  await page.screenshot({ path: path.join(outDir, `${profile.name}-forecast.png`) });

  const stationsText = await page.textContent('#stations-time');
  console.log(
    `${profile.name}: map ready ${readyMs} ms (in-page ${readyInPage} ms), ~${fps.toFixed(0)} fps while rotating (software GL), ` +
      `station panel ${stationOk ? 'OK' : 'FAILED'}, forecast ${forecastOk ? 'OK' : rateLimited ? 'RATE-LIMITED by Open-Meteo (error shown in panel)' : 'FAILED'}`,
  );
  console.log(`  ${stationsText}`);
  console.log(`  external hosts: ${[...external].sort().join(', ')}`);
  console.log(`  console errors: ${errors.length ? errors.join(' | ') : 'none'}`);
  const allowed = ['tiles.mapterhorn.com', 'api.open-meteo.com'];
  const disallowed = [...external].filter((h) => !allowed.includes(h));
  if (disallowed.length) console.log(`  DISALLOWED external hosts: ${disallowed.join(', ')}`);
  const problems = [
    appErrors.length && 'console errors',
    !(forecastOk || rateLimited) && 'forecast panel',
    !stationOk && 'station panel',
    disallowed.length && 'disallowed hosts',
    readyMs > 5000 && 'map ready > 5000 ms',
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
