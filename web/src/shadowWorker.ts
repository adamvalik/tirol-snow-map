// Cast shadows off the main thread (see shadows.ts): the terrain arrives once, then one sun at a time.

import { castShadows, type ShadowSun, shadowTerrain, type ShadowTerrain } from '../../shared/shadow.ts';

export type ShadowRequest =
  | { type: 'terrain'; width: number; height: number; values: Int16Array; cellSize: Float64Array }
  | { type: 'sun'; id: number; sun: ShadowSun };

export interface ShadowResult {
  id: number;
  mask: Uint8Array;
  ms: number;
}

const scope = self as unknown as {
  onmessage: ((e: MessageEvent<ShadowRequest>) => void) | null;
  postMessage(message: ShadowResult, transfer: Transferable[]): void;
};

let terrain: ShadowTerrain | null = null;

scope.onmessage = (e) => {
  const m = e.data;
  if (m.type === 'terrain') {
    terrain = shadowTerrain(m.width, m.height, m.values, m.cellSize);
    return;
  }
  if (!terrain) return;
  const t0 = performance.now();
  const mask = castShadows(terrain, m.sun);
  scope.postMessage({ id: m.id, mask, ms: performance.now() - t0 }, [mask.buffer]);
};
