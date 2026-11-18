// Sun light: the map is lit for where the real sun stands at a chosen date and time of day. The
// hillshade models the relief, lit from the sun's direction; where the sun does not reach (behind
// a ridge, on slopes turned away, below the horizon) the shade layer of shadows.ts lies on top.
// This module has the sun's position and day, and the colours of light, shade, night and sky.
//
// SunCalc 2.x returns degrees with azimuth clockwise from north (1.x used radians from south),
// which is also how MapLibre's illumination direction is measured, so it passes straight in.

import type { HillshadeLayerSpecification, SkySpecification } from 'maplibre-gl';
import { getPosition, getTimes } from 'suncalc';
import { TZ } from './format.ts';
import type { ShadeLook } from './shadowWorker.ts';

export interface SunPosition {
  /** Degrees clockwise from north. */
  azimuth: number;
  /** Degrees above the horizon, refraction-corrected; negative below it. */
  altitude: number;
}

export const sunPosition = (t: number, lat: number, lon: number): SunPosition => getPosition(new Date(t), lat, lon);

// --- Local days (Europe/Rome, with its clock changes) ---------------------------

const MINUTE = 60_000;
const offsetFormat = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, timeZoneName: 'longOffset' });

/** Minutes Europe/Rome is ahead of UTC at instant t: 60 in winter, 120 in summer. */
export function zoneOffsetMinutes(t: number): number {
  const name = offsetFormat.formatToParts(new Date(t)).find((p) => p.type === 'timeZoneName')?.value ?? '';
  const m = /GMT([+-])(\d{2}):(\d{2})/.exec(name);
  return m ? (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3])) : 0;
}

/** The local calendar day of instant t, as YYYY-MM-DD. */
export const localDate = (t: number): string => new Date(t).toLocaleDateString('en-CA', { timeZone: TZ });

/** UTC instant of local midnight at the start of `date` (YYYY-MM-DD). */
export function localMidnight(date: string): number {
  const utc = Date.parse(`${date}T00:00:00Z`);
  // The clocks change at 01:00 UTC, so the offset at 00:00 UTC is the one in force at local midnight.
  return utc - zoneOffsetMinutes(utc) * MINUTE;
}

const nextDate = (date: string): string => new Date(Date.parse(`${date}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);

/** Length of a local day in minutes: 1440, or 1380 and 1500 on the days the clocks change. */
export const dayMinutes = (date: string): number => (localMidnight(nextDate(date)) - localMidnight(date)) / MINUTE;

export interface SunDay {
  sunrise: number | null;
  sunset: number | null;
}

/** Sunrise and sunset on a local day, over a flat horizon; ridges are not taken into account. */
export function sunDay(date: string, lat: number, lon: number): SunDay {
  const noon = localMidnight(date) + 12 * 60 * MINUTE;
  const t = getTimes(new Date(noon), lat, lon, 0, zoneOffsetMinutes(noon));
  return { sunrise: t.sunrise?.getTime() ?? null, sunset: t.sunset?.getTime() ?? null };
}

// --- Labels ------------------------------------------------------------------------

export const clockTime = (t: number): string =>
  new Date(t).toLocaleTimeString('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit' });

/** Shareable time in the address, to the minute: 2026-10-21T06:30Z. */
export const sunParam = (t: number): string => `${new Date(t).toISOString().slice(0, 16)}Z`;

// --- Map styling -------------------------------------------------------------------

type Rgba = readonly [number, number, number, number];

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
/** 0 at `from`, 1 at `to`, linear in between and clamped. */
const ramp = (v: number, from: number, to: number) => clamp01((v - from) / (to - from));
const mix = (a: Rgba, b: Rgba, f: number): Rgba => a.map((v, i) => v + (b[i] - v) * clamp01(f)) as unknown as Rgba;
const withAlpha = (c: Rgba, a: number): Rgba => [c[0], c[1], c[2], a];
const css = ([r, g, b, a]: Rgba): string => `rgba(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)}, ${+a.toFixed(2)})`;
const hex = (c: Rgba): string => `#${c.slice(0, 3).map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`;

export type HillshadePaint = NonNullable<HillshadeLayerSpecification['paint']>;

/**
 * Height of the light on the relief. Fixed, not the sun's, so flat ground keeps its colour at any
 * time of day; a little higher under a high summer sun, which flattens the relief.
 */
const reliefAltitude = (h: number) => 30 + 10 * ramp(h, 30, 60);
/** Highlight colours: rose as the first light touches the summits, golden when low, warm white high up. */
const ROSE: Rgba = [255, 172, 156, 1];
const GOLD: Rgba = [255, 206, 146, 1];
const WARM: Rgba = [255, 236, 206, 1];
const WHITE_LIGHT: Rgba = [255, 246, 230, 1];
/** Relief shading, and the shade where the sun does not reach: a cool blue, as shade on snow. */
const RELIEF_SHADOW: Rgba = [30, 42, 80, 1];
const SHADE_RGB = [22, 38, 96] as const;

/**
 * Paint for the hillshade layer. Without a sun it is the style's usual light: the cartographic
 * north-west light that turns with the screen. With a sun the light comes from the sun's direction,
 * fixed to the map, and only models the relief: slopes facing the sun lighten and slopes turned
 * away darken a little, also inside the shade. Where the sun really does not reach is the shade
 * layer's job (shadows.ts). The satellite photo has its own light and shade, so the drawn shading
 * is toned down over it.
 */
