import type { SourceId } from '../../shared/types.ts';
import { SNOW_MAX_CM, SNOW_NOISE_FLOOR_CM } from './config.ts';

/** One station as reported by a single source, already converted to app units. */
export interface RawStation {
  source: SourceId;
  /** Data provider within the source; two records from the same provider are never merged. */
  provider: string;
  code: string;
  name: string;
  lon: number;
  lat: number;
  elevation: number;
  operator: string;
  observedAt: string | null;
  snowDepthCm: number | null;
  airTempC: number | null;
  windSpeedKmh: number | null;
  windGustKmh: number | null;
  windDirDeg: number | null;
  precip24hMm: number | null;
}

export const round = (v: number, digits = 1): number => {
  const f = 10 ** digits;
  return Math.round(v * f) / f;
};

export const num = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : null;

export const msToKmh = (v: number | null): number | null => (v === null ? null : round(v * 3.6));

/**
 * Snow sensors read a few cm below zero on bare ground. Those are clamped to 0;
 * values far below zero or implausibly high are dropped as sensor errors.
 */
export function cleanSnowDepth(cm: number | null): number | null {
  if (cm === null) return null;
  if (cm < SNOW_NOISE_FLOOR_CM || cm > SNOW_MAX_CM) return null;
  return cm < 0 ? 0 : round(cm);
}

export const inBbox = (
  lon: number,
  lat: number,
  b: { west: number; south: number; east: number; north: number },
): boolean => lon >= b.west && lon <= b.east && lat >= b.south && lat <= b.north;

export const hoursBetween = (aIso: string, bIso: string): number =>
  Math.abs(Date.parse(aIso) - Date.parse(bIso)) / 3_600_000;

/** Minutes Europe/Rome is ahead of UTC at the given instant (60 in winter, 120 in summer). */
export function romeOffsetMinutes(at: Date): number {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Rome',
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(at);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const local = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'));
  return Math.round((local - Math.floor(at.getTime() / 60_000) * 60_000) / 60_000);
}
