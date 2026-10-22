// Via ferratas (Klettersteige) from a static OpenStreetMap layer (web/src/data/ferratas.json,
// refreshed with `npm run ferratas`), fetched the first time the layer is switched on. The lines
// drape on the terrain: a white casing, a colour and width per grade, white dashes where OSM has
// no grade, faded where OSM marks a section closed. A wide invisible line takes the clicks.

import * as maplibregl from 'maplibre-gl';
import type { ExpressionSpecification, MapLayerMouseEvent } from 'maplibre-gl';
import type { Feature, FeatureCollection, LineString, MultiLineString } from 'geojson';
import ferratasUrl from './data/ferratas.json?url';
import { escapeHtml } from './format.ts';

export interface FerrataProps {
  id: string;
  name: string | null;
  otherNames: string[];
  /** Hardest section, 0–6 on the OSM via_ferrata_scale (1–5 are grades A–E), or null if ungraded. */
  grade: number | null;
  gradeMin: number | null;
  /** The hardest grade as written: "3", "3+", "2-". */
  scale: string | null;
  closed: boolean;
  closedNote: string | null;
  website: string | null;
  osm: string;
  ways: number;
  lengthM: number;
  minM: number;
  maxM: number;
  climbM: number | null;
}

/** Positions are [lon, lat, elevation m]. */
export type Ferrata = Feature<LineString | MultiLineString, FerrataProps>;

const SOURCE = 'ferratas';
const LINE = 'ferrata-line';
const HIT = 'ferrata-hit';
/** Layer that answers hover and click. */
export const FERRATA_LAYER_IDS = [HIT];
const LAYERS = ['ferrata-selected', 'ferrata-casing', LINE, 'ferrata-dash', 'ferrata-label', HIT];

/** Legend classes; colour and line width both rise with the grade, so colour is not the only cue. */
export const GRADE_CLASSES = [
  { label: 'A', from: 0, color: '#2f9e44' },
  { label: 'B', from: 2, color: '#1c7ed6' },
  { label: 'C', from: 3, color: '#f08c00' },
  { label: 'D', from: 4, color: '#e03131' },
  { label: 'E', from: 5, color: '#25262b' },
] as const;
export const UNGRADED_COLOR = '#868e96';

export function gradeColor(grade: number | null): string {
  if (grade === null) return UNGRADED_COLOR;
  return [...GRADE_CLASSES].reverse().find((c) => grade >= c.from)!.color;
}

// The file has null for a missing name or grade.
const HAS_NAME: ExpressionSpecification = ['to-boolean', ['get', 'name']];
const HAS_SCALE: ExpressionSpecification = ['to-boolean', ['get', 'scale']];
const gradeOr = (fallback: number): ExpressionSpecification => ['coalesce', ['get', 'grade'], fallback];
const COLOR: ExpressionSpecification = [
  'step',
  gradeOr(-1),
  UNGRADED_COLOR,
  ...GRADE_CLASSES.flatMap((c) => [c.from, c.color]),
] as unknown as ExpressionSpecification;
/** Line width in px at a zoom, plus a little per grade. */
const width = (atZ9: number, atZ15: number, perGrade: number): ExpressionSpecification => [
  'interpolate',
  ['linear'],
  ['zoom'],
  9,
  ['+', atZ9, ['*', perGrade * 0.5, gradeOr(2)]],
  15,
  ['+', atZ15, ['*', perGrade, gradeOr(2)]],
];

// OSM wiki, Key:via_ferrata_scale: Hüsler wording and the French and Italian equivalents.
const WORDS = ['very easy', 'easy', 'moderately difficult', 'difficult', 'very difficult', 'extremely difficult', 'beyond extremely difficult'];
const FRENCH = ['F', 'PD', 'AD', 'D', 'TD', 'ED', 'ABO'];
const ITALIAN = ['F', 'PD', 'PD', 'D', 'TD', 'ED', 'ED'];

const LETTERS = 'ABCDE';

/**
 * The OSM scale as the A–E letters guidebooks use: 1–5 are A–E, 0 counts as A and 6 as E. A plus
 * or minus becomes the in-between grade: "3+" is C/D, "3-" B/C.
 */
export function letterGrade(scale: string): string {
  const n = Number(scale[0]);
  const i = Math.min(Math.max(n, 1), 5) - 1;
  if (scale.endsWith('+') && n >= 1 && n <= 4) return `${LETTERS[i]}/${LETTERS[i + 1]}`;
  if (scale.endsWith('-') && n >= 2 && n <= 5) return `${LETTERS[i - 1]}/${LETTERS[i]}`;
  return LETTERS[i];
}

/** "C/D" for the map; "ungraded" without a grade. */
export const gradeLabel = (p: Pick<FerrataProps, 'scale'>): string => (p.scale === null ? 'ungraded' : letterGrade(p.scale));

