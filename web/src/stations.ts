import * as maplibregl from 'maplibre-gl';
import type { MapLayerMouseEvent } from 'maplibre-gl';
import type { FeatureCollection, Point } from 'geojson';
import { SCHEMA_VERSION, type Station, type StationsFile } from '../../shared/types.ts';
import { NO_SNOW_SENSOR_COLOR, snowColorExpression } from './colors.ts';
import { escapeHtml, fmt, fmtChange, formatAge } from './format.ts';
import { inArea } from './island.ts';

export const STATIONS_URL = `${import.meta.env.BASE_URL}data/stations.json`;
const LAYER = 'stations';
const GAINS = 'station-gains';
/** A station that gained this much snow depth in 24 h gets a "+N cm" badge next to its dot. */
export const GAIN_BADGE_CM = 5;

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
    // Stations outside the covered area still feed the snow model, but are not drawn (island.ts).
    features: stations.flatMap((s, i) =>
      inArea(s.lon, s.lat)
        ? [
            {
              type: 'Feature' as const,
              id: i,
              geometry: { type: 'Point' as const, coordinates: [s.lon, s.lat] },
              properties: {
                index: i,
                snowDepthCm: s.snowDepthCm,
                hasSnow: s.snowDepthCm !== null ? 1 : 0,
                // New snow worth a badge on the map: 5 cm or more in 24 h.
                gain: s.snowDepthCm !== null && (s.snowChange24hCm ?? 0) >= GAIN_BADGE_CM ? Math.round(s.snowChange24hCm!) : 0,
              },
            },
          ]
        : [],
    ),
  };
}

export function tooltipHtml(s: Station): string {
  return (
    `<strong>${escapeHtml(s.name)}</strong>` +
    `${s.elevation.toLocaleString('en-GB')} m, ${formatAge(s.observedAt)}<br>` +
    `Snow ${s.snowDepthCm === null ? 'no sensor' : fmt(s.snowDepthCm, 'cm')}` +
    (s.snowDepthCm !== null && s.snowChange24hCm ? ` (${fmtChange(s.snowChange24hCm, 'cm')} in 24 h)` : '') +
    ', ' +
    `${fmt(s.airTempC, '°C', 1)}, wind ${fmt(s.windSpeedKmh, 'km/h')}`
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
      // Stations without a snow sensor are small grey dots, so the snow readings stand out (roadmap 2.3).
      'circle-color': ['case', ['==', ['get', 'hasSnow'], 1], snowColorExpression(), NO_SNOW_SENSOR_COLOR],
      'circle-opacity': ['case', ['==', ['get', 'hasSnow'], 1], 1, 0.75],
      'circle-radius': [
        'interpolate',
        ['linear'],
        ['zoom'],
        8, ['case', ['==', ['get', 'hasSnow'], 1], 4.5, 2],
        12, ['case', ['==', ['get', 'hasSnow'], 1], 8, 3.5],
      ],
      'circle-stroke-color': '#ffffff',
      'circle-stroke-opacity': ['case', ['boolean', ['feature-state', 'hover'], false], 1, ['==', ['get', 'hasSnow'], 1], 1, 0],
      'circle-stroke-width': ['case', ['boolean', ['feature-state', 'hover'], false], 3, 2],
      'circle-pitch-alignment': 'viewport',
    },
  });
  map.addLayer({
    id: GAINS,
    type: 'symbol',
    source: LAYER,
    filter: ['>', ['get', 'gain'], 0],
    layout: {
      visibility: visible ? 'visible' : 'none',
      'text-field': ['concat', '+', ['to-string', ['get', 'gain']], ' cm'],
      'text-font': ['Noto Sans Medium'],
      'text-size': 12,
      'text-anchor': 'left',
      'text-offset': [0.9, 0],
      'text-allow-overlap': false,
      'text-optional': true,
    },
    paint: { 'text-color': '#1d4ea3', 'text-halo-color': '#ffffff', 'text-halo-width': 2.2 },
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
      for (const id of [LAYER, GAINS]) map.setLayoutProperty(id, 'visibility', v ? 'visible' : 'none');
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
