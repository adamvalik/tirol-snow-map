// Winter sports from a static OpenStreetMap layer (web/src/data/winter.json, refreshed with
// `npm run winter`), fetched the first time the layer is switched on: ski lifts, downhill slopes
// coloured by difficulty (lines, and areas where a slope is mapped as one), cross-country trails,
// toboggan runs and ski touring routes. Everything drapes on the terrain; a wide invisible line
// takes the clicks. The legend's chips hide and show each kind.

import * as maplibregl from 'maplibre-gl';
import type { ExpressionSpecification, MapLayerMouseEvent } from 'maplibre-gl';
import type { Feature, FeatureCollection, LineString, MultiLineString, MultiPolygon, Point, Polygon } from 'geojson';
import winterUrl from './data/winter.json?url';
import { escapeHtml, lengthText, metres } from './format.ts';
import { websiteUrl } from './ferratas.ts';
import { factsHtml } from './placeHtml.ts';
import { inArea } from './island.ts';
import type { IconName } from './app/icons.ts';

export const WINTER_KINDS = ['lift', 'downhill', 'nordic', 'sled', 'skitour'] as const;
export type WinterKind = (typeof WINTER_KINDS)[number];

export interface WinterProps {
  id: string;
  kind: WinterKind;
  /** OSM aerialway value, lifts only. */
  lift: string | null;
  /** novice, easy, intermediate, advanced, expert, freeride, or null. */
  difficulty: string | null;
  /** classic, skating, classic+skating, backcountry, or null. */
  grooming: string | null;
  name: string | null;
  ref: string | null;
  lit: boolean;
  occupancy: number | null;
  capacity: number | null;
  durationMin: number | null;
  heating: boolean;
  bubble: boolean;
  website: string | null;
  osm: string;
  ways: number;
  lengthM: number;
  areaHa: number | null;
  minM: number;
  maxM: number;
  climbM: number | null;
  startM: number | null;
  endM: number | null;
}

/** Every property but the id, kind and elevations may be left out of the file when empty. */
const DEFAULTS: Omit<WinterProps, 'id' | 'kind' | 'osm' | 'minM' | 'maxM'> = {
  lift: null,
  difficulty: null,
  grooming: null,
  name: null,
  ref: null,
  lit: false,
  occupancy: null,
  capacity: null,
  durationMin: null,
  heating: false,
  bubble: false,
  website: null,
  ways: 1,
  lengthM: 0,
  areaHa: null,
  climbM: null,
  startM: null,
  endM: null,
};

/** A feature's properties as stored (empty ones left out, no `osm`) with the defaults filled in. */
export function fullProps(stored: Partial<WinterProps> & Pick<WinterProps, 'id' | 'kind' | 'minM' | 'maxM'>): WinterProps {
  return { ...DEFAULTS, ...stored, osm: `${stored.id.startsWith('r') ? 'relation' : 'way'}/${stored.id.slice(1)}` };
}

/** Positions are [lon, lat, elevation m]. */
export type WinterFeature = Feature<LineString | MultiLineString | Polygon | MultiPolygon, WinterProps>;

const SOURCE = 'winter';
const HIT = 'winter-hit';
/** Layer that answers hover and click. */
export const WINTER_LAYER_IDS = [HIT];

/** Slope colours as on European piste maps; colour is backed by the name in the legend and panel. */
export const DIFFICULTY_CLASSES = [
  { key: 'novice', label: 'Nursery', color: '#2f9e44' },
  { key: 'easy', label: 'Blue', color: '#1c7ed6' },
  { key: 'intermediate', label: 'Red', color: '#e03131' },
  { key: 'advanced', label: 'Black', color: '#212529' },
  { key: 'expert', label: 'Expert', color: '#212529' },
  { key: 'freeride', label: 'Freeride', color: '#f08c00' },
] as const;
export const UNKNOWN_SLOPE_COLOR = '#868e96';
export const LIFT_COLOR = '#343a40';
export const NORDIC_COLOR = '#0c8599';
export const SLED_COLOR = '#9c36b5';
export const SKITOUR_COLOR = '#495057';

