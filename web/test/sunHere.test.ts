import { describe, expect, it } from 'vitest';
import type { Horizon } from '../../shared/horizon.ts';
import { localMidnight, sunPosition } from '../src/sun.ts';
import { horizonChartSvg, sunHereFor, sunHereHtml } from '../src/sunHere.ts';

const LON = 11.35;
const LAT = 46.5;
const sunAt = (t: number) => sunPosition(t, LAT, LON);

/** A flat skyline with a 15° ridge 2 km away to the south-east. */
function ridgeSE(): Horizon {
  const angles = new Float32Array(360);
  const distances = new Float32Array(360).fill(NaN);
  for (let a = 110; a <= 150; a++) {
    angles[a] = 15;
    distances[a] = 2000;
  }
  return { stepDeg: 1, angles, distances };
}

describe('sun at a clicked point', () => {
  it('delays the first sun behind a ridge and keeps the flat sunset', () => {
    const s = sunHereFor(LON, LAT, ridgeSE(), '2026-12-21', sunAt);
    expect(s.windows).toHaveLength(1);
    expect(s.windows[0].start).toBeGreaterThan(s.flat.sunrise! + 60 * 60_000);
    // An open horizon to the south-west: last sun within a few minutes of the flat sunset.
    expect(Math.abs(s.windows[0].end - s.flat.sunset!)).toBeLessThan(5 * 60_000);
  });

  it('names the ridge the sun rises over and the open horizon it sets behind', () => {
    const s = sunHereFor(LON, LAT, ridgeSE(), '2026-12-21', sunAt);
    const html = sunHereHtml(s, localMidnight('2026-12-21') + 12 * 3_600_000);
    expect(html).toContain('over a ridge in the SE, 15° high, 2.0 km away');
    expect(html).toContain('in the SW, over an open horizon');
    expect(html).toContain('(flat horizon 07:55)');
    expect(html).toContain('Sunshine');
    expect(html).not.toContain('Hidden');
  });

  it('says so when the sun never clears the skyline', () => {
    const wall: Horizon = { stepDeg: 1, angles: new Float32Array(360).fill(40), distances: new Float32Array(360).fill(500) };
    const s = sunHereFor(LON, LAT, wall, '2026-12-21', sunAt);
    expect(s.windows).toEqual([]);
    expect(sunHereHtml(s, s.start)).toContain('None on this day');
  });

  it('draws the skyline, the sun path in both styles and the marker for the chosen time', () => {
    const s = sunHereFor(LON, LAT, ridgeSE(), '2026-12-21', sunAt);
    const noon = localMidnight('2026-12-21') + 12 * 3_600_000;
    const svg = horizonChartSvg(s, noon);
    expect(svg).toContain('class="skyline"');
    expect(svg).toContain('class="sun-path"');
    expect(svg).toContain('class="sun-path hidden"');
    expect(svg).toContain('class="sun-now"');
    // Hour labels along the path, local time.
    expect(svg).toMatch(/>12<\/text>/);
    // At midnight the sun is far below the chart: no marker.
    expect(horizonChartSvg(s, s.start)).not.toContain('sun-now');
  });
});