export function hillshadePaint(sun: SunPosition | null, satellite: boolean): HillshadePaint {
  if (!sun) {
    // A main light from the north-west and two soft side lights, as on Swiss relief maps: the main
    // light models the big ridges, the side lights bring out gullies that face it head-on. Shadows
    // are a cool blue-grey, highlights warm white.
    const strength = satellite ? 0.35 : 1;
    const a = (v: number) => +(v * strength).toFixed(2);
    return {
      'hillshade-method': 'multidirectional',
      'hillshade-exaggeration': satellite ? 0.2 : 0.45,
      'hillshade-illumination-direction': [335, 285, 20],
      'hillshade-illumination-altitude': [40, 30, 30],
      'hillshade-illumination-anchor': 'viewport',
      'hillshade-shadow-color': [`rgba(36, 48, 74, ${a(0.6)})`, `rgba(52, 62, 86, ${a(0.22)})`, `rgba(52, 62, 86, ${a(0.22)})`],
      'hillshade-highlight-color': [`rgba(255, 251, 238, ${a(0.55)})`, `rgba(255, 255, 255, ${a(0.15)})`, `rgba(255, 255, 255, ${a(0.15)})`],
    };
  }
  const h = sun.altitude;
  // A high sun flattens the relief; the photo has its own.
  const contrast = (1 - 0.4 * ramp(h, 25, 65)) * (satellite ? 0.45 : 1);
  // Direct light fades out as the last summits lose the sun (about 2° below the horizon).
  const direct = ramp(h, -2.5, 0.5);
  const light = h >= 20 ? mix(WARM, WHITE_LIGHT, ramp(h, 20, 45)) : h >= 2 ? mix(GOLD, WARM, ramp(h, 2, 20)) : mix(ROSE, GOLD, ramp(h, -2, 2));
  const glow = 0.26 + 0.08 * (1 - ramp(h, 3, 15));
  return {
    // 'standard' ignores the light's altitude; 'basic' shades by the angle between the light and each slope.
    'hillshade-method': 'basic',
    'hillshade-exaggeration': satellite ? 0.3 : 0.6,
    'hillshade-illumination-direction': ((sun.azimuth % 360) + 360) % 360,
    'hillshade-illumination-altitude': reliefAltitude(h),
    'hillshade-illumination-anchor': 'map',
    'hillshade-shadow-color': css(withAlpha(RELIEF_SHADOW, 0.5 * contrast)),
    'hillshade-highlight-color': css(withAlpha(light, glow * contrast * direct)),
  };
}

/** Colour and opacity of full shade, where the sun does not reach (shadows.ts). */
export const shadeLook = (satellite: boolean): ShadeLook => ({
  color: SHADE_RGB,
  opacity: satellite ? 0.36 : 0.42,
});

/**
 * Opacity of the dark overlay: a faint dimming as the sun sinks towards the horizon, deepening
 * through twilight once the summits have lost the sun, deepest at the end of nautical twilight.
 */
export const nightOpacity = (altitude: number): number =>
  +(0.06 * (1 - ramp(altitude, 0, 10)) + 0.44 * ramp(-altitude, 2, 12)).toFixed(3);

export const NIGHT_COLOR = '#0b1330';

export const DEFAULT_SKY: SkySpecification = {
  'sky-color': '#9ec9f0',
  'horizon-color': '#e8f1f8',
  'fog-color': '#e8edf0',
  'sky-horizon-blend': 0.6,
  'horizon-fog-blend': 0.6,
  'fog-ground-blend': 0.4,
};

const SKY_DAY = { sky: [158, 201, 240, 1], horizon: [232, 241, 248, 1], fog: [232, 237, 240, 1] } as const;
const SKY_LOW = { sky: [150, 178, 214, 1], horizon: [246, 205, 160, 1], fog: [238, 219, 198, 1] } as const;
const SKY_NIGHT = { sky: [16, 26, 51, 1], horizon: [44, 58, 92, 1], fog: [35, 44, 64, 1] } as const;

/** Sky and haze for the sun's altitude: day blue, warm near the horizon, dark at night. */
export function skyFor(altitude: number): SkySpecification {
  const [from, to, f] =
    altitude >= 2 ? [SKY_LOW, SKY_DAY, (altitude - 2) / 10] : [SKY_NIGHT, SKY_LOW, (altitude + 8) / 10];
  return {
    ...DEFAULT_SKY,
    'sky-color': hex(mix(from.sky, to.sky, f)),
    'horizon-color': hex(mix(from.horizon, to.horizon, f)),
    'fog-color': hex(mix(from.fog, to.fog, f)),
  };
}

/** Background for the time slider: dark at night, bright by day, blended through twilight. */
export function dayGradient(day: SunDay, start: number, minutes: number): string {
  const night = '#3a4560';
  const light = '#f2c45a';
  const pct = (t: number) => `${(clamp01((t - start) / (minutes * MINUTE)) * 100).toFixed(1)}%`;
  if (day.sunrise === null || day.sunset === null) return night;
  const fade = 30 * MINUTE;
  return `linear-gradient(to right, ${night} ${pct(day.sunrise - fade)}, ${light} ${pct(day.sunrise + fade)}, ${light} ${pct(day.sunset - fade)}, ${night} ${pct(day.sunset + fade)})`;
}
