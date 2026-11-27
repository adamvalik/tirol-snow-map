// How fast the first view comes on a phone (#112): serves dist/ (vite preview), opens it in Chromium
// as a Pixel 7 with a cold cache, a throttled network and a slower CPU, and reports when each part
// shows, the layout shift and the bytes. Prints each run and the median.
//
//   npm run build && npm run profile [-- <runs>]
//
// Env:
//   FAST=1          Chrome's "Fast 4G" (60 ms, 9 Mbit/s down) instead of Lighthouse's slow 4G (150 ms, 1.6 Mbit/s).
//   NO_THROTTLE=1   no network throttling.
//   CPU=<n>         CPU slowdown, default 4 (a mid-range phone).
//   DIST=<dir>      serve another build, e.g. one of the dev branch, to compare.
//   ORDER=1         list the requests of the first run: start and end in ms, size, address.
//   SHOTS=<dir>     screenshots of the first run at 1, 2, 4, 6, 10, 15, 20, 30, 40 and 50 s.
//   CHROMIUM_PATH   a Chromium to use; HTTPS_PROXY is passed to the browser if set.
//
// Headless Chromium draws WebGL in software, a few frames a second, and MapLibre finishes about one
// tile per frame, so the late times (`idle`) are much later than on a phone's GPU. The early ones
// (paint, timeline, stations, terrain in front) depend mostly on the network and hold up.
//
// The times, in ms from the start of the page:
//   fcp            first paint with content: the page's shape.
//   timeline       the days of the timeline are in.
//   stations       the station dots are on the map.
//   terrain        the elevation tiles in front are in (body[data-terrain-ready-ms], nearFirst.ts).
//   load           MapLibre's load: every tile of the view is in.
//   idle           the map has drawn everything (the smoke test's "map ready").

import { chromium, devices } from 'playwright';
import { preview } from 'vite';

const runs = Number(process.argv[2] || 3);
const server = await preview({ preview: { port: 4180, strictPort: true }, logLevel: 'silent', ...(process.env.DIST ? { build: { outDir: process.env.DIST } } : {}) });
const url = 'http://localhost:4180/';
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || undefined,
  args: [
    ...(process.env.HTTPS_PROXY ? [`--proxy-server=${process.env.HTTPS_PROXY}`, '--proxy-bypass-list=localhost;127.0.0.1'] : []),
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
    '--ignore-gpu-blocklist',
  ],
});

const fast = process.env.FAST === '1';
const network = {
  offline: false,
  latency: fast ? 60 : 150,
  downloadThroughput: ((fast ? 9 : 1.6) * 1024 * 1024) / 8,
  uploadThroughput: ((fast ? 1500 : 750) * 1024) / 8,
};
const cpu = Number(process.env.CPU || 4);
const KEYS = ['fcp', 'timeline', 'stations', 'terrain', 'load', 'idle', 'cls', 'kb', 'requests'];

const results = [];
for (let i = 0; i < runs; i++) {
  // No context.route() here: Playwright turns the HTTP cache off while requests are routed, and the
  // app reads some elevation tiles a second time from the cache.
  const context = await browser.newContext({ ...devices['Pixel 7'], ignoreHTTPSErrors: true });
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send('Network.enable');
  if (process.env.NO_THROTTLE !== '1') await cdp.send('Network.emulateNetworkConditions', network);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: cpu });

  const requests = [];
  const started = new Map();
  const cached = new Set();
  cdp.on('Network.requestWillBeSent', (e) => started.set(e.requestId, { url: e.request.url, t: e.timestamp }));
  cdp.on('Network.responseReceived', (e) => e.response.fromDiskCache && cached.add(e.requestId));
  cdp.on('Network.requestServedFromCache', (e) => cached.add(e.requestId));
  cdp.on('Network.loadingFinished', (e) => {
    const s = started.get(e.requestId);
    // Cache hits are listed but count no bytes.
    if (s) requests.push({ ...s, end: e.timestamp, cached: cached.has(e.requestId), bytes: cached.has(e.requestId) ? 0 : e.encodedDataLength });
  });

  await page.addInitScript(() => {
    const marks = (window.__firstView = {});
    const mark = (k) => k in marks || (marks[k] = Math.round(performance.now()));
    new PerformanceObserver((l) => l.getEntries().some((e) => e.name === 'first-contentful-paint') && mark('fcp')).observe({ type: 'paint', buffered: true });
    let cls = 0;
    new PerformanceObserver((l) => {
      for (const e of l.getEntries()) if (!e.hadRecentInput) cls += e.value;
      marks.cls = Math.round(cls * 1000) / 1000;
    }).observe({ type: 'layout-shift', buffered: true });
    const watch = setInterval(() => {
      const map = window.__snowmap?.map;
      if (document.querySelector('#days .day:not(.skeleton)')) mark('timeline');
      if (document.body.dataset.terrainReadyMs) mark('terrain');
      if (!map) return;
      if (map.getLayer('stations') && map.querySourceFeatures('stations').length) mark('stations');
      if (map.loaded()) mark('load');
      if (document.body.dataset.mapReadyMs) {
        mark('idle');
        clearInterval(watch);
      }
    }, 50);
  });

  const t0 = Date.now();
  const opened = page.goto(url, { waitUntil: 'load' });
  if (process.env.SHOTS && i === 0) {
    for (const t of [1, 2, 4, 6, 10, 15, 20, 30, 40, 50]) {
      const wait = t * 1000 - (Date.now() - t0);
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      await page.screenshot({ path: `${process.env.SHOTS}/first-view-${String(t).padStart(2, '0')}s.png` }).catch(() => {});
      if (await page.evaluate(() => window.__firstView?.idle).catch(() => false)) break;
    }
  }
  await opened;
  await page.waitForFunction(() => window.__firstView.idle, null, { timeout: 300_000, polling: 200 });
  const marks = await page.evaluate(() => window.__firstView);

  const bytes = requests.reduce((s, r) => s + r.bytes, 0);
  const result = { ...marks, kb: Math.round(bytes / 1024), requests: requests.length };
  results.push(result);
  console.log(`run ${i + 1}`, JSON.stringify(Object.fromEntries(KEYS.map((k) => [k, result[k]]))));
  if (process.env.ORDER && i === 0) {
    const first = Math.min(...requests.map((r) => r.t));
    const ms = (t) => Math.round((t - first) * 1000);
    for (const r of requests.sort((a, b) => a.t - b.t)) {
      console.log(`${ms(r.t)}\t${ms(r.end)}\t${r.cached ? 'cache' : `${Math.round(r.bytes / 1024)} KB`}\t${r.url.replace(url, '').slice(0, 100)}`);
    }
  }
  await context.close();
}

const median = (k) => {
  const v = results.map((r) => r[k]).filter((x) => x != null).sort((a, b) => a - b);
  return v[Math.floor(v.length / 2)];
};
console.log('median', JSON.stringify(Object.fromEntries(KEYS.map((k) => [k, median(k)]))));
await browser.close();
server.httpServer.close();
