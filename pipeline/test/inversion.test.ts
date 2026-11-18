import { describe, expect, it } from 'vitest';
import { airLayers, fogLayer, inversion, nearbyStations, type ProfileStation, skyAt } from '../../shared/inversion.ts';
import { loadDemGrid } from '../src/dem.ts';
import type { RawStation } from '../src/raw.ts';
import { clearSkyRadiation, markSunshine, measuredSunshine, skylineAngle, sunReaches, terrainOf } from '../src/sunshine.ts';

const T = '2026-11-18T10:40:00Z';

/** A station near Bolzano (the profile only looks at height), `dLon` apart so positions differ. */
const st = (elevation: number, airTempC: number, humidityPct: number | null, sunshine: boolean | null, observedAt = T, dLon = 0): ProfileStation => ({
  lon: 11.35 + dLon,
  lat: 46.5,
  elevation,
  observedAt,
  airTempC,
  humidityPct,
  sunshine,
});

describe('sunshine at a station', () => {
  it('has no clear-sky radiation at the horizon and close to 1000 W/m² with the sun high', () => {
    expect(clearSkyRadiation(0)).toBe(0);
    expect(clearSkyRadiation(-5)).toBe(0);
    expect(clearSkyRadiation(60)).toBeGreaterThan(850);
    expect(clearSkyRadiation(20)).toBeGreaterThan(250);
    expect(clearSkyRadiation(20)).toBeLessThan(400);
  });

  it('trusts the sunshine sensor first, then radiation against the clear sky', () => {
    expect(measuredSunshine({ sunshineShare: 1, radiationWm2: 10 }, 20)).toBe(true);
    expect(measuredSunshine({ sunshineShare: 0 }, 20)).toBe(false);
    expect(measuredSunshine({ sunshineShare: 0.3 }, 20)).toBeNull();
    const clear = clearSkyRadiation(20);
    expect(measuredSunshine({ radiationWm2: 0.9 * clear }, 20)).toBe(true);
    expect(measuredSunshine({ radiationWm2: 0.1 * clear }, 20)).toBe(false);
    expect(measuredSunshine({ radiationWm2: 0.45 * clear }, 20)).toBeNull();
    expect(measuredSunshine({}, 20)).toBeNull();
  });

  describe('on the real terrain grid', async () => {
    const terrain = terrainOf(await loadDemGrid());

    it('sees the cliffs over Salurn and an open sky over Bolzano towards the November morning sun', () => {
      // Readings of 18 Nov 2026, 09:40 CET: the sun at about 17° altitude, 145° azimuth.
      expect(skylineAngle(terrain, 11.1855, 46.2362, 212, 145)).toBeGreaterThan(30);
      expect(skylineAngle(terrain, 11.3111, 46.4983, 245, 145)).toBeLessThan(10);
    });

    it('decides nothing at night or for a station in a mountain shadow', () => {
      const r = (lon: number, lat: number, elevation: number, radiationWm2: number, observedAt: string) =>
        ({ lon, lat, elevation, radiationWm2, sunshineShare: null, observedAt }) as RawStation;
      const night = r(11.31, 46.4983, 245, 0, '2026-11-18T02:00:00Z');
      const salurn = r(11.1855, 46.2362, 212, 24, '2026-11-18T08:40:00Z');
      const bozen = r(11.31, 46.4983, 245, 246, '2026-11-18T08:40:00Z');
      const bozenDull = r(11.31, 46.4983, 245, 40, '2026-11-18T08:40:00Z');
      expect(sunReaches(terrain, night, new Date(night.observedAt!))).toBeNull();
      expect(sunReaches(terrain, salurn, new Date(salurn.observedAt!))?.reaches).toBe(false);
      markSunshine([night, salurn, bozen, bozenDull], terrain);
      expect(night.sunshine).toBeNull();
      expect(salurn.sunshine).toBeNull(); // dark, but in the shade of the cliffs: not fog for sure
      expect(bozen.sunshine).toBe(true);
      expect(bozenDull.sunshine).toBe(false);
    });
  });
});