/** Aerial lifts hang on a cable; the rest pull skiers along the snow and are drawn dashed. */
export const AERIAL_LIFTS = ['cable_car', 'gondola', 'mixed_lift', 'chair_lift'];

const LIFT_WORDS: Record<string, string> = {
  cable_car: 'Cable car',
  gondola: 'Gondola',
  mixed_lift: 'Chairs and gondolas',
  chair_lift: 'Chairlift',
  drag_lift: 'Drag lift',
  't-bar': 'T-bar',
  'j-bar': 'J-bar',
  platter: 'Platter lift',
  rope_tow: 'Rope tow',
  magic_carpet: 'Magic carpet',
};
const DIFFICULTY_WORDS: Record<string, string> = {
  novice: 'Nursery slope',
  easy: 'Blue slope, easy',
  intermediate: 'Red slope, intermediate',
  advanced: 'Black slope, difficult',
  expert: 'Expert slope',
  freeride: 'Freeride, not groomed',
};
const GROOMING_WORDS: Record<string, string> = {
  classic: 'classic',
  skating: 'skating',
  'classic+skating': 'classic and skating',
  backcountry: 'not groomed',
};
const KIND_WORDS: Record<WinterKind, string> = {
  lift: 'Ski lift',
  downhill: 'Ski slope',
  nordic: 'Cross-country trail',
  sled: 'Toboggan run',
  skitour: 'Ski touring route',
};

export function slopeColor(difficulty: string | null): string {
  return DIFFICULTY_CLASSES.find((c) => c.key === difficulty)?.color ?? UNKNOWN_SLOPE_COLOR;
}

/** The colour a feature is drawn in. */
export function winterColor(p: Pick<WinterProps, 'kind' | 'difficulty'>): string {
  if (p.kind === 'downhill') return slopeColor(p.difficulty);
  return { lift: LIFT_COLOR, nordic: NORDIC_COLOR, sled: SLED_COLOR, skitour: SKITOUR_COLOR }[p.kind];
}

const KIND: ExpressionSpecification = ['get', 'kind'];
const SLOPE_COLOR: ExpressionSpecification = [
  'match',
  ['coalesce', ['get', 'difficulty'], ''],
  ...DIFFICULTY_CLASSES.flatMap((c) => [c.key, c.color]),
  UNKNOWN_SLOPE_COLOR,
] as unknown as ExpressionSpecification;
const COLOR: ExpressionSpecification = ['match', KIND, 'lift', LIFT_COLOR, 'nordic', NORDIC_COLOR, 'sled', SLED_COLOR, 'skitour', SKITOUR_COLOR, SLOPE_COLOR];
const IS_AREA: ExpressionSpecification = ['in', ['geometry-type'], ['literal', ['Polygon', 'MultiPolygon']]];
const IS_LINE: ExpressionSpecification = ['in', ['geometry-type'], ['literal', ['LineString', 'MultiLineString']]];
const IS_AERIAL: ExpressionSpecification = ['in', ['coalesce', ['get', 'lift'], ''], ['literal', AERIAL_LIFTS]];
/** Line width in px at zoom 10 and 15. */
const width = (atZ10: number, atZ15: number): ExpressionSpecification => ['interpolate', ['linear'], ['zoom'], 10, atZ10, 15, atZ15];
/** Pistes a little narrower than lifts, which carry the eye between them. */
const LINE_WIDTH: ExpressionSpecification = ['interpolate', ['linear'], ['zoom'], 10, ['match', KIND, 'lift', 1.3, 'downhill', 1.3, 1], 15, ['match', KIND, 'lift', 2.6, 'downhill', 3.6, 2.8]];

