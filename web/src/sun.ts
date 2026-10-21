// Sun light: the hillshade is lit from where the real sun stands at a chosen date and time of
// day, so slopes facing the sun are bright and slopes turned away stay dark. MapLibre's hillshade
// shades each slope against the light only; one mountain does not cast a shadow onto the next.
//
// SunCalc 2.x returns degrees with azimuth clockwise from north (1.x used radians from south),
// which is also how MapLibre's illumination direction is measured, so it passes straight in.

import type { HillshadeLayerSpecification, SkySpecification } from 'maplibre-gl';
import { getPosition, getTimes } from 'suncalc';
import { compass, TZ } from './format.ts';

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

/** "08:30 · sun 14° high in the SE"; the date has its own field next to it. */
export function sunLabel(t: number, sun: SunPosition): string {
  const where =
    sun.altitude >= 0.5
      ? `sun ${Math.round(sun.altitude)}° high in the ${compass(sun.azimuth)}`
      : sun.altitude > -6
        ? `sun on the horizon in the ${compass(sun.azimuth)}`
        : 'night';
  return `${clockTime(t)} · ${where}`;
}

/** Shareable time in the address, to the minute: 2026-10-21T06:30Z. */
export const sunParam = (t: number): string => `${new Date(t).toISOString().slice(0, 16)}Z`;

// --- Map styling -------------------------------------------------------------------

type Rgba = readonly [number, number, number, number];

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const mix = (a: Rgba, b: Rgba, f: number): Rgba => a.map((v, i) => v + (b[i] - v) * clamp01(f)) as unknown as Rgba;
const css = ([r, g, b, a]: Rgba): string => `rgba(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)}, ${+a.toFixed(2)})`;
const hex = (c: Rgba): string => `#${c.slice(0, 3).map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`;

/** Shade turned away from the sun is bluish, as on snow; the light is warm when the sun is low. */
const SHADOW: Rgba = [32, 40, 68, 0.75];
const LOW_LIGHT: Rgba = [255, 210, 160, 0.55];
const HIGH_LIGHT: Rgba = [255, 252, 240, 0.65];

/**
 * Paint for the hillshade layer. Without a sun it is the style's usual light: the cartographic
 * north-west light that turns with the screen. With a sun the light is fixed to the map.
 * The satellite photo has its own light and shade, so the drawn shading is toned down over it.
 */
export type HillshadePaint = NonNullable<HillshadeLayerSpecification['paint']>;

export function hillshadePaint(sun: SunPosition | null, satellite: boolean): HillshadePaint {
  if (!sun) {
    return {
      'hillshade-method': 'standard',
      'hillshade-exaggeration': satellite ? 0.12 : 0.3,
      'hillshade-illumination-direction': 335,
      'hillshade-illumination-altitude': 45,
      'hillshade-illumination-anchor': 'viewport',
      'hillshade-shadow-color': '#4f5058',
      'hillshade-highlight-color': '#ffffff',
    };
  }
  return {
    // 'standard' ignores the light's altitude; 'basic' shades by the angle between the sun and each slope.
    'hillshade-method': 'basic',
    'hillshade-exaggeration': satellite ? 0.25 : 0.5,
    'hillshade-illumination-direction': ((sun.azimuth % 360) + 360) % 360,
    // MapLibre takes no negative altitude; below the horizon the night overlay darkens the map instead.
    'hillshade-illumination-altitude': Math.max(0, sun.altitude),
    'hillshade-illumination-anchor': 'map',
    'hillshade-shadow-color': css(SHADOW),
    'hillshade-highlight-color': css(sunlight(sun.altitude)),
  };
}

/** Warm near the horizon, near white high up, fading out once the sun is 3° below the horizon. */
function sunlight(altitude: number): Rgba {
  const [r, g, b, a] = mix(LOW_LIGHT, HIGH_LIGHT, (altitude - 3) / 22);
  return [r, g, b, a * clamp01((altitude + 3) / 3)];
}

/** Opacity of the dark overlay: none while the sun is up, deepest at the end of nautical twilight. */
export const nightOpacity = (altitude: number): number => +(0.6 * clamp01(-altitude / 12)).toFixed(3);

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
