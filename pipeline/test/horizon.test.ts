import { getPosition, getTimes } from 'suncalc';
import { describe, expect, it } from 'vitest';
import { cellAt, cellCenter, sampleGrid } from '../../shared/grid.ts';
import { curvatureDrop, type ElevationSampler, horizonAt, horizonProfile, SUN_RADIUS, sunWindows } from '../../shared/horizon.ts';
import { loadDemGrid } from '../src/dem.ts';

const LON = 11.35;
const LAT = 46.5;
const M_PER_DEG = (6_371_000 * Math.PI) / 180;
/** East and north offsets in metres from the test viewpoint. */
const offsets = (lon: number, lat: number) => ({
  east: (lon - LON) * M_PER_DEG * Math.cos((LAT * Math.PI) / 180),
  north: (lat - LAT) * M_PER_DEG,
});
const DEG = 180 / Math.PI;

describe('horizon profile', () => {
  it('sees a 100 m wall 200 m to the east at atan(100/200)', () => {
    const wall: ElevationSampler = (lon, lat) => {
      const { east } = offsets(lon, lat);
      return east >= 200 && east <= 220 ? 100 : 0;
    };
    const h = horizonProfile(LON, LAT, 0, {
      bands: [{ sampler: wall, until: 2000, step: 10 }],
      zMax: 100,
      observerHeight: 0,
      curvature: false,
    });
    expect(h.angles[90]).toBeCloseTo(Math.atan2(100, 200) * DEG, 1);
    expect(h.distances[90]).toBeCloseTo(200, -1);
    // Looking away from the wall the skyline is the flat ground.
    expect(h.angles[270]).toBeCloseTo(0, 5);
    expect(h.distances[270]).toBeNaN();
  });

  it('lets a 1500 m peak 100 km away sink below a 0.6° sun on a round earth', () => {
    const peak: ElevationSampler = (lon, lat) => (Math.abs(offsets(lon, lat).north - 100_000) <= 500 ? 1500 : 0);
    const opts = { bands: [{ sampler: peak, until: 101_000, step: 500 }], zMax: 1500, observerHeight: 0 };
    const flat = horizonProfile(LON, LAT, 0, { ...opts, curvature: false }).angles[0];
    const round = horizonProfile(LON, LAT, 0, opts).angles[0];
    expect(flat).toBeGreaterThan(0.6);
    expect(round).toBeLessThan(0.6);
    // The first sample on the peak is 500 m nearer, where it sinks a little less.
    expect(round).toBeCloseTo(Math.atan2(1500 - curvatureDrop(99_500), 99_500) * DEG, 3);
    // About 680 m of the peak drops out of sight at that distance.
    expect(curvatureDrop(100_000)).toBeCloseTo(683, 0);
  });

  it('falls back to the next band where the near sampler has no data', () => {
    const near: ElevationSampler = (lon, lat) => (offsets(lon, lat).east < 1000 ? 0 : null);
    const far: ElevationSampler = (lon, lat) => (offsets(lon, lat).east > 3000 ? 500 : 0);
    const h = horizonProfile(LON, LAT, 0, {
      bands: [
        { sampler: near, until: 5000, step: 25 },
        { sampler: far, until: 20_000, step: 250 },
      ],
      zMax: 500,
      observerHeight: 0,
      curvature: false,
    });
    expect(h.angles[90]).toBeCloseTo(Math.atan2(500, 3000) * DEG, 0);
  });
});