/** "Chairlift, 6 seats" or "Red slope, intermediate" for the Place tab's header. */
export function winterSub(p: WinterProps): string {
  if (p.kind === 'lift') {
    const word = LIFT_WORDS[p.lift ?? ''] ?? 'Ski lift';
    const seats = p.occupancy && p.lift !== 'cable_car' ? `, ${p.occupancy} ${p.lift === 'gondola' ? 'per cabin' : 'seats'}` : '';
    return `${word}${seats}`;
  }
  if (p.kind === 'downhill') return p.difficulty ? DIFFICULTY_WORDS[p.difficulty] : 'Ski slope, difficulty not mapped';
  if (p.kind === 'nordic') return `Cross-country trail${p.grooming ? `, ${GROOMING_WORDS[p.grooming]}` : ''}`;
  return KIND_WORDS[p.kind];
}

/** A name for the panel title, the label and the tooltip: the name, the number, or the kind. */
export function winterTitle(p: Pick<WinterProps, 'kind' | 'name' | 'ref' | 'lift'>): string {
  if (p.name && p.ref && !p.name.includes(p.ref)) return `${p.ref} ${p.name}`;
  if (p.name) return p.name;
  const kind = p.kind === 'lift' ? (LIFT_WORDS[p.lift ?? ''] ?? 'Ski lift') : KIND_WORDS[p.kind];
  return p.ref ? `${kind} ${p.ref}` : kind;
}

export const winterIcon = (p: Pick<WinterProps, 'kind'>): IconName => (p.kind === 'lift' ? 'cable-car' : 'person-simple-ski');

/** Elevation gained by a lift, from where its line starts to where it ends. */
const liftRise = (p: WinterProps) => (p.startM !== null && p.endM !== null ? Math.abs(p.endM - p.startM) : p.maxM - p.minM);

/** Length, or area for a slope mapped as one. */
const sizeText = (p: WinterProps) => (p.areaHa !== null ? `${p.areaHa.toLocaleString('en-GB')} ha` : lengthText(p.lengthM));

export function winterTooltipHtml(p: WinterProps): string {
  const facts =
    p.kind === 'lift'
      ? `${lengthText(p.lengthM)}, ${metres(liftRise(p))} up to ${metres(Math.max(p.startM ?? p.maxM, p.endM ?? p.maxM))}`
      : p.kind === 'nordic' || p.kind === 'skitour'
        ? `${sizeText(p)}, ${metres(p.minM)}–${metres(p.maxM)}`
        : `${sizeText(p)}, ${metres(p.maxM - p.minM)} down from ${metres(p.maxM)}`;
  return `<strong>${escapeHtml(winterTitle(p))}</strong>${escapeHtml(winterSub(p))}<br>${facts}`;
}

/** The top of a lift's or a piste's Place tab; its snow, then the forecast at its highest point, follow it. */
export function winterHtml(p: WinterProps): string {
  const site = p.website ? websiteUrl(p.website) : null;
  const sections = p.ways > 1 ? `<small>${p.ways} sections</small>` : '';
  const area = p.areaHa !== null;
  const facts: [string, string][] =
    p.kind === 'lift'
      ? [
          ['Length', lengthText(p.lengthM)],
          ['Rise', metres(liftRise(p))],
          ['Top station', `${metres(Math.max(p.startM ?? p.maxM, p.endM ?? p.maxM))}<small>from ${metres(Math.min(p.startM ?? p.minM, p.endM ?? p.minM))}</small>`],
        ]
      : p.kind === 'nordic' || p.kind === 'skitour'
        ? [
            [area ? 'Area' : 'Mapped length', `${sizeText(p)}${sections}`],
            ['Climb', p.climbM === null ? '–' : metres(p.climbM)],
            ['Elevation', `${metres(p.maxM)}<small>from ${metres(p.minM)}</small>`],
          ]
        : [
            [area ? 'Area' : 'Mapped length', `${sizeText(p)}${sections}`],
            ['Drop', metres(p.maxM - p.minM)],
            ['Top', `${metres(p.maxM)}<small>down to ${metres(p.minM)}</small>`],
          ];
  const links = [
    p.capacity ? `<span>${p.capacity.toLocaleString('en-GB')} people an hour</span>` : '',
    p.durationMin ? `<span>${p.durationMin.toLocaleString('en-GB')} min a ride</span>` : '',
    p.heating || p.bubble ? `<span>${[p.bubble ? 'Weather hood' : '', p.heating ? 'heated seats' : ''].filter(Boolean).join(', ').replace(/^h/, 'H')}</span>` : '',
    p.lit ? '<span>Lit at night</span>' : '',
    site ? `<span><a href="${escapeHtml(site.href)}" target="_blank" rel="noopener noreferrer">${escapeHtml(site.hostname)}</a></span>` : '',
  ].filter(Boolean);
  return `${factsHtml(facts)}${links.length ? `<div class="place-links">${links.join('')}</div>` : ''}`;
}

