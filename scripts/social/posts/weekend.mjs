// weekend: The Friday series: the snow on the ground at 1,500, 2,000 and 2,500 m and the new
// snow forecast to Sunday, over a slow flight across the depth estimate. A reel (9:16
// MP4) and a story (9:16). From stations.json and forecast.json.

import { execFileSync } from 'node:child_process';
import { copyFile, mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { ISLAND_STORY, QUICK, SITE, TERRAIN, TZ, brand, capture, credit, data, dayTime, fly, frame, img, today } from '../core.mjs';

export const usage = 'weekend';

export async function run({ outDir }) {
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
      <div class="dim" style="font-size:30px;margin-top:14px">${newCm <= 0 ? 'Nowhere in South Tyrol' : `${forecastLine}: the most anywhere`},<br>forecast as of ${dayTime(fc.fetchedAt ?? fc.generatedAt)}</div>` },
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
