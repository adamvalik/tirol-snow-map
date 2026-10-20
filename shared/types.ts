// Data contract between the pipeline (writer) and the web app (reader).
// Bump SCHEMA_VERSION when a breaking change is made to these shapes.

export const SCHEMA_VERSION = 1;

export type SourceId = 'province-bz' | 'euregio-linea';

export interface Station {
  /** Stable id, `<source>:<code>` of the preferred record. */
  id: string;
  name: string;
  lon: number;
  lat: number;
  /** Metres above sea level. */
  elevation: number;
  /** Sources whose records were merged into this station, preferred first. */
  sources: SourceId[];
  operator: string;
  /** ISO 8601 UTC time of the newest reading used, or null if unknown. */
  observedAt: string | null;
  snowDepthCm: number | null;
  airTempC: number | null;
  windSpeedKmh: number | null;
  windGustKmh: number | null;
  windDirDeg: number | null;
  precip24hMm: number | null;
}

export interface SourceStatus {
  id: SourceId;
  name: string;
  url: string;
  licence: string;
  attribution: string;
  /** When the pipeline last fetched this source successfully (ISO 8601 UTC), or null. */
  fetchedAt: string | null;
  ok: boolean;
  error?: string;
  stationCount: number;
}

export interface StationsFile {
  schemaVersion: number;
  generatedAt: string;
  /** True when every source failed and the stations are carried over from an earlier run. */
  stale: boolean;
  sources: SourceStatus[];
  stations: Station[];
}
