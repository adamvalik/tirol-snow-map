// Sentinel-2 "today from space" layer: tiles rendered by the pipeline (data/satellite/), drawn over
// the terrain colours and under the hillshade, roads and labels.

import type * as maplibregl from 'maplibre-gl';
import { SCHEMA_VERSION, type SatelliteFile, type SatellitePass } from '../../shared/types.ts';
import { escapeHtml, formatAge, formatTime } from './format.ts';
import { factsHtml } from './placeHtml.ts';

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

/** What each pass in the search was used for, or why it was not. */
export function passRole(pass: SatellitePass, file: SatelliteFile): string {
  if (pass.date === file.date) return 'Picture';
  if (pass.date === file.fallbackDate) return 'Fill-in';
  return pass.coverage < (file.minClearShare ?? 0.45) ? 'Edge of the region only' : 'Too cloudy';
}

export function satelliteInfoHtml(file: SatelliteFile, now = Date.now()): string {
  if (!file.available || !file.date) {
    return `<p><strong>Satellite picture</strong>: not available (${escapeHtml(file.reason ?? 'unknown')}).</p>`;
  }
  const pct = (x: number | undefined) => `${Math.round((x ?? 0) * 100)} %`;
  const day = escapeHtml(shortDate(file.date));
  const parts = [`<p>The newest Sentinel-2 pass with a mostly clear view, ${day} (${formatAge(`${file.date}T10:30:00Z`, now)}). Made of:</p>`];
  if (file.shares) {
    const fill = file.fallbackDate ? escapeHtml(shortDate(file.fallbackDate)) : null;
    parts.push(
      factsHtml([
        [day, `${pct(file.shares.main)}<small>picture</small>`],
        [fill ?? 'Fill-in', fill ? `${pct(file.shares.fallback)}<small>fill-in</small>` : '–'],
        ['Empty', `${pct(file.shares.empty)}<small>clouds</small>`],
      ]),
    );
  }
  if (file.passes?.length) {
    const rows = file.passes
      .map((p) => {
        const role = passRole(p, file);
        const used = role === 'Picture' || role === 'Fill-in';
        return `<tr${used ? ' class="used"' : ''}><td>${escapeHtml(shortDate(p.date))}</td><td>${pct(p.coverage)}</td><td>${pct(p.clearShare)}</td><td>${role}</td></tr>`;
      })
      .join('');
    parts.push(
      `<table class="passes"><thead><tr><th>Pass</th><th>Covered</th><th>Clear</th><th>Used as</th></tr></thead><tbody>${rows}</tbody></table>`,
    );
  }
  const rule = file.passes?.length
    ? `Covered: the share of the region in the pass. Clear: the share seen without clouds, estimated from the scenes' cloud cover. ` +
      `A pass becomes the picture from ${pct(file.minClearShare ?? 0.45)} clear; where it is cloudy, an older pass fills in. `
    : 'Where the pass was cloudy, an older one fills in; where both were, the map shows through. ';
  const checked = file.checkedAt ? `Last looked for a newer pass ${formatTime(file.checkedAt)} (${formatAge(file.checkedAt, now)}). ` : '';
  parts.push(`<p class="muted">${rule}Sentinel-2 passes every 2–5 days. ${checked}Shown from zoom 8.</p>`);
  return parts.join('');
}
