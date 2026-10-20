// Simulated snow: the terrain is painted white above an estimated snow line, at the full resolution
// of the elevation tiles (a color-relief layer on the DEM), so the peaks look snowed-in like a model.
// The snow line comes from the station readings; the satellite snow line moves it when available.

import type { ExpressionSpecification } from 'maplibre-gl';
import type { Station } from '../../shared/types.ts';

export const SNOW_SIM_LAYER = 'snow-sim';

/** A station counts as snowy from this depth; thinner readings are mostly sensor noise or patches. */
const SNOWY_FROM_CM = 2;
/** Too few readings give no usable line. */
const MIN_STATIONS = 10;

export interface SnowLine {
  /** First patches of snow (about 20 % of stations at this height report snow). */
  startM: number;
  /** Snow line proper (half the stations report snow). */
  lineM: number;
  /** Closed snow cover (about 80 %). */
  fullM: number;
  source: 'stations' | 'satellite';
  stationCount: number;
}

/**
 * Share of snowy stations as a non-decreasing function of elevation (isotonic regression,
 * pool-adjacent-violators), so one odd station cannot flip the line up and down.
 * Returns [elevation, share] blocks in ascending elevation.
 */
export function snowShareByElevation(points: { elevation: number; snowy: boolean }[]): [number, number][] {
  const sorted = [...points].sort((a, b) => a.elevation - b.elevation);
  const blocks: { sum: number; n: number; lo: number; hi: number }[] = [];
  for (const p of sorted) {
    blocks.push({ sum: p.snowy ? 1 : 0, n: 1, lo: p.elevation, hi: p.elevation });
    while (blocks.length > 1) {
      const b = blocks[blocks.length - 1];
      const a = blocks[blocks.length - 2];
      if (a.sum / a.n <= b.sum / b.n) break;
      blocks.splice(-2, 2, { sum: a.sum + b.sum, n: a.n + b.n, lo: a.lo, hi: b.hi });
    }
  }
  return blocks.map((b) => [(b.lo + b.hi) / 2, b.sum / b.n]);
}

/** Lowest elevation where the share reaches `level`, interpolated between blocks; null if never. */
function crossing(share: [number, number][], level: number): number | null {
  for (let i = 0; i < share.length; i++) {
    const [h, s] = share[i];
    if (s < level) continue;
    if (i === 0) return h;
    const [h0, s0] = share[i - 1];
    return h0 + ((level - s0) / (s - s0)) * (h - h0);
  }
  return null;
}

export function estimateSnowLine(stations: Station[], satelliteLineM: number | null = null): SnowLine | null {
  const points = stations
    .filter((s) => s.snowDepthCm !== null)
    .map((s) => ({ elevation: s.elevation, snowy: (s.snowDepthCm as number) >= SNOWY_FROM_CM }));
  if (points.length < MIN_STATIONS) return null;
  const share = snowShareByElevation(points);
  const line = crossing(share, 0.5);
  // No snow at half the stations even at the top: nothing to draw (unless the satellite sees a line).
  if (line === null && satelliteLineM === null) return null;
  const top = share[share.length - 1][0];
  const lineM = line ?? top;
  const startM = Math.min(crossing(share, 0.2) ?? lineM, lineM - 100);
  const fullM = Math.max(crossing(share, 0.8) ?? top + 300, lineM + 150);
  if (satelliteLineM === null) {
    return { startM: Math.round(startM), lineM: Math.round(lineM), fullM: Math.round(fullM), source: 'stations', stationCount: points.length };
  }
  // The satellite sees the whole region; keep the station-derived width of the patchy band around its line.
  const shift = satelliteLineM - lineM;
  return {
    startM: Math.round(startM + shift),
    lineM: Math.round(satelliteLineM),
    fullM: Math.round(fullM + shift),
    source: 'satellite',
    stationCount: points.length,
  };
}

/** White, transparent below the snow line, fading in through the patchy band to near-opaque above it. */
export function snowSimColor(line: SnowLine): ExpressionSpecification {
  const below = Math.min(line.startM - 150, line.lineM - 250);
  return [
    'interpolate',
    ['linear'],
    ['elevation'],
    below, 'rgba(250, 252, 255, 0)',
    line.startM, 'rgba(250, 252, 255, 0.3)',
    line.lineM, 'rgba(250, 252, 255, 0.85)',
    line.fullM, 'rgba(255, 255, 255, 1)',
  ] as ExpressionSpecification;
}

export function snowLineHtml(line: SnowLine | null): string {
  if (!line) return '<p><strong>Snow</strong>: the stations report no snow, so none is drawn.</p>';
  const from = line.source === 'satellite' ? 'satellite snow cover, band width from the stations' : `${line.stationCount} station readings`;
  return (
    `<p><strong>Snow</strong> (simulated): patches from about ${line.startM.toLocaleString('en-GB')} m, ` +
    `snow line about <strong>${line.lineM.toLocaleString('en-GB')} m</strong>, closed cover above ` +
    `${line.fullM.toLocaleString('en-GB')} m (from ${from}). One line for the whole region, so sunny and shady slopes look alike.</p>`
  );
}
