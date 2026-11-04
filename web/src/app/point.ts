// The panel for a clicked point of the terrain, a bivouac or a via ferrata: elevation, snow and the
// point forecast. Layers can add their own part to it (the sun light adds "Sun here").
import * as maplibregl from 'maplibre-gl';
import { getForecast } from '../forecast.ts';
import { loadingHtml, openPanel, pointHtml, updatePanelBody } from '../panel.ts';

/**
 * A clicked map feature (a bivouac, a via ferrata's highest point) that may bring its own elevation,
 * its own label for it and its own snow summary instead of the point's.
 */
export interface Place {
  title: string;
  html: string;
  elevation: number | null;
  elevationLabel?: string;
  snowHtml?: string;
}

/** The point whose panel is open; its signal is aborted when the panel closes or another point opens. */
export interface OpenPoint {
  lngLat: maplibregl.LngLat;
  signal: AbortSignal;
}

/** A layer's part of the point panel. */
export interface PointExtension {
  /** HTML under the elevation and snow, above the forecast; asked for each time the panel is drawn. */
  html?(): string;
  /** A point's panel has just opened. */
  open?(point: OpenPoint): void;
  /** The panel closed, or another point or a station replaced it. */
  close?(): void;
}

export class PointPanel {
  private readonly marker = new maplibregl.Marker({ element: Object.assign(document.createElement('div'), { className: 'point-marker' }) });
  private abort: AbortController | null = null;
  private open: OpenPoint | null = null;
  private readonly extensions: PointExtension[] = [];

  /**
   * `exaggeration`: the terrain's current exaggeration, to turn the map's elevation back into metres.
   * `snowAt`: the snow summary for a point, or ''.
   */
  constructor(
    private readonly map: maplibregl.Map,
    private readonly exaggeration: () => number,
    private readonly snowAt: (lon: number, lat: number) => string,
  ) {}

  extend(e: PointExtension) {
    this.extensions.push(e);
  }

  /** The point whose panel is open, or null. */
  get current(): OpenPoint | null {
    return this.open;
  }

  readonly clear = () => {
    this.abort?.abort();
    this.marker.remove();
    this.open = null;
    for (const e of this.extensions) e.close?.();
  };

  async show(lngLat: maplibregl.LngLat, place?: Place) {
    this.clear();
    const abort = (this.abort = new AbortController());
    // queryTerrainElevation includes the exaggeration, so divide it back out.
    const raw = this.map.queryTerrainElevation(lngLat);
    const elevation = place?.elevation ?? (raw === null ? null : raw / this.exaggeration());
    this.marker.setLngLat(lngLat).addTo(this.map);
    const snowHtml = (place?.html ?? '') + (place?.snowHtml ?? this.snowAt(lngLat.lng, lngLat.lat));
    const extras = () => this.extensions.map((e) => e.html?.() ?? '').join('');
    openPanel(place?.title ?? 'Point forecast', loadingHtml(elevation, snowHtml + extras(), place?.elevationLabel), this.clear);
    this.open = { lngLat, signal: abort.signal };
    for (const e of this.extensions) e.open?.(this.open);
    let result;
    try {
      result = await getForecast(lngLat.lat, lngLat.lng, elevation, abort.signal);
    } catch (e) {
      if (abort.signal.aborted) return;
      result = e instanceof Error ? e : new Error(String(e));
    }
    if (!abort.signal.aborted) {
      updatePanelBody(pointHtml(lngLat.lat, lngLat.lng, elevation, result, snowHtml + extras(), place?.elevationLabel));
    }
  }
}