describe('sun windows', () => {
  const MIN = 60_000;

  it('starts the visible day when the sun clears a 12° ridge', () => {
    const angles = new Float32Array(360).fill(-5);
    for (let a = 80; a <= 100; a++) angles[a] = 12;
    const h = { stepDeg: 1, angles, distances: new Float32Array(360) };
    // The sun climbs from 0° to 30° in three hours, due east.
    const sunAt = (t: number) => ({ azimuth: 90, altitude: (t / (180 * MIN)) * 30 });
    const w = sunWindows(h, sunAt, 0, 180 * MIN);
    expect(w).toHaveLength(1);
    expect(w[0].start / MIN).toBeCloseTo(((12 - SUN_RADIUS) / 30) * 180, 1);
    expect(w[0].end).toBe(180 * MIN);
  });

  it('splits the day where a peak hides the sun around noon', () => {
    const angles = new Float32Array(360).fill(0);
    for (let a = 170; a <= 190; a++) angles[a] = 20;
    const h = { stepDeg: 1, angles, distances: new Float32Array(360) };
    // Low winter sun at 10°, moving from east to west over 12 hours.
    const sunAt = (t: number) => ({ azimuth: 90 + (t / (720 * MIN)) * 180, altitude: 10 });
    const w = sunWindows(h, sunAt, 0, 720 * MIN);
    expect(w).toHaveLength(2);
    // The skyline rises from 0° at 169° to 20° at 170°, so the sun goes at about 169.5°.
    expect(w[0].end / MIN).toBeCloseTo(((169.5 - 90) / 180) * 720, 0);
    expect(w[1].start / MIN).toBeCloseTo(((190.5 - 90) / 180) * 720, 0);
    expect(horizonAt(h, 359.5)).toBe(0);
  });
});

describe('horizon on the real terrain grid', async () => {
  const dem = await loadDemGrid();
  let zMax = -Infinity;
  for (const v of dem.values) zMax = Math.max(zMax, v);
  const sampler: ElevationSampler = (lon, lat) => sampleGrid(dem.grid, dem.values, lon, lat);
  const day = (lon: number, lat: number, ground: number) => {
    const h = horizonProfile(lon, lat, ground, { bands: [{ sampler, until: 100_000, step: 125 }], zMax });
    const times = getTimes(new Date('2026-12-21T11:00:00Z'), lat, lon);
    const w = sunWindows(h, (t) => getPosition(new Date(t), lat, lon), times.sunrise!.getTime() - 3_600_000, times.sunset!.getTime() + 3_600_000);
    return { h, w, sunrise: times.sunrise!.getTime(), sunset: times.sunset!.getTime() };
  };

  it('reproduces known elevations to within the 250 m cell averaging', () => {
    // Bolzano, Waltherplatz: about 262 m.
    expect(sampler(11.3548, 46.4983)).toBeGreaterThan(230);
    expect(sampler(11.3548, 46.4983)).toBeLessThan(320);
    // Ortler summit (3905 m) is smoothed by the cell average, but stays the highest ground around.
    expect(sampler(10.5448, 46.5088)).toBeGreaterThan(3500);
  });

  it('gives Bolzano a late winter sunrise and an early sunset behind its mountains', () => {
    const { h, w, sunrise, sunset } = day(11.3548, 46.4983, sampler(11.3548, 46.4983)!);
    expect(Math.max(...h.angles)).toBeGreaterThan(8);
    expect(w.length).toBeGreaterThan(0);
    expect(w[0].start - sunrise).toBeGreaterThan(20 * 60_000);
    expect(sunset - w.at(-1)!.end).toBeGreaterThan(20 * 60_000);
  });

  it('sees the sun from the Ortler before sunrise and after sunset on flat ground', () => {
    // The summit of the grid: its highest cell near the Ortler. A point 100 m below and beside
    // it would lose the afternoon sun behind the summit itself.
    const { col, row } = cellAt(dem.grid, 10.5448, 46.5088)!;
    let top = { col, row };
    for (let r = row - 3; r <= row + 3; r++) {
      for (let c = col - 3; c <= col + 3; c++) {
        if (dem.values[r * dem.grid.width + c] > dem.values[top.row * dem.grid.width + top.col]) top = { col: c, row: r };
      }
    }
    const { lon, lat } = cellCenter(dem.grid, top.col, top.row);
    const { h, w, sunrise, sunset } = day(lon, lat, sampler(lon, lat)!);
    // From 3800 m the skyline dips about 2° below the horizontal towards sunrise and sunset, and the
    // low winter sun takes some 15 minutes to climb that far.
    expect(horizonAt(h, 125)).toBeLessThan(-1);
    expect(horizonAt(h, 235)).toBeLessThan(-1);
    expect(w).toHaveLength(1);
    const MIN = 60_000;
    expect((sunrise - w[0].start) / MIN).toBeGreaterThan(8);
    expect((sunrise - w[0].start) / MIN).toBeLessThan(25);
    expect((w[0].end - sunset) / MIN).toBeGreaterThan(8);
    expect((w[0].end - sunset) / MIN).toBeLessThan(25);
  });
});
