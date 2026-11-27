// intro: The carousel that says what the map shows (4:5 slides), from the current data.

import path from 'node:path';
import { ISLAND_45, TERRAIN, brand, capture, credit, data, dayOnly, frame, img, islandBody, today } from '../core.mjs';

export const usage = 'intro';

export async function run({ outDir }) {
  const sat = await data('satellite.json');
  const satDay = sat.available ? dayOnly(`${sat.date}T12:00:00Z`) : null;
  const satCredit = credit(', snow from stations and Copernicus Sentinel-2');
  // The depth estimate, where the island post has the satellite's snow: it reads at a glance in
  // blue even when the satellite's last clear day had little snow.
  const island = await capture({ hash: `#map=8/46.6/11.45/0/30&layers=depth,${TERRAIN},island`, size: [1080, 1350], camera: ISLAND_45, labels: 'none' });

  // 1. Cover: what it is.
  await frame(path.join(outDir, '1-cover.jpg'), [1080, 1350], islandBody(island, 'Where is the snow<br>in South Tyrol?', 'A 3D map with the snow on the real terrain', satCredit));

  const fc = await data('forecast.json');
  const lastFrame = Math.max(0, (fc.frames?.length ?? 1) - 1);
  // 2–5. One thing per slide: a 3D view, a title and one line.
  const slides = [
    { n: 2, layers: `snow,${TERRAIN},labels,basemap`, cam: [11.3, 46.5, 10.6, 25, 64], title: 'Seen from space', sub: `Sentinel-2 snow cover at about 60 m, last clear look ${satDay}`, extra: ', snow Copernicus Sentinel-2' },
    { n: 3, layers: `stations,depth,${TERRAIN},labels,basemap`, cam: [10.6, 46.72, 11.1, 15, 55], title: 'Measured on the ground', sub: 'About 350 weather stations: snow depth, new snow, wind, temperature', extra: ', stations avalanche.report and Province of Bolzano' },
    { n: 4, layers: `forecast,${TERRAIN},basemap`, cam: [10.4, 46.62, 11.55, 0, 55], title: 'Forecast, hour by hour', sub: 'New snow for the next 3 days on the terrain', extra: ', forecast Open-Meteo (CC BY 4.0)', f: lastFrame },
    // Mid-afternoon in late November: long shadows, lit slopes facing south-west.
    { n: 5, layers: `sun,${TERRAIN},labels,basemap`, cam: [12.2, 46.51, 11.85, 160, 62], title: 'Sun and shade', sub: 'The real ridges cast the shadows, for any day and time', extra: '', sun: `${today}T13:30Z` },
  ];
  for (const s of slides) {
    const shot = await capture({ hash: `#map=10/46.6/11.45/0/50&layers=${s.layers}${s.f !== undefined ? `&f=${s.f}` : ''}${s.sun ? `&sun=${s.sun}` : ''}`, size: [1080, 1350], camera: s.cam, labels: 'summits' });
    await frame(path.join(outDir, `${s.n}-${s.title.split(' ')[0].replace(/\W/g, '').toLowerCase()}.jpg`), [1080, 1350], `${img(shot)}
      <div class="abs sky" style="height:330px"></div>
      <div class="abs" style="left:80px;right:80px;top:70px">
        <div class="title" style="font-size:76px">${s.title}</div>
        <div class="sub" style="font-size:31px;margin-top:16px">${s.sub}</div>
      </div>
      <div class="abs scrim" style="height:200px"></div>
      <div class="abs dim" style="left:80px;right:80px;bottom:46px;font-size:16px">${credit(s.extra)}</div>`);
  }

  // 6. The call to action, on the island again.
  await frame(path.join(outDir, '6-open.jpg'), [1080, 1350], `${img(island)}
    <div class="abs" style="inset:0;background:rgba(12,22,34,.55)"></div>
    <div class="abs" style="left:80px;right:80px;top:0;bottom:0;display:flex;flex-direction:column;justify-content:center;gap:36px">
      <div class="title white" style="font-size:84px">Free, in your browser.<br>No account.</div>
      <div class="dim" style="font-size:36px;line-height:1.35">Updated three times a day.<br>Tap the snow anywhere for the forecast at that height.</div>
      <div>${brand(1.5)}</div>
    </div>
    <div class="abs dim" style="left:80px;right:80px;bottom:46px;font-size:16px">${satCredit}</div>`);
}
