// Sun over a whole day on a terrain grid: when the sun first reaches each cell, when it last
// leaves it, and how long it shines there. It is the shade of shared/shadow.ts, worked out for
// many sun positions through the day: a cell counts as in the sun while it sees at least half of
// it, and the crossings are interpolated between the steps, so 10-minute steps give times to a
// minute or two.

import { castShadows, type ShadowSun, type ShadowTerrain } from './shadow.ts';

export interface SunDayMaps {
  /** Minutes after `times[0]` the sun first reaches each cell, or NaN where it never does. */
  firstSun: Float32Array;
  /** Minutes after `times[0]` the sun last leaves each cell, or NaN where it never shines. */
  lastSun: Float32Array;
  /** Minutes of sun at each cell over the day. */
  sunMinutes: Float32Array;
}

const MINUTE = 60_000;
/** Shade (0–255) at which a cell counts as half in the sun. */
const HALF = 127.5;

/**
 * `times` (UTC ms, ascending) should start before the first summit sees the sun and end after the
 * last one has lost it; `sunAt` gives the sun for the grid at each of them.
 */
export function sunDayMaps(t: ShadowTerrain, times: readonly number[], sunAt: (time: number) => ShadowSun): SunDayMaps {
  const n = t.width * t.height;
  const firstSun = new Float32Array(n).fill(NaN);
  const lastSun = new Float32Array(n).fill(NaN);
  const sunMinutes = new Float32Array(n);
  if (!times.length) return { firstSun, lastSun, sunMinutes };
  const t0 = times[0];
  let prev = castShadows(t, sunAt(t0));
  // Lit from the start: the sun was already up.
  for (let i = 0; i < n; i++) if (prev[i] < HALF) firstSun[i] = 0;
  for (let k = 1; k < times.length; k++) {
    const shade = castShadows(t, sunAt(times[k]));
    const a = (times[k - 1] - t0) / MINUTE;
    const step = (times[k] - times[k - 1]) / MINUTE;
    for (let i = 0; i < n; i++) {
      const s0 = prev[i];
      const s1 = shade[i];
      if (s0 === 255 && s1 === 255) continue;
      // The share of the sun seen, trapezoid over the step.
      sunMinutes[i] += (1 - (s0 + s1) / 510) * step;
      const lit0 = s0 < HALF;
      const lit1 = s1 < HALF;
      if (lit0 === lit1) continue;
      const at = a + ((s0 - HALF) / (s0 - s1)) * step;
      if (lit1 && Number.isNaN(firstSun[i])) firstSun[i] = at;
      if (!lit1) lastSun[i] = at;
    }
    prev = shade;
  }
  // Still lit at the end.
  const end = (times[times.length - 1] - t0) / MINUTE;
  for (let i = 0; i < n; i++) if (prev[i] < HALF) lastSun[i] = end;
  return { firstSun, lastSun, sunMinutes };
}