describe('fog top', () => {
  // A sea of fog: valley and lower slopes in cloud, the sun from 1300 m up.
  const sea = [
    st(250, 1, 100, false),
    st(260, 1.5, 99, false, T, 0.01),
    st(300, 1, 98, null),
    st(500, 2, 100, false),
    st(900, 2.5, 97, false),
    st(1100, 3, 96, false),
    st(1300, 6, 60, true),
    st(1500, 7, 55, true),
    st(1800, 5, 50, true),
    st(2400, 1, 95, null),
  ];

  it('finds the top between the last station in cloud and the first in the sun', () => {
    const f = fogLayer(sea)!;
    // The station at 300 m is humid but in a mountain's shadow: unknown, so not counted.
    expect(f).toMatchObject({ kind: 'fog', cloudTopM: 1100, clearFromM: 1300, cloudBelow: 5, below: 5, clearAbove: 3, sunAbove: 3 });
    expect(f.warmerC).toBe(4); // median 6 °C above against 1.75 °C in the cloud
  });

  it('trusts the sun over a humidity sensor that reads 100 % after a cold night', () => {
    expect(skyAt(st(300, 1, 100, true))).toBe('clear');
    expect(skyAt(st(300, 1, 100, null))).toBeNull();
    expect(skyAt(st(300, 1, 80, null))).toBe('clear');
    expect(skyAt(st(300, 1, 95, false))).toBe('cloud');
    expect(skyAt(st(300, 1, 88, false))).toBeNull();
  });

  it('says nothing without daylight: humidity alone is not enough', () => {
    expect(fogLayer(sea.map((s) => ({ ...s, sunshine: null })))).toBeNull();
  });

  it('says nothing when the cloud reaches every station (an overcast day)', () => {
    expect(fogLayer(sea.map((s) => ({ ...s, sunshine: false, humidityPct: 99 })))).toBeNull();
  });

  it('does not make a layer of patchy valley fog', () => {
    const patchy = [
      st(220, 5, 100, false),
      st(230, 5, 99, false, T, 0.01),
      st(240, 8, 70, true),
      st(250, 8, 75, true, T, 0.01),
      st(260, 5, 98, false, T, 0.02),
      st(500, 8, 70, true),
      st(1000, 6, 70, true),
      st(1500, 4, 70, true),
    ];
    expect(fogLayer(patchy)).toBeNull();
  });

  it('prefers the split with fewest stations on the wrong side', () => {
    // Fog on the valley floor; dry slopes above it, then one damp side-valley floor at 970 m.
    const ground = [
      st(224, -1, 100, false),
      st(226, -1, 100, false, T, 0.01),
      st(254, -2, 100, false, T, 0.02),
      st(495, 2, 72, true),
      st(840, 0, 70, true),
      st(970, -2, 99, false),
      st(987, 0, 72, true),
      st(1470, -1, 77, true),
      st(1551, -1, 76, true),
    ];
    expect(fogLayer(ground)).toMatchObject({ cloudTopM: 254, clearFromM: 495 });
  });
});

describe('inversion', () => {
  it('finds warmer air above a cold valley', () => {
    const night = [st(240, -3, 99, null), st(260, -2, 99, null), st(600, 1, 80, null), st(700, 2, 70, null), st(1000, 3, 60, null), st(1100, 3, 60, null), st(2000, -2, 60, null)];
    const inv = inversion(night)!;
    expect(inv.kind).toBe('inversion');
    expect(inv.valleyM).toBe(250);
    expect(inv.topM).toBe(1050);
    expect(inv.warmerC).toBe(6); // 3 °C against -2.5 °C
  });

  it('finds none when the air cools with height', () => {
    expect(inversion([st(250, 8, 70, null), st(260, 8, 70, null), st(800, 5, 70, null), st(900, 4, 70, null), st(1500, 1, 70, null), st(1600, 0, 70, null)])).toBeNull();
  });
});

describe('stations around a point', () => {
  it('takes stations within 20 km read at about the same time as the newest', () => {
    const all = [st(250, 1, 90, null), st(300, 1, 90, null, '2026-11-18T08:00:00Z'), { ...st(400, 1, 90, null), lon: 11.8 }];
    expect(nearbyStations(all, 11.35, 46.5).map((s) => s.elevation)).toEqual([250]);
  });

  it('answers with fog first, else an inversion, else nothing', () => {
    const sea = [st(250, 1, 100, false), st(260, 1, 100, false, T, 0.01), st(500, 2, 99, false), st(1300, 6, 60, true), st(1400, 7, 55, true), st(1800, 6, 50, true)];
    expect(airLayers(sea, 11.35, 46.5)?.kind).toBe('fog');
    expect(airLayers(sea.map((s) => ({ ...s, sunshine: null })), 11.35, 46.5)?.kind).toBe('inversion');
    expect(airLayers(sea, 12.5, 47.2)).toBeNull();
  });
});
