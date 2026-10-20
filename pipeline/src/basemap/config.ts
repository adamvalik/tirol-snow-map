import type { ZoomBand } from './pmtiles.ts';

/**
 * Low zooms cover the map's whole pannable area; detailed zooms only South Tyrol plus a margin.
 * Zoom 15 (82 MB alone) is left out: zoom 14 already carries buildings and MapLibre over-zooms it.
 * Keeping the archive under 100 MB keeps it within GitHub's per-file limits.
 */
export const BANDS: ZoomBand[] = [
  { minZoom: 0, maxZoom: 9, bbox: { west: 9.4, south: 45.6, east: 13.4, north: 47.75 } },
  { minZoom: 10, maxZoom: 12, bbox: { west: 10.2, south: 46.1, east: 12.7, north: 47.25 } },
  { minZoom: 13, maxZoom: 14, bbox: { west: 10.35, south: 46.2, east: 12.5, north: 47.12 } },
];
