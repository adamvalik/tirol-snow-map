// The view in the address bar, so a link opens the same camera, layers, day and forecast frame:
//
//   #map=10.40/46.4700/11.3540/20/60&x=1.5&layers=snow,stations&day=2026-10-18&f=5&sun=2026-10-21T06:30Z
//
// `map` is zoom/lat/lon/bearing/pitch like openstreetmap.org. Anything missing or invalid falls
// back to the defaults, so old or hand-edited links still open.

export const LAYER_KEYS = [
  'snow',
  'stations',
  'bivouacs',
  'favourites',
  'satellite',
  'cover',
  'depth',
  'confidence',
  'forecast',
  'basemap',
  'labels',
  'hillshade',
  'relief',
  'sun',
  'shadows',
] as const;
export type LayerKey = (typeof LAYER_KEYS)[number];

export interface ViewState {
  center: [number, number];
  zoom: number;
  pitch: number;
  bearing: number;
  exaggeration: number;
  layers: LayerKey[];
  /** Time slider day (YYYY-MM-DD), or null for the latest data. */
  day: string | null;
  /** Forecast frame index, or null. */
  frame: number | null;
  /** Time the sun light is shown for, as a UTC minute (2026-10-21T06:30Z), or null. */
  sun: string | null;
}

/** Limits match the map: maxBounds, zoom and pitch range, exaggeration slider. */
const LIMITS = { lon: [9.4, 13.4], lat: [45.6, 47.75], zoom: [7.5, 16], pitch: [0, 75], exaggeration: [1, 3] } as const;

const num = (s: string | undefined, [min, max]: readonly [number, number]): number | null => {
  if (s === undefined || s.trim() === '') return null;
  const v = Number(s);
  return Number.isFinite(v) && v >= min && v <= max ? v : null;
};

/** The parts of the state the hash sets validly; the rest is left to the defaults. */
export function parseHash(hash: string): Partial<ViewState> {
  const p = new URLSearchParams(hash.replace(/^#/, ''));
  const out: Partial<ViewState> = {};
  const m = p.get('map')?.split('/');
  if (m) {
    const zoom = num(m[0], LIMITS.zoom);
    const lat = num(m[1], LIMITS.lat);
    const lon = num(m[2], LIMITS.lon);
    if (zoom !== null && lat !== null && lon !== null) Object.assign(out, { zoom, center: [lon, lat] });
    const bearing = num(m[3], [-360, 360]);
    if (bearing !== null) out.bearing = bearing;
    const pitch = num(m[4], LIMITS.pitch);
    if (pitch !== null) out.pitch = pitch;
  }
  const x = num(p.get('x') ?? undefined, LIMITS.exaggeration);
  if (x !== null) out.exaggeration = x;
  const layers = p.get('layers');
  if (layers !== null) out.layers = LAYER_KEYS.filter((k) => layers.split(',').includes(k));
  const day = p.get('day');
  if (day && /^\d{4}-\d{2}-\d{2}$/.test(day)) out.day = day;
  const f = num(p.get('f') ?? undefined, [0, 999]);
  if (f !== null) out.frame = Math.floor(f);
  const sun = p.get('sun');
  if (sun && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}Z$/.test(sun) && !Number.isNaN(Date.parse(sun))) out.sun = sun;
  return out;
}

export function toHash(s: ViewState): string {
  const bearing = ((Math.round(s.bearing) % 360) + 360) % 360;
  const parts = [
    `map=${s.zoom.toFixed(2)}/${s.center[1].toFixed(4)}/${s.center[0].toFixed(4)}/${bearing}/${Math.round(s.pitch)}`,
    `x=${s.exaggeration.toFixed(1)}`,
    `layers=${LAYER_KEYS.filter((k) => s.layers.includes(k)).join(',')}`,
  ];
  if (s.day) parts.push(`day=${s.day}`);
  if (s.frame !== null) parts.push(`f=${s.frame}`);
  if (s.sun) parts.push(`sun=${s.sun}`);
  return `#${parts.join('&')}`;
}
