import * as maplibregl from 'maplibre-gl';
import type { MapLayerMouseEvent } from 'maplibre-gl';
import type { FeatureCollection, Point } from 'geojson';
import { SCHEMA_VERSION, type Station, type StationsFile } from '../../shared/types.ts';
import { snowColorExpression } from './colors.ts';
import { escapeHtml, fmt, formatAge } from './format.ts';

export const STATIONS_URL = `${import.meta.env.BASE_URL}data/stations.json`;
const LAYER = 'stations';

/** `url` defaults to the latest readings; the time slider passes a day's copy. */
export async function loadStations(url = STATIONS_URL): Promise<StationsFile> {
  const res = await fetch(url, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`stations.json: HTTP ${res.status}`);
  const file = (await res.json()) as StationsFile;
  if (file.schemaVersion !== SCHEMA_VERSION) throw new Error(`stations.json: unsupported schema ${file.schemaVersion}`);
  return file;
}

function toGeoJson(stations: Station[]): FeatureCollection<Point> {
  return {
    type: 'FeatureCollection',
    features: stations.map((s, i) => ({
      type: 'Feature',
      id: i,
      geometry: { type: 'Point', coordinates: [s.lon, s.lat] },
      properties: { index: i, snowDepthCm: s.snowDepthCm, hasSnow: s.snowDepthCm !== null ? 1 : 0 },
    })),
  };
}

export function tooltipHtml(s: Station): string {
  return (
    `<strong>${escapeHtml(s.name)}</strong>` +
    `${s.elevation} m · ${formatAge(s.observedAt)}<br>` +
    `Snow ${s.snowDepthCm === null ? 'no sensor' : fmt(s.snowDepthCm, 'cm')} · ` +
    `${fmt(s.airTempC, '°C', 1)} · wind ${fmt(s.windSpeedKmh, 'km/h')}`
  );
}

export function addStationLayer(
  map: maplibregl.Map,
  stations: Station[],
  onSelect: (s: Station) => void,
  visible = true,
): { setVisible: (v: boolean) => void; setStations: (s: Station[]) => void } {
  let current = stations;
  map.addSource(LAYER, { type: 'geojson', data: toGeoJson(stations) });
  map.addLayer({
    id: LAYER,
    type: 'circle',
    source: LAYER,
    layout: { 'circle-sort-key': ['get', 'hasSnow'], visibility: visible ? 'visible' : 'none' },
    paint: {
      'circle-color': snowColorExpression(),
      'circle-radius': [
        'interpolate',
        ['linear'],
        ['zoom'],
        8, ['case', ['==', ['get', 'hasSnow'], 1], 4.5, 2.5],
        12, ['case', ['==', ['get', 'hasSnow'], 1], 8, 5],
      ],
      'circle-stroke-color': ['case', ['==', ['get', 'hasSnow'], 1], '#3a3a3a', '#ffffff'],
      'circle-stroke-width': ['case', ['boolean', ['feature-state', 'hover'], false], 2.5, 1.2],
      'circle-pitch-alignment': 'viewport',
    },
  });

  const popup = new maplibregl.Popup({ closeButton: false, closeOnClick: false, className: 'tooltip', offset: 10 });
  let hovered: number | null = null;
  const setHover = (id: number | null) => {
    if (hovered !== null) map.setFeatureState({ source: LAYER, id: hovered }, { hover: false });
    hovered = id;
    if (id !== null) map.setFeatureState({ source: LAYER, id }, { hover: true });
  };
  const stationAt = (e: MapLayerMouseEvent) => {
    const f = e.features?.[0];
    const station = f ? current[f.properties.index as number] : undefined;
    return f && station ? { id: f.id as number, station } : null;
  };

  // Hover tooltips only for real pointers; touch devices go straight to the details panel.
  if (matchMedia('(hover: hover)').matches) {
    map.on('mousemove', LAYER, (e: MapLayerMouseEvent) => {
      const hit = stationAt(e);
      if (!hit) return;
      map.getCanvas().style.cursor = 'pointer';
      setHover(hit.id);
      popup.setLngLat([hit.station.lon, hit.station.lat]).setHTML(tooltipHtml(hit.station)).addTo(map);
    });
    map.on('mouseleave', LAYER, () => {
      map.getCanvas().style.cursor = '';
      setHover(null);
      popup.remove();
    });
  }
  map.on('click', LAYER, (e: MapLayerMouseEvent) => {
    const hit = stationAt(e);
    if (hit) onSelect(hit.station);
  });

  return {
    setVisible: (v) => {
      map.setLayoutProperty(LAYER, 'visibility', v ? 'visible' : 'none');
      if (!v) popup.remove();
    },
    setStations: (list) => {
      setHover(null);
      popup.remove();
      current = list;
      (map.getSource(LAYER) as maplibregl.GeoJSONSource).setData(toGeoJson(list));
    },
  };
}

export const STATION_LAYER_ID = LAYER;
