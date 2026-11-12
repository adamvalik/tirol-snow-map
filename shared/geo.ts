// Distances and climb along lines in [lon, lat, ...] positions, shared by the via ferrata pipeline and the app.

const R = 6371008.8;
const rad = (d: number) => (d * Math.PI) / 180;

/** Great-circle distance in metres; only lon and lat are used. */
export function distanceM(a: readonly number[], b: readonly number[]): number {
  const dLat = rad(b[1] - a[1]);
  const dLon = rad(b[0] - a[0]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[1])) * Math.cos(rad(b[1])) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export const lineLengthM = (line: readonly (readonly number[])[]): number =>
  line.reduce((s, p, i) => (i ? s + distanceM(line[i - 1], p) : 0), 0);

/** Points every `stepM` metres along a line, ends included; extra coordinates (elevation) are interpolated too. */
export function resample<T extends readonly number[]>(line: readonly T[], stepM: number): T[] {
  const out: T[] = [line[0]];
  // Distance since the last point written, at the start of each segment.
  let carry = 0;
  for (let i = 1; i < line.length; i++) {
    const [a, b] = [line[i - 1], line[i]];
    const seg = distanceM(a, b);
    let d = stepM - carry;
    for (; d < seg; d += stepM) out.push(a.map((v, k) => v + ((b[k] - v) * d) / seg) as unknown as T);
    carry = seg - (d - stepM);
  }
  if (line.length > 1) out.push(line[line.length - 1]);
  return out;
}

/**
 * Ascent and descent along a profile with hysteresis: a change only counts once the profile has
 * moved `thresholdM` from the last turning point, so terrain-model noise on gentle ground does not
 * add up (the spike measured +30 % on a gentle path with plain summing).
 */
export function ascentDescent(elevations: readonly number[], thresholdM = 5): { ascent: number; descent: number } {
  let ascent = 0;
  let descent = 0;
  let ref = elevations[0];
  let dir = 0;
  for (const e of elevations.slice(1)) {
    if (dir >= 0 && e > ref && (dir === 1 || e - ref >= thresholdM)) {
      ascent += e - ref;
      [ref, dir] = [e, 1];
    } else if (dir <= 0 && e < ref && (dir === -1 || ref - e >= thresholdM)) {
      descent += ref - e;
      [ref, dir] = [e, -1];
    } else if (dir === 1 && ref - e >= thresholdM) {
      descent += ref - e;
      [ref, dir] = [e, -1];
    } else if (dir === -1 && e - ref >= thresholdM) {
      ascent += e - ref;
      [ref, dir] = [e, 1];
    }
  }
  return { ascent, descent };
}
