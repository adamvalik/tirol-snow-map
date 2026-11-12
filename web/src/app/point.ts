// The Place tab for a clicked point of the terrain, a bivouac or a via ferrata: elevation, snow, and
// the rows for the point forecast (open) and the sun. Layers can hook into opening and closing.
import * as maplibregl from 'maplibre-gl';
import { actionsHtml, openPanel, type PanelHead } from '../panel.ts';

/**
 * A clicked map feature (a bivouac, a via ferrata's highest point) that brings its own header, its
 * own elevation and its own snow summary instead of the point's.
 */
export interface Place {
  head: PanelHead;
  /** HTML at the top of the body: the feature's own facts. */
  html: string;
  elevation: number | null;
  snowHtml?: string;
  /** Label of the forecast row, e.g. "Forecast at the highest point". */
  forecastLabel?: string;
  /** HTML after the rows (sources, notes). */
  footHtml?: string;
}

/** The point whose panel is open; its signal is aborted when the panel closes or another point opens. */
export interface OpenPoint {
  lngLat: maplibregl.LngLat;
  signal: AbortSignal;
}

/** A layer's part of the point panel. */
export interface PointExtension {
  /** A point's panel has just opened. */
  open?(point: OpenPoint): void;
  /** The panel closed, or another point, a station or a track replaced it. */
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

  show(lngLat: maplibregl.LngLat, place?: Place) {
    // queryTerrainElevation includes the exaggeration, so divide it back out.
    const raw = this.map.queryTerrainElevation(lngLat);
    const elevation = place?.elevation ?? (raw === null ? null : raw / this.exaggeration());
    const elevText = elevation === null ? null : `${Math.round(elevation).toLocaleString('en-GB')} m`;
    const head: PanelHead = place?.head ?? {
      title: elevText ?? 'Point on the map',
      sub: `${elevText ? 'Point on the map, ' : ''}${lngLat.lat.toFixed(4)}° N, ${lngLat.lng.toFixed(4)}° E`,
      icon: 'mountains',
      tone: 'grey',
    };
    const html =
      (place?.html ?? '') +
      (place?.snowHtml ?? this.snowAt(lngLat.lng, lngLat.lat)) +
      actionsHtml({ lon: lngLat.lng, lat: lngLat.lat, ele: elevation }, { forecastOpen: true, forecastLabel: place?.forecastLabel }) +
      (place?.footHtml ?? '');
    // Opening replaces whatever was shown, whose close handler (this.clear for a point) runs first.
    openPanel(head, html, this.clear);
    const abort = (this.abort = new AbortController());
    this.marker.setLngLat(lngLat).addTo(this.map);
    this.open = { lngLat, signal: abort.signal };
    for (const e of this.extensions) e.open?.(this.open);
  }
}
