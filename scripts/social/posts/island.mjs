// island: South Tyrol as a block, with the snow the satellite saw last (4:5).

import path from 'node:path';
import { ISLAND_45, TERRAIN, capture, credit, data, dayOnly, frame, islandBody } from '../core.mjs';

export const usage = 'island';

export async function run({ outDir }) {
  const sat = await data('satellite.json');
  const satDay = sat.available ? dayOnly(`${sat.date}T12:00:00Z`) : null;
  const satCredit = credit(', snow Copernicus Sentinel-2');
  const island = await capture({ hash: `#map=8/46.6/11.45/0/30&layers=snow,${TERRAIN},island`, size: [1080, 1350], camera: ISLAND_45, labels: 'none' });
  await frame(path.join(outDir, 'island-4x5.jpg'), [1080, 1350], islandBody(island, 'South Tyrol', `Snow seen from space, ${satDay}`, satCredit));
}
