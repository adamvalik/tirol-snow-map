// fallen: After a storm: the stations with the most new snow in 72 hours, over the depth
// estimate (4:5 and a 9:16 story). From the site's stations.json.

import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { ISLAND_STORY, SITE, TERRAIN, brand, capture, credit, data, dayTime, frame, img } from '../core.mjs';

export const usage = 'fallen';

export async function run({ outDir }) {
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