/** Under the rows: where it comes from and what the app cannot know. */
export const winterFootHtml = (p: WinterProps) => `
    <p class="source-note">From <a href="https://www.openstreetmap.org/${escapeHtml(p.osm)}" target="_blank" rel="noopener">OpenStreetMap</a> (ODbL),
    drawn by volunteers: it may be incomplete, wrong or out of date. Whether a lift runs or a ${p.kind === 'lift' ? 'slope' : 'piste'} is open, groomed or
    safe today is not known here: check with the ski area or the tourist office.${p.kind === 'skitour' || p.difficulty === 'freeride' ? ' Ski touring and freeride lead through avalanche terrain: check <a href="https://avalanche.report" target="_blank" rel="noopener">avalanche.report</a>.' : ''}
    Lengths and elevations come from a terrain model. Not for navigation.</p>`;

/** The highest point: where the panel's point forecast is taken (a lift's top station). */
export function highestPoint(f: WinterFeature): [number, number, number] {
  return winterLines(f)
    .flat()
    .reduce((a, b) => ((b[2] ?? -Infinity) > (a[2] ?? -Infinity) ? b : a)) as [number, number, number];
}

/** Every line of a feature as [lon, lat, ele] positions: its lines, or the rings of its areas. */
export function winterLines(f: WinterFeature): number[][][] {
  const g = f.geometry;
  if (g.type === 'LineString') return [g.coordinates];
  if (g.type === 'MultiLineString' || g.type === 'Polygon') return g.coordinates;
  return g.coordinates.flat();
}

/** Ends of every lift, for the station dots. */
export function liftEnds(features: readonly WinterFeature[]): Feature<Point, { aerial: boolean }>[] {
  return features
    .filter((f) => f.properties.kind === 'lift' && f.geometry.type === 'LineString')
    .flatMap((f) => {
      const c = (f.geometry as LineString).coordinates;
      const aerial = AERIAL_LIFTS.includes(f.properties.lift ?? '');
      return [c[0], c.at(-1)!].map((p) => ({ type: 'Feature' as const, geometry: { type: 'Point' as const, coordinates: p }, properties: { aerial } }));
    });
}

export interface WinterLayer {
  /** Resolves with the features once drawn, or null when hiding. */
  setVisible: (v: boolean) => Promise<WinterFeature[] | null>;
  /** Shows only these kinds. */
  setKinds: (kinds: readonly WinterKind[]) => void;
  /** Highlights a feature by id, or clears the highlight. */
  select: (id: string | null) => void;
}

/**
 * Adds the (empty) layers below `beforeId`; the data is fetched on the first `setVisible(true)`.
 * `onSelect` gets the clicked feature with its full geometry.
 */
