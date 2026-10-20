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

/** snow.json: metadata for the snow cover and estimated depth layers (PNG files on MODEL_GRID). */
export interface SnowFile {
  schemaVersion: number;
  generatedAt: string;
  grid: import('./grid.ts').GridSpec;
  cover:
    | {
        available: true;
        /** Observation day of the satellite product, YYYY-MM-DD. */
        date: string;
        sensor: 'Sentinel-2' | 'VIIRS' | 'MODIS';
        product: string;
        fetchedAt: string;
        /** Pixel size of the cover map (m): about 60 for Sentinel-2, 500 for the Copernicus product. */
        resolutionM: number;
        /**
         * Cell counts inside the grid for the composite: `snow`/`bare` seen on the newest day,
         * `olderView` taken from an earlier day because of clouds, `cloud` with no clear view at all.
         */
        stats: { snow: number; bare: number; olderView: number; cloud: number; nodata: number };
        /** Products combined, newest first ("last clear view" per cell). */
        composite: { date: string; sensor: 'Sentinel-2' | 'VIIRS' | 'MODIS'; product: string }[];
        /** Share of the region (0–1) seen on the newest day, on older days, and never (clouds). */
        shares: { newest: number; older: number; never: number };
        /** Elevation (m) above which most clear ground is snow-covered, or null if unclear. */
        snowLineM: number | null;
        source: string;
        licence: string;
        attribution: string;
      }
    | { available: false; reason: string };
  depth: {
    method: 'trend' | 'trend+residuals';
    /** depth = a + b·elevation (cm, elevation in m) before residual correction. */
    trend: { a: number; b: number };
    stationCount: number;
    /** Newest station reading used. */
    stationsObservedAt: string | null;
    stationElevationRange: [number, number];
    validation: {
      maeCm: { trend: number; 'trend+residuals': number };
      byBand: { label: string; n: number; maeCm: number }[];
    };
    stats: { cells: number; maskedBySatellite: number; cloudy: number; noCover: number; high: number; medium: number; low: number };
  } | null;
  /**
   * `white`: the snow seen by Sentinel-2 at about 60 m (white, transparent elsewhere), same corners
   * as the grid. The others are on the 250 m grid.
   */
  files: { white: string | null; cover: string | null; depth: string | null; confidence: string | null; data: string | null };
}

/** satellite.json: the Sentinel-2 "today from space" tile layer (data/satellite/{z}/{x}/{y}.webp). */
export interface SatelliteFile {
  schemaVersion: number;
  generatedAt: string;
  available: boolean;
  /** Why there is no picture (when `available` is false). */
  reason?: string;
  /** Acquisition day, YYYY-MM-DD (UTC). */
  date?: string;
  /** Share of the region inside that day's passes, and expected share seen without clouds (0–1). */
  coverage?: number;
  clearShare?: number;
  scenes?: string[];
  /** Older day used to fill pixels the main day hides under clouds, if any. */
  fallbackDate?: string;
  /** Share of the picture's pixels from the main day, the fill-in day, and still empty (0–1). */
  shares?: { main: number; fallback: number; empty: number };
  bounds?: [number, number, number, number];
  minZoom?: number;
  maxZoom?: number;
  /** Changes whenever the tiles are re-rendered; used to bust browser caches. */
  version?: string;
  attribution: string;
}
