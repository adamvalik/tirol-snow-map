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
        /**
         * Set when stations report snow on ground the satellite saw bare on `viewDate` (snow fell
         * since): the satellite layers then show less snow than there is.
         */
        newSnow?: { viewDate: string; stations: number; withSnow: number };
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

/**
 * forecast.json: forecast new snow on the model grid, one PNG per frame (data/forecast/), each the
 * snowfall accumulated from `start` to the frame time.
 */
export interface ForecastFile {
  schemaVersion: number;
  generatedAt: string;
  available: boolean;
  reason?: string;
  /** When Open-Meteo was last fetched successfully (ISO 8601 UTC). */
  fetchedAt?: string;
  /** True when the latest fetch failed and these frames come from an earlier one. */
  stale?: boolean;
  error?: string;
  /** Start of the accumulation (ISO 8601 UTC, whole hour). */
  start?: string;
  stepHours?: number;
  frames?: { time: string; file: string; maxCm: number }[];
  /** Forecast points fetched (coarse grid, interpolated to 250 m with the terrain). */
  points?: number;
  /** Lowest and highest freezing level over the period (m). */
  freezingLevelM?: [number, number];
  source: string;
  attribution: string;
}

/** history.json: daily snapshots for the time slider, newest first. */
export interface HistoryFile {
  schemaVersion: number;
  generatedAt: string;
  days: HistoryDay[];
}

export interface HistoryDay {
  /** Local day (Europe/Rome), YYYY-MM-DD. */
  date: string;
  /** Snapshot metadata, a snow.json whose `files` point into the day folder (relative to data/). */
  snow: string;
  /** Station readings of that day's last update (relative to data/), or null when not stored. */
  stations: string | null;
  /** Rebuilt from cached satellite passes before the app kept history: snow cover only, no depth estimate. */
  backfilled: boolean;
  coverDate: string | null;
  snowLineM: number | null;
}

export type StepId = 'stations' | 'snow' | 'satellite' | 'forecast';

/** status.json: health of the last pipeline run, for the app warnings and the workflow monitor. */
export interface StatusFile {
  schemaVersion: number;
  generatedAt: string;
  steps: Record<
    StepId,
    {
      ok: boolean;
      /** What failed in the last run (an upstream that could not be reached, an exception). */
      problems: string[];
      /** Runs in a row with problems; 0 when the last run was clean. */
      consecutiveFailures: number;
      /** When the current run of failures started (ISO 8601 UTC), or null. */
      failingSince: string | null;
    }
  >;
}