/** "D/E · very difficult · TD in France and Italy" for the panel. */
export function gradeText(p: Pick<FerrataProps, 'grade' | 'scale'>): string {
  if (p.grade === null) return 'No grade in OpenStreetMap';
  const elsewhere =
    FRENCH[p.grade] === ITALIAN[p.grade] ? `${FRENCH[p.grade]} in France and Italy` : `${FRENCH[p.grade]} in France, ${ITALIAN[p.grade]} in Italy`;
  return `${gradeLabel(p)} · ${WORDS[p.grade]} · ${elsewhere}`;
}

/** An http(s) link from an OSM website tag, which often lacks the scheme; null for anything else. */
export function websiteUrl(raw: string): URL | null {
  try {
    const url = new URL(/^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : `https://${raw}`);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url : null;
  } catch {
    return null;
  }
}

const metres = (m: number) => `${Math.round(m).toLocaleString('en-GB')} m`;
const lengthText = (m: number) => (m >= 1000 ? `${(m / 1000).toFixed(1)} km` : metres(m));

export function ferrataTooltipHtml(p: FerrataProps): string {
  return (
    `<strong>${escapeHtml(p.name ?? 'Via ferrata, name unknown')}</strong>` +
    `${gradeLabel(p)} · ${lengthText(p.lengthM)} · ${metres(p.minM)}–${metres(p.maxM)}${p.closed ? ' · <span class="closed-mark">closed</span>' : ''}`
  );
}

/** The highest point: where the panel's point forecast is taken. */
export function highestPoint(f: Ferrata): [number, number, number] {
  const lines = f.geometry.type === 'LineString' ? [f.geometry.coordinates] : f.geometry.coordinates;
  return lines.flat().reduce((a, b) => ((b[2] ?? -Infinity) > (a[2] ?? -Infinity) ? b : a)) as [number, number, number];
}

/** Every line of a route as [lon, lat, ele] positions. */
export const ferrataLines = (f: Ferrata): number[][][] =>
  f.geometry.type === 'LineString' ? [f.geometry.coordinates] : f.geometry.coordinates;

/** Intro for the point panel; the route's snow, then the forecast at its highest point, follow it. */
export function ferrataHtml(p: FerrataProps): string {
  const site = p.website ? websiteUrl(p.website) : null;
  const range = p.gradeMin !== null && p.grade !== null && p.gradeMin < p.grade ? `Sections ${letterGrade(String(p.gradeMin))} to ${gradeLabel(p)}` : '';
  const rows = [
    `<dt>Grade</dt><dd><span class="grade-chip" style="background:${gradeColor(p.grade)}"></span> ${escapeHtml(gradeText(p))}${range ? `<br><span class="muted">${range}</span>` : ''}</dd>`,
    `<dt>Mapped length</dt><dd>${lengthText(p.lengthM)}${p.ways > 1 ? ` <span class="muted">(${p.ways} sections)</span>` : ''}</dd>`,
    `<dt>Elevation</dt><dd>${metres(p.minM)} – ${metres(p.maxM)}</dd>`,
    p.climbM === null ? '' : `<dt>Climb</dt><dd>about ${metres(p.climbM)}</dd>`,
    p.otherNames.length ? `<dt>Includes</dt><dd>${p.otherNames.map(escapeHtml).join('<br>')}</dd>` : '',
    site ? `<dt>Website</dt><dd><a href="${escapeHtml(site.href)}" target="_blank" rel="noopener noreferrer">${escapeHtml(site.hostname)}</a></dd>` : '',
  ];
  return `
    ${p.closed ? `<p class="warning"><strong>Marked closed in OpenStreetMap.</strong>${p.closedNote ? ` Mapper's note: “${escapeHtml(p.closedNote)}”` : ''}</p>` : ''}
    <dl class="kv">${rows.join('')}</dl>
    <p class="muted">From <a href="https://www.openstreetmap.org/${escapeHtml(p.osm)}" target="_blank" rel="noopener">OpenStreetMap</a> (ODbL),
    drawn by volunteers: it may be incomplete, wrong or out of date, and a route may be closed, damaged or out of season.
    Only the equipped sections are drawn, not the approach or descent; length, elevation and climb come from a terrain model.
    Check conditions and the route locally. Not for navigation.</p>`;
}

export interface FerrataLayer {
  /** Resolves with the number of routes once they are drawn, or null when hiding. */
  setVisible: (v: boolean) => Promise<number | null>;
  /** Highlights a route by id, or clears the highlight. */
  select: (id: string | null) => void;
}

/**
 * Adds the (empty) layers below `beforeId`; the data is fetched on the first `setVisible(true)`.
 * `onSelect` gets the clicked route with its full geometry.
 */
