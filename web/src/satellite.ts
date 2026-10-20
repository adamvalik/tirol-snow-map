// Sentinel-2 "today from space" layer: tiles rendered by the pipeline (data/satellite/), drawn over
// the terrain colours and under the hillshade, roads and labels.

import type * as maplibregl from 'maplibre-gl';
import { SCHEMA_VERSION, type SatelliteFile } from '../../shared/types.ts';
import { escapeHtml, formatAge } from './format.ts';

const DATA = `${import.meta.env.BASE_URL}data/`;
export const SATELLITE_LAYER = 'satellite';

export async function loadSatellite(): Promise<SatelliteFile> {
  const res = await fetch(`${DATA}satellite.json`, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`satellite.json: HTTP ${res.status}`);
  const file = (await res.json()) as SatelliteFile;
  if (file.schemaVersion !== SCHEMA_VERSION) throw new Error(`satellite.json: unsupported schema ${file.schemaVersion}`);
  return file;
}

export function addSatelliteLayer(map: maplibregl.Map, file: SatelliteFile, beforeId: string | undefined, visible: boolean): boolean {
  if (!file.available || !file.bounds) return false;
  const base = new URL(DATA, window.location.href).href;
  map.addSource(SATELLITE_LAYER, {
    type: 'raster',
    tiles: [`${base}satellite/{z}/{x}/{y}.webp?v=${encodeURIComponent(file.version ?? file.generatedAt)}`],
    tileSize: 256,
    minzoom: file.minZoom,
    maxzoom: file.maxZoom,
    bounds: file.bounds,
    attribution: escapeHtml(file.attribution),
  });
  map.addLayer(
    {
      id: SATELLITE_LAYER,
      type: 'raster',
      source: SATELLITE_LAYER,
      minzoom: Math.max(0, (file.minZoom ?? 8) - 0.5),
      layout: { visibility: visible ? 'visible' : 'none' },
      paint: { 'raster-opacity': 1, 'raster-fade-duration': 150, 'raster-contrast': 0.05, 'raster-saturation': 0.1 },
    },
    beforeId,
  );
  return true;
}

/** "19 Oct" style date for a YYYY-MM-DD string. */
export function shortDate(day: string): string {
  return new Date(`${day}T12:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
}

export function satelliteInfoHtml(file: SatelliteFile): string {
  if (!file.available || !file.date) {
    return `<p><strong>Satellite picture</strong>: not available (${escapeHtml(file.reason ?? 'unknown')}).</p>`;
  }
  const pct = (x: number | undefined) => Math.round((x ?? 0) * 100);
  const fill =
    file.fallbackDate && file.shares
      ? ` ${pct(file.shares.fallback)} % of it is filled in from ${escapeHtml(shortDate(file.fallbackDate))} where clouds hid the ground, ` +
        `${pct(file.shares.empty)} % stays empty (the map shows through).`
      : ' Clouds are cut out, so the map shows through there.';
  return (
    `<p><strong>Satellite picture</strong>: Sentinel-2, ${escapeHtml(shortDate(file.date))} (${formatAge(`${file.date}T10:30:00Z`)}), ` +
    `the newest day with a mostly clear view.${fill} It is shown from zoom 8 inside the region.</p>`
  );
}
