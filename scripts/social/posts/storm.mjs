// storm: The forecast snowfall building up over South Tyrol: a reel (9:16 MP4), a cover still
// (4:5) and a story (9:16). Numbers and times come from the site's forecast.json.

import { execFileSync } from 'node:child_process';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { ISLAND_45, ISLAND_STORY, QUICK, SITE, TERRAIN, brand, capture, credit, data, dayOnly, dayTime, frame, img, legend } from '../core.mjs';

export const usage = 'storm';

export async function run({ outDir }) {
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