export function addFerrataLayer(
  map: maplibregl.Map,
  onSelect: (f: Ferrata) => void,
  beforeId?: string,
): FerrataLayer {
  const empty: FeatureCollection = { type: 'FeatureCollection', features: [] };
  map.addSource(SOURCE, { type: 'geojson', data: empty, promoteId: 'id' });
  const add = (layer: maplibregl.LayerSpecification) => map.addLayer(layer, beforeId);
  const hidden = { visibility: 'none' } as const;
  const round = { 'line-cap': 'round', 'line-join': 'round' } as const;
  const faded: ExpressionSpecification = ['case', ['==', ['get', 'closed'], true], 0.45, 1];
  add({
    id: 'ferrata-selected',
    type: 'line',
    source: SOURCE,
    filter: ['==', ['get', 'id'], ''],
    layout: { ...hidden, ...round },
    paint: { 'line-color': '#ffd43b', 'line-width': width(9, 16, 0.4), 'line-blur': 2, 'line-opacity': 0.9 },
  });
  add({
    id: 'ferrata-casing',
    type: 'line',
    source: SOURCE,
    layout: { ...hidden, ...round },
    paint: { 'line-color': '#ffffff', 'line-width': width(3, 7, 0.4), 'line-opacity': ['*', 0.85, faded] },
  });
  add({
    id: LINE,
    type: 'line',
    source: SOURCE,
    layout: { ...hidden, ...round },
    paint: { 'line-color': COLOR, 'line-width': width(1.4, 3.6, 0.4), 'line-opacity': faded },
  });
  add({
    id: 'ferrata-dash',
    type: 'line',
    source: SOURCE,
    filter: ['!', HAS_SCALE],
    layout: hidden,
    paint: { 'line-color': '#ffffff', 'line-width': width(0.8, 1.6, 0), 'line-dasharray': [1.5, 2] },
  });
  add({
    id: 'ferrata-label',
    type: 'symbol',
    source: SOURCE,
    minzoom: 12,
    layout: {
      ...hidden,
      'symbol-placement': 'line',
      'text-field': [
        'case',
        HAS_NAME,
        ['concat', ['get', 'name'], ' · ', ['get', 'letter']],
        ['case', HAS_SCALE, ['get', 'letter'], ''],
      ],
      'text-font': ['Noto Sans Medium'],
      'text-size': 11,
      'text-offset': [0, -0.9],
      'text-max-angle': 40,
      'symbol-spacing': 320,
    },
    paint: { 'text-color': '#2b2f36', 'text-halo-color': '#ffffff', 'text-halo-width': 1.5 },
  });
  // Thin lines are hard to hit, so a wide transparent copy takes hover and click.
  add({
    id: HIT,
    type: 'line',
    source: SOURCE,
    layout: { ...hidden, ...round },
    paint: { 'line-color': '#000000', 'line-opacity': 0, 'line-width': 18 },
  });

  let routes: Map<string, Ferrata> | null = null;
  let loading: Promise<void> | null = null;
  let wanted = false;
  const load = () =>
    (loading ??= fetch(ferratasUrl)
      .then((res) => {
        if (!res.ok) throw new Error(`ferratas: HTTP ${res.status}`);
        return res.json() as Promise<FeatureCollection<LineString | MultiLineString, FerrataProps>>;
      })
      .then((fc) => {
        // The map label reads the letter grade from the feature.
        for (const f of fc.features) (f.properties as FerrataProps & { letter: string }).letter = gradeLabel(f.properties);
        routes = new Map(fc.features.map((f) => [f.properties.id, f as Ferrata]));
        (map.getSource(SOURCE) as maplibregl.GeoJSONSource).setData(fc);
      })
      .catch((e: unknown) => {
        loading = null;
        throw e;
      }));

  const popup = new maplibregl.Popup({ closeButton: false, closeOnClick: false, className: 'tooltip', offset: 12 });
  // Rendered features are clipped to tiles, so the full route comes from the loaded file.
  const routeAt = (e: MapLayerMouseEvent) => {
    const id = e.features?.[0]?.properties.id as string | undefined;
    return id ? routes?.get(id) : undefined;
  };
  if (matchMedia('(hover: hover)').matches) {
    map.on('mousemove', HIT, (e: MapLayerMouseEvent) => {
      const f = routeAt(e);
      if (!f) return;
      map.getCanvas().style.cursor = 'pointer';
      popup.setLngLat(e.lngLat).setHTML(ferrataTooltipHtml(f.properties)).addTo(map);
    });
    map.on('mouseleave', HIT, () => {
      map.getCanvas().style.cursor = '';
      popup.remove();
    });
  }
  map.on('click', HIT, (e: MapLayerMouseEvent) => {
    const f = routeAt(e);
    if (f) onSelect(f);
  });

  return {
    async setVisible(v) {
      wanted = v;
      if (v) await load();
      // Switched off again while the file was loading.
      if (wanted !== v) return null;
      for (const id of LAYERS) map.setLayoutProperty(id, 'visibility', v ? 'visible' : 'none');
      if (!v) popup.remove();
      return v ? routes!.size : null;
    },
    select(id) {
      map.setFilter('ferrata-selected', ['==', ['get', 'id'], id ?? '']);
    },
  };
}
