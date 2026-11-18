// The day's sun maps off the main thread (see sunMaps.ts): the shade of the whole 250 m grid for
// every step of the day, summed into first sun, last sun and sun minutes (shared/sunDay.ts). A
// separate worker from the shade's, so the slider's shade keeps up while a day is worked out.

import { MODEL_GRID, rowCellSizes } from '../../shared/grid.ts';
import { type ShadowSun, shadowTerrain, type ShadowTerrain } from '../../shared/shadow.ts';
import { type SunDayMaps, sunDayMaps } from '../../shared/sunDay.ts';

export type SunMapsRequest =
  | { type: 'terrain'; values: Int16Array }
  | { type: 'day'; id: number; times: number[]; suns: ShadowSun[] };

export interface SunMapsResult extends SunDayMaps {
  id: number;
  ms: number;
}

const scope = self as unknown as {
  onmessage: ((e: MessageEvent<SunMapsRequest>) => void) | null;
  postMessage(message: SunMapsResult, transfer: Transferable[]): void;
};

let terrain: ShadowTerrain | null = null;

scope.onmessage = (e) => {
  const m = e.data;
  if (m.type === 'terrain') {
    terrain = shadowTerrain(MODEL_GRID.width, MODEL_GRID.height, m.values, rowCellSizes(MODEL_GRID));
    return;
  }
  if (!terrain) return;
  const t0 = performance.now();
  const maps = sunDayMaps(terrain, m.times, (t) => m.suns[m.times.indexOf(t)]);
  scope.postMessage({ id: m.id, ...maps, ms: performance.now() - t0 }, [maps.firstSun.buffer, maps.lastSun.buffer, maps.sunMinutes.buffer]);
};
