import { describe, expect, it } from 'vitest';
import { clockTime, localMidnight } from '../src/sun.ts';
import { dayTimes, NO_SUN, rampColor, SUN_RAMP, type SunDayResult, sunMapPixels, sunMapScale } from '../src/sunMaps.ts';

const MINUTE = 60_000;

/** A day's maps for a few cells, starting at 07:00 local time. */
function day(first: number[], last: number[], minutes: number[]): SunDayResult {
  return {
    start: localMidnight('2026-12-21') + 7 * 60 * MINUTE,
    firstSun: Float32Array.from(first),
    lastSun: Float32Array.from(last),
    sunMinutes: Float32Array.from(minutes),
  };
}

describe('sun maps for a whole day', () => {
  it('steps through the day from before the first summit sees the sun to after the last loses it', () => {
    const times = dayTimes('2026-12-21');
    // The first flat sunrise in the region, in the east, is at 07:48.
    expect(clockTime(times[0])).toBe('07:18');
    expect(times.at(-1)! - times[0]).toBeGreaterThan(9 * 60 * MINUTE);
    expect(times[1] - times[0]).toBe(10 * MINUTE);
  });

  it('scales first sun to half hours of the clock, early sun light', () => {
    // 08:05 to 11:50, with one cell that never sees the sun.
    const d = day([65, 120, 180, 290, NaN], [], []);
    const s = sunMapScale('first', d);
    expect(s.ticks).toEqual(['08:00', '10:00', '12:00']);
    expect(s.sunnyLeft).toBe(true);
    const px = sunMapPixels('first', d, s);
    expect([px[0], px[1], px[2]]).toEqual(rampColor((65 - 60) / 240).map(Math.round));
    expect(px[0]).toBeGreaterThan(px[12]);
    expect([px[16], px[17], px[18]]).toEqual([...NO_SUN]);
  });

  it('puts the late last sun at the light end', () => {
    const d = day([], [300, 480], []);
    const s = sunMapScale('last', d);
    expect(s.sunnyLeft).toBe(false);
    const px = sunMapPixels('last', d, s);
    // The later cell is lighter.
    expect(px[4]).toBeGreaterThan(px[0]);
  });

  it('counts sun hours from zero, and no sun as its own colour', () => {
    const d = day([], [], [0, 150, 400]);
    const s = sunMapScale('hours', d);
    expect(s.ticks).toEqual(['0 h', '3.5 h', '7 h']);
    const px = sunMapPixels('hours', d, s);
    expect([px[0], px[1], px[2]]).toEqual([...NO_SUN]);
    expect(px[8]).toBeGreaterThan(px[4]);
  });

  it('keeps the ramp light to dark and its ends exact', () => {
    expect(rampColor(0)).toEqual([...SUN_RAMP[0]]);
    expect(rampColor(1)).toEqual([...SUN_RAMP.at(-1)!]);
    const light = SUN_RAMP.map(([r, g, b]) => 0.2126 * r + 0.7152 * g + 0.0722 * b);
    for (let i = 1; i < light.length; i++) expect(light[i]).toBeLessThan(light[i - 1]);
  });
});