export function addWinterLayer(map: maplibregl.Map, onSelect: (f: WinterFeature) => void, beforeId?: string): WinterLayer {
  const empty: FeatureCollection = { type: 'FeatureCollection', features: [] };
  map.addSource(SOURCE, { type: 'geojson', data: empty, promoteId: 'id' });
  map.addSource(`${SOURCE}-ends`, { type: 'geojson', data: empty });
  const hidden = { visibility: 'none' } as const;
  const round = { 'line-cap': 'round', 'line-join': 'round' } as const;
  /** Each layer with the filter it always has, which the kind filter is added to. */
  const own = new Map<string, ExpressionSpecification | null>();
  const add = (layer: maplibregl.LayerSpecification & { filter?: ExpressionSpecification }) => {
    own.set(layer.id, layer.filter ?? null);
    map.addLayer(layer, beforeId);
  };
  const line = (id: string, filter: ExpressionSpecification, paint: maplibregl.LineLayerSpecification['paint'], layout = {}) =>
    add({ id, type: 'line', source: SOURCE, filter, layout: { ...hidden, ...round, ...layout }, paint });

  add({ id: 'winter-selected', type: 'line', source: SOURCE, filter: ['==', ['get', 'id'], ''], layout: { ...hidden, ...round }, paint: { 'line-color': '#ffd43b', 'line-width': width(7, 14), 'line-blur': 2, 'line-opacity': 0.9 } });
  // Slopes mapped as areas: a light wash and a thin edge, below every line.
  add({ id: 'winter-area', type: 'fill', source: SOURCE, filter: IS_AREA, layout: hidden, paint: { 'fill-color': SLOPE_COLOR, 'fill-opacity': 0.16 } });
  line('winter-area-edge', IS_AREA, { 'line-color': SLOPE_COLOR, 'line-width': width(0.4, 1.2), 'line-opacity': 0.55 });
  // Ski touring: a dotted line, below the groomed pistes it often follows.
  line('winter-skitour', ['all', IS_LINE, ['==', KIND, 'skitour']], { 'line-color': SKITOUR_COLOR, 'line-width': width(1.2, 2.6), 'line-dasharray': [0.1, 2] });
  const pistes: ExpressionSpecification = ['all', IS_LINE, ['in', KIND, ['literal', ['downhill', 'nordic', 'sled']]]];
  line('winter-casing', ['any', pistes, ['==', KIND, 'lift']], { 'line-color': '#ffffff', 'line-width': ['+', LINE_WIDTH, 2.5], 'line-opacity': 0.85 });
  line('winter-piste', pistes, { 'line-color': COLOR, 'line-width': LINE_WIDTH });
  // Freeride runs are not groomed: white dashes over the orange.
  line('winter-freeride', ['all', pistes, ['==', ['get', 'difficulty'], 'freeride']], { 'line-color': '#ffffff', 'line-width': width(0.6, 1.4), 'line-dasharray': [1.5, 2] }, { 'line-cap': 'butt' });
  line('winter-lift', ['all', IS_LINE, ['==', KIND, 'lift'], IS_AERIAL], { 'line-color': LIFT_COLOR, 'line-width': LINE_WIDTH });
  line('winter-surface-lift', ['all', IS_LINE, ['==', KIND, 'lift'], ['!', IS_AERIAL]], { 'line-color': LIFT_COLOR, 'line-width': LINE_WIDTH, 'line-dasharray': [2, 1.2] }, { 'line-cap': 'butt' });
  add({
    id: 'winter-lift-ends',
    type: 'circle',
    source: `${SOURCE}-ends`,
    minzoom: 11,
    layout: hidden,
    paint: {
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 11, ['case', ['get', 'aerial'], 2.5, 1.5], 15, ['case', ['get', 'aerial'], 5, 3]],
      'circle-color': '#ffffff',
      'circle-stroke-color': LIFT_COLOR,
      'circle-stroke-width': ['interpolate', ['linear'], ['zoom'], 11, 1.2, 15, 2],
      'circle-pitch-alignment': 'map',
    },
  });
  add({
    id: 'winter-label',
    type: 'symbol',
    source: SOURCE,
    filter: IS_LINE,
    minzoom: 13,
    layout: {
      ...hidden,
      'symbol-placement': 'line',
      'text-field': ['get', 'label'],
      'text-font': ['Noto Sans Medium'],
      'text-size': 11,
      'text-offset': [0, -0.9],
      'text-max-angle': 40,
      'symbol-spacing': 360,
    },
    paint: { 'text-color': ['match', KIND, 'lift', '#2b2f36', COLOR], 'text-halo-color': '#ffffff', 'text-halo-width': 1.5 },
  });
  // Thin lines are hard to hit, so a wide transparent copy takes hover and click (an area's edge too).
  add({ id: HIT, type: 'line', source: SOURCE, layout: { ...hidden, ...round }, paint: { 'line-color': '#000000', 'line-opacity': 0, 'line-width': 16 } });

  let features: Map<string, WinterFeature> | null = null;
  let loading: Promise<void> | null = null;
  let wanted = false;
  let kindsShown: readonly WinterKind[] = WINTER_KINDS;
  // The lift ends have no kind: they show with the lifts.
  const endsVisible = () => wanted && kindsShown.includes('lift');
  const load = () =>
    (loading ??= fetch(winterUrl)
      .then((res) => {
        if (!res.ok) throw new Error(`winter: HTTP ${res.status}`);
        return res.json() as Promise<FeatureCollection<WinterFeature['geometry'], WinterProps>>;
      })
      .then((fc) => {
        // Only what starts inside the covered area (island.ts).
        fc.features = fc.features.filter((f) => {
          const first = winterLines(f as WinterFeature)[0]?.[0];
          return !!first && inArea(first[0], first[1]);
        });
        // The map label reads its text from the feature.
        for (const f of fc.features) {
          const p = fullProps(f.properties);
          f.properties = Object.assign(p, { label: p.name || p.ref ? winterTitle(p) : '' });
        }
        features = new Map(fc.features.map((f) => [f.properties.id, f as WinterFeature]));
        (map.getSource(SOURCE) as maplibregl.GeoJSONSource).setData(fc);
        (map.getSource(`${SOURCE}-ends`) as maplibregl.GeoJSONSource).setData({ type: 'FeatureCollection', features: liftEnds([...features.values()]) });
      })
      .catch((e: unknown) => {
        loading = null;
        throw e;
      }));

  const popup = new maplibregl.Popup({ closeButton: false, closeOnClick: false, className: 'tooltip', offset: 12 });
  // Rendered features are clipped to tiles, so the full feature comes from the loaded file.
  const featureAt = (e: MapLayerMouseEvent) => {
    const id = e.features?.[0]?.properties.id as string | undefined;
    return id ? features?.get(id) : undefined;
  };
  if (matchMedia('(hover: hover)').matches) {
    map.on('mousemove', HIT, (e: MapLayerMouseEvent) => {
      const f = featureAt(e);
      if (!f) return;
      map.getCanvas().style.cursor = 'pointer';
      popup.setLngLat(e.lngLat).setHTML(winterTooltipHtml(f.properties)).addTo(map);
    });
    map.on('mouseleave', HIT, () => {
      map.getCanvas().style.cursor = '';
      popup.remove();
    });
  }
  map.on('click', HIT, (e: MapLayerMouseEvent) => {
    const f = featureAt(e);
    if (f) onSelect(f);
  });

  return {
    async setVisible(v) {
      wanted = v;
      if (v) await load();
      // Switched off again while the file was loading.
      if (wanted !== v) return null;
      for (const id of own.keys()) map.setLayoutProperty(id, 'visibility', (id === 'winter-lift-ends' ? endsVisible() : v) ? 'visible' : 'none');
      if (!v) popup.remove();
      return v ? [...features!.values()] : null;
    },
    setKinds(kinds) {
      kindsShown = kinds;
      const shown: ExpressionSpecification = ['in', KIND, ['literal', [...kinds]]];
      for (const [id, filter] of own) {
        if (id === 'winter-selected') continue;
        if (id === 'winter-lift-ends') map.setLayoutProperty(id, 'visibility', endsVisible() ? 'visible' : 'none');
        else map.setFilter(id, filter ? ['all', filter, shown] : shown);
      }
    },
    select(id) {
      map.setFilter('winter-selected', ['==', ['get', 'id'], id ?? '']);
    },
  };
}
