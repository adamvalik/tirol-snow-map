import { chromium } from 'playwright';
import { preview } from 'vite';
const server = await preview({ preview: { port: 4183, strictPort: true }, logLevel: 'silent' });
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH, args: [`--proxy-server=${process.env.HTTPS_PROXY}`, '--proxy-bypass-list=localhost;127.0.0.1','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist'] });
const page = await (await browser.newContext({ ignoreHTTPSErrors: true, viewport: {width:1300,height:820} })).newPage();
page.on('console', (m) => { if (m.type()==='error' || m.type()==='warning') console.log('console', m.type(), m.text().slice(0,200)); });
await page.goto('http://localhost:4183/');
await page.waitForFunction(() => document.body.dataset.mapReadyMs, null, { timeout: 120000 });
const steps = JSON.parse(process.argv[2]);
for (const [i, s] of steps.entries()) {
  if (s.view) await page.evaluate((v) => window.__snowmap.map.jumpTo(v), s.view);
  if (s.check) for (const [id, on] of Object.entries(s.check)) { const el = page.locator('#' + id); if ((await el.isChecked()) !== on) await el.click(); }
  await page.waitForTimeout(500); await page.waitForFunction(() => window.__snowmap.map.loaded(), null, { timeout: 120000 }); await page.waitForTimeout(s.wait ?? 4000);
  if (s.click) { await page.mouse.click(s.click[0], s.click[1]); await page.waitForTimeout(3000); }
  await page.screenshot({ path: `${process.env.OUT}/v2-${i}.png` });
}
await browser.close(); server.httpServer.close();
