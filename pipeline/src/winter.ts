// Winter sports from OpenStreetMap, for the static layer in web/src/data/winter.json: ski lifts
// (aerialway=*), downhill slopes, cross-country trails, toboggan runs and ski touring routes
// (piste:type=*).
//
// A lift is one way. A piste is a route relation (route=piste or route=ski) with its member ways,
// or, outside relations, the ways that share a node and carry the same type, name and difficulty.
// Unnamed ways stay on their own, since unnamed runs meet at junctions all over a ski area. Slopes
// mapped as areas (a closed way, or a multipolygon) become polygons.

import { ascentDescent, lineLengthM, resample } from '../../shared/geo.ts';
import { MODEL_GRID } from '../../shared/grid.ts';
import type { Box } from './osm-xml.ts';
import { joinLines, type LonLat, type LonLatEle, type OsmRelation, type OsmWay, simplify, UnionFind } from './ferratas.ts';

type OsmElement = OsmWay | OsmRelation | { type: 'node'; id: number };
type Tags = Record<string, string>;

export const PISTE_KINDS = ['downhill', 'nordic', 'sled', 'skitour'] as const;
export type PisteKind = (typeof PISTE_KINDS)[number];
export type WinterKind = 'lift' | PisteKind;

/** Lifts that carry skiers; zip lines and goods lifts are left out. */
export const LIFT_TYPES = ['cable_car', 'gondola', 'mixed_lift', 'chair_lift', 'drag_lift', 't-bar', 'j-bar', 'platter', 'rope_tow', 'magic_carpet'] as const;
export type LiftType = (typeof LIFT_TYPES)[number];

/** piste:difficulty, easiest first; "extreme" is read as expert. */
export const DIFFICULTIES = ['novice', 'easy', 'intermediate', 'advanced', 'expert', 'freeride'] as const;
export type Difficulty = (typeof DIFFICULTIES)[number];

export type Grooming = 'classic' | 'skating' | 'classic+skating' | 'backcountry';

/** One feature before elevations are added. */
export interface WinterItem {
  /** `w<way id>` for a lift or a piste outside relations (the lowest way id), `r<relation id>` for a relation. */
  id: string;
  kind: WinterKind;
  /** Lifts only. */
  lift: LiftType | null;
  difficulty: Difficulty | null;
  grooming: Grooming | null;
  name: string | null;
  ref: string | null;
  /** Lit at night (lit=yes on the piste or any of its ways). */
  lit: boolean;
  /** Lifts: seats or places per carrier, people per hour, minutes per ride. */
  occupancy: number | null;
  capacity: number | null;
  durationMin: number | null;
  /** Lifts: heated seats, a weather hood. */
  heating: boolean;
  bubble: boolean;
  website: string | null;
  /** `relation/<id>` or `way/<id>`, for a link to openstreetmap.org. */
  osm: string;
  ways: number;
  /** Lines for a lift, trail or slope; rings for a slope mapped as an area. */
  geometry: { type: 'lines'; lines: LonLat[][] } | { type: 'polygons'; polygons: LonLat[][][] };
}

/**
 * The area the app draws (the snow grid), in boxes of about 40 × 45 km: the whole area in one
 * request is more than the public Overpass instances answer before their timeout.
 */
export function queryBoxes(area: Box = MODEL_GRID, stepLon = 0.5, stepLat = 0.4): Box[] {
  const boxes: Box[] = [];
  for (let w = area.west; w < area.east - 1e-9; w += stepLon) {
    for (let s = area.south; s < area.north - 1e-9; s += stepLat) {
      const r = (v: number) => Math.round(v * 1e6) / 1e6;
      boxes.push({ west: r(w), south: r(s), east: r(Math.min(w + stepLon, area.east)), north: r(Math.min(s + stepLat, area.north)) });
    }
  }
  return boxes;
}

/**
 * Lift ways and piste ways in a box, then piste relations and all their member ways (a relation's
 * ways often carry no piste tags of their own). `out geom` keeps the node ids for joining sections.
 */
export function overpassQuery(b: Box): string {
  const bbox = `${b.south},${b.west},${b.north},${b.east}`;
  return `[out:json][timeout:180];
(
  way["aerialway"~"^(${LIFT_TYPES.join('|')})$"](${bbox});
  way["piste:type"~"^(${PISTE_KINDS.join('|')})$"](${bbox});
);
out geom;
relation["piste:type"~"^(${PISTE_KINDS.join('|')})$"](${bbox})->.r;
.r out body;
way(r.r);
out geom;`;
}

/** Elements of several responses, each element once (boxes overlap at relations and long ways). */
export function mergeResponses(responses: { elements?: { type: string; id: number }[] }[]): { elements: OsmElement[] } {
  const seen = new Map<string, OsmElement>();
  for (const r of responses) for (const e of r.elements ?? []) if (!seen.has(`${e.type}/${e.id}`)) seen.set(`${e.type}/${e.id}`, e as OsmElement);
  return { elements: [...seen.values()] };
}

const isYes = (v: string | undefined) => v === 'yes' || v === 'true' || v === '1';

/** The first known kind in a piste:type value ("downhill;nordic" counts as downhill). */
export function pisteKind(tags: Tags = {}): PisteKind | null {
  for (const t of (tags['piste:type'] ?? '').split(';').map((s) => s.trim())) if ((PISTE_KINDS as readonly string[]).includes(t)) return t as PisteKind;
  return null;
}

export function difficulty(raw: string | undefined): Difficulty | null {
  const v = raw?.trim().toLowerCase();
  if (v === 'extreme') return 'expert';
  return (DIFFICULTIES as readonly string[]).includes(v ?? '') ? (v as Difficulty) : null;
}

/** "classic;skating", "classic+skating" and "skating;classic" are all both. */
export function grooming(raw: string | undefined): Grooming | null {
  const parts = (raw ?? '').toLowerCase().split(/[;+,]/).map((s) => s.trim());
  const classic = parts.includes('classic');
  const skating = parts.includes('skating');
  if (classic && skating) return 'classic+skating';
  if (classic) return 'classic';
  if (skating) return 'skating';
  if (parts.includes('backcountry')) return 'backcountry';
  return null;
}

/** Abandoned or disused pistes, and lifts kept only as ruins. */
export const isGone = (tags: Tags = {}): boolean =>
  isYes(tags['piste:abandoned']) || isYes(tags.abandoned) || isYes(tags.disused) || tags['piste:status'] === 'abandoned';

/** A number from tags such as "4", "2400", "1,5"; null when there is none. */
function num(raw: string | undefined): number | null {
  const m = /^\s*(\d+(?:[.,]\d+)?)/.exec(raw ?? '');
  return m ? Number(m[1].replace(',', '.')) : null;
}

/** aerialway:duration is minutes ("6", "6.5") or "mm:ss" / "hh:mm:ss". */
export function durationMinutes(raw: string | undefined): number | null {
  if (!raw) return null;
  const parts = raw.trim().split(':').map(Number);
  if (parts.some((p) => !Number.isFinite(p))) return null;
  const min = parts.length === 3 ? parts[0] * 60 + parts[1] + parts[2] / 60 : parts.length === 2 ? parts[0] + parts[1] / 60 : parts[0];
  return min > 0 && min < 120 ? Math.round(min * 10) / 10 : null;
}

const nameOf = (t: Tags = {}) => (t['piste:name'] ?? t.name ?? t['name:de'] ?? t['name:it'] ?? null)?.trim() || null;
const refOf = (t: Tags = {}) => (t['piste:ref'] ?? t.ref ?? null)?.trim() || null;
const siteOf = (t: Tags = {}) => t.website ?? t['contact:website'] ?? t.url ?? null;

const coordsOf = (w: OsmWay): LonLat[] =>
  (w.geometry as { lat: number; lon: number }[]).map((p) => [Math.round(p.lon * 1e5) / 1e5, Math.round(p.lat * 1e5) / 1e5]);

const isClosedWay = (w: OsmWay) => w.nodes.length >= 4 && w.nodes[0] === w.nodes.at(-1);

/**
 * A closed way is an area when tagged area=yes, and a closed downhill way is one unless area=no:
 * slopes are rarely loops, while cross-country loops are common.
 */
export const isArea = (w: OsmWay, kind: PisteKind): boolean =>
  isClosedWay(w) && (isYes(w.tags?.area) || (kind === 'downhill' && w.tags?.area !== 'no'));

/** Ray casting on [lon, lat]: whether `p` lies inside `ring`. */
function inRing(p: LonLat, ring: LonLat[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/**
 * Closed rings from ways joined end to end (joinLines never closes a loop, which a ring needs).
 * Ways that do not close into a ring are dropped.
 */
export function joinRings(parts: { nodes: number[]; coords: LonLat[] }[]): LonLat[][] {
  const open = parts.map((p) => ({ nodes: [...p.nodes], coords: [...p.coords] }));
  const rings: LonLat[][] = [];
  while (open.length) {
    let { nodes, coords } = open.shift()!;
    for (let joined = true; joined && nodes[0] !== nodes.at(-1); ) {
      joined = false;
      for (let j = 0; j < open.length && !joined; j++) {
        const b = open[j];
        if (b.nodes[0] === nodes.at(-1)) [nodes, coords] = [[...nodes, ...b.nodes.slice(1)], [...coords, ...b.coords.slice(1)]];
        else if (b.nodes.at(-1) === nodes.at(-1)) [nodes, coords] = [[...nodes, ...b.nodes.slice(0, -1).reverse()], [...coords, ...b.coords.slice(0, -1).reverse()]];
        else continue;
        open.splice(j, 1);
        joined = true;
      }
    }
    if (nodes.length >= 4 && nodes[0] === nodes.at(-1)) rings.push(coords);
  }
  return rings;
}

/** Rings from a multipolygon's member ways; inner rings go into the outer ring they lie in. */
export function multipolygon(members: { way: OsmWay; role: string }[]): LonLat[][][] {
  const rings = (role: 'outer' | 'inner') =>
    joinRings(members.filter((m) => (m.role || 'outer') === role).map((m) => ({ nodes: m.way.nodes, coords: coordsOf(m.way) })));
  const polygons = rings('outer').map((r) => [r]);
  for (const inner of rings('inner')) polygons.find((p) => inRing(inner[0], p[0]))?.push(inner);
  return polygons;
}

/** The value carried by most of the given ways, by count; ties go to the earlier one. */
function mostCommon<T>(values: (T | null)[]): T | null {
  const counts = new Map<T, number>();
  for (const v of values) if (v !== null) counts.set(v, (counts.get(v) ?? 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
}

const empty = { lift: null, occupancy: null, capacity: null, durationMin: null, heating: false, bubble: false } as const;

/** Overpass JSON -> lifts and pistes, sorted by kind and id so repeated runs give clean diffs. */
export function parseWinter(osm: { elements: OsmElement[] }): WinterItem[] {
  const wayById = new Map<number, OsmWay>();
  for (const e of osm.elements) {
    if (e.type !== 'way' || wayById.has(e.id)) continue;
    const pts = (e.geometry ?? []).filter((p): p is { lat: number; lon: number } => !!p && Number.isFinite(p.lat) && Number.isFinite(p.lon));
    if (pts.length >= 2 && pts.length === e.nodes?.length) wayById.set(e.id, e);
  }
  const relations = osm.elements.filter((e): e is OsmRelation => e.type === 'relation' && !isGone(e.tags)).sort((a, b) => a.id - b.id);
  const items: WinterItem[] = [];

  // Lifts: one way each.
  for (const w of wayById.values()) {
    const t = w.tags ?? {};
    const lift = (LIFT_TYPES as readonly string[]).includes(t.aerialway) ? (t.aerialway as LiftType) : null;
    if (!lift || isGone(t)) continue;
    items.push({
      id: `w${w.id}`,
      kind: 'lift',
      lift,
      difficulty: null,
      grooming: null,
      name: (t.name ?? t['name:de'] ?? t['name:it'] ?? null)?.trim() || null,
      ref: t.ref?.trim() || null,
      lit: false,
      occupancy: num(t['aerialway:occupancy']),
      capacity: num(t['aerialway:capacity']),
      durationMin: durationMinutes(t['aerialway:duration']),
      heating: isYes(t['aerialway:heating']),
      bubble: isYes(t['aerialway:bubble']),
      website: siteOf(t),
      osm: `way/${w.id}`,
      ways: 1,
      geometry: { type: 'lines', lines: [coordsOf(w)] },
    });
  }

  // Ways a relation already draws, per kind ("123/nordic").
  const covered = new Set<string>();
  for (const r of relations) {
    const kind = pisteKind(r.tags);
    if (!kind) continue;
    const rt = r.tags ?? {};
    const members = r.members
      .filter((m) => m.type === 'way' && wayById.has(m.ref))
      .map((m) => ({ way: wayById.get(m.ref)!, role: m.role }))
      // A member tagged as another kind of piste (a slope crossing a trail) is drawn as that one.
      .filter((m) => (pisteKind(m.way.tags) ?? kind) === kind && !isGone(m.way.tags));
    const ways = [...new Map(members.map((m) => [m.way.id, m.way])).values()].sort((a, b) => a.id - b.id);
    if (!ways.length) continue;
    let geometry: WinterItem['geometry'];
    if (rt.type === 'multipolygon') {
      const polygons = multipolygon(members);
      if (!polygons.length) continue;
      geometry = { type: 'polygons', polygons };
    } else if (rt.type === 'route' || rt.route) {
      geometry = { type: 'lines', lines: joinLines(ways.map((w) => ({ nodes: w.nodes, coords: coordsOf(w) }))) };
    } else continue;
    for (const w of ways) covered.add(`${w.id}/${kind}`);
    items.push({
      id: `r${r.id}`,
      kind,
      ...empty,
      difficulty: difficulty(rt['piste:difficulty']) ?? mostCommon(ways.map((w) => difficulty(w.tags?.['piste:difficulty']))),
      grooming: grooming(rt['piste:grooming']) ?? mostCommon(ways.map((w) => grooming(w.tags?.['piste:grooming']))),
      name: nameOf(rt) ?? mostCommon(ways.map((w) => nameOf(w.tags))),
      ref: refOf(rt),
      lit: isYes(rt['piste:lit'] ?? rt.lit) || ways.some((w) => isYes(w.tags?.['piste:lit'] ?? w.tags?.lit)),
      website: siteOf(rt) ?? ways.map((w) => siteOf(w.tags)).find(Boolean) ?? null,
      osm: `relation/${r.id}`,
      ways: ways.length,
      geometry,
    });
  }

  // Pistes outside relations: areas on their own, lines joined when they share a node and their
  // kind, name and difficulty.
  const loose = [...wayById.values()]
    .filter((w) => {
      const kind = pisteKind(w.tags);
      return kind && !covered.has(`${w.id}/${kind}`) && !isGone(w.tags);
    })
    .sort((a, b) => a.id - b.id);
  const signature = (w: OsmWay) => {
    const n = nameOf(w.tags);
    return n ? `${pisteKind(w.tags)}|${n.toLowerCase()}|${difficulty(w.tags?.['piste:difficulty'])}` : null;
  };
  const uf = new UnionFind();
  const firstAt = new Map<string, number>();
  for (const w of loose) {
    const sig = signature(w);
    if (!sig || isArea(w, pisteKind(w.tags)!)) continue;
    for (const n of w.nodes) {
      const k = `${sig}|${n}`;
      if (firstAt.has(k)) uf.union(firstAt.get(k)!, w.id);
      else firstAt.set(k, w.id);
    }
  }
  // Unnamed sections continue each other where exactly two of the kind meet, end to end, with the
  // same difficulty: a run split for a bridge or a tag change, not a junction of runs.
  const lineWays = loose.filter((w) => !isArea(w, pisteKind(w.tags)!));
  const touching = new Map<string, OsmWay[]>();
  for (const w of lineWays) for (const n of new Set(w.nodes)) touching.set(`${pisteKind(w.tags)}|${n}`, [...(touching.get(`${pisteKind(w.tags)}|${n}`) ?? []), w]);
  const isEnd = (w: OsmWay, n: number) => w.nodes[0] === n || w.nodes.at(-1) === n;
  for (const w of lineWays) {
    if (nameOf(w.tags)) continue;
    for (const n of [w.nodes[0], w.nodes.at(-1)!]) {
      const there = touching.get(`${pisteKind(w.tags)}|${n}`) ?? [];
      const other = there.length === 2 ? there.find((o) => o !== w) : undefined;
      if (other && !nameOf(other.tags) && isEnd(other, n) && difficulty(other.tags?.['piste:difficulty']) === difficulty(w.tags?.['piste:difficulty'])) {
        uf.union(w.id, other.id);
      }
    }
  }
  const groups = new Map<number, OsmWay[]>();
  for (const w of loose) groups.set(uf.find(w.id), [...(groups.get(uf.find(w.id)) ?? []), w]);
  for (const ways of groups.values()) {
    const first = ways[0];
    const t = first.tags ?? {};
    const kind = pisteKind(t)!;
    const area = ways.length === 1 && isArea(first, kind);
    items.push({
      id: `w${first.id}`,
      kind,
      ...empty,
      difficulty: mostCommon(ways.map((w) => difficulty(w.tags?.['piste:difficulty']))),
      grooming: mostCommon(ways.map((w) => grooming(w.tags?.['piste:grooming']))),
      name: nameOf(t),
      ref: mostCommon(ways.map((w) => refOf(w.tags))),
      lit: ways.some((w) => isYes(w.tags?.['piste:lit'] ?? w.tags?.lit)),
      website: ways.map((w) => siteOf(w.tags)).find(Boolean) ?? null,
      osm: `way/${first.id}`,
      ways: ways.length,
      geometry: area
        ? { type: 'polygons', polygons: [[coordsOf(first)]] }
        : { type: 'lines', lines: joinLines(ways.map((w) => ({ nodes: w.nodes, coords: coordsOf(w) }))) },
    });
  }

  const order: WinterKind[] = ['lift', ...PISTE_KINDS];
  return items.sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind) || a.id.localeCompare(b.id, 'en', { numeric: true }));
}

/** The first position of an item: where the app decides whether it lies in the covered area. */
export const firstPoint = (g: WinterItem['geometry']): LonLat => (g.type === 'lines' ? g.lines[0][0] : g.polygons[0][0][0]);

/** Whether an item starts inside the area the snow data covers (the app's island). */
export const startsInArea = (item: WinterItem): boolean => {
  const [lon, lat] = firstPoint(item.geometry);
  return lon >= MODEL_GRID.west && lon <= MODEL_GRID.east && lat >= MODEL_GRID.south && lat <= MODEL_GRID.north;
};

/** Every line of an item: the lines themselves, or the rings of its areas. */
export const itemLines = (item: WinterItem): LonLat[][] =>
  item.geometry.type === 'lines' ? item.geometry.lines : item.geometry.polygons.flat();

/** Statistics from the terrain model. */
export interface WinterStats {
  /** Length of the lines (for an area: 0). */
  lengthM: number;
  /** Area in hectares, for a slope mapped as an area; otherwise null. */
  areaHa: number | null;
  minM: number;
  maxM: number;
  /** Height gained along a trail; null for lifts, slopes and when the lines do not form one line. */
  climbM: number | null;
  /** Lifts: elevation where the way starts and ends (OSM draws lifts in the direction of travel). */
  startM: number | null;
  endM: number | null;
}

/** Shoelace in local metres, outer rings minus holes. */
function areaM2(polygons: LonLat[][][]): number {
  const m = (Math.PI / 180) * 6371008.8;
  const ring = (r: LonLat[]) => {
    const c = Math.cos((r[0][1] * Math.PI) / 180);
    let s = 0;
    for (let i = 1; i < r.length; i++) s += (r[i - 1][0] * r[i][1] - r[i][0] * r[i - 1][1]) * m * m * c;
    return Math.abs(s / 2);
  };
  return polygons.reduce((sum, [outer, ...holes]) => sum + ring(outer) - holes.reduce((h, r) => h + ring(r), 0), 0);
}

export function winterStats(item: WinterItem, elevationAt: (lon: number, lat: number) => number, stepM = 10): WinterStats {
  const lines = itemLines(item);
  const profiles = lines.map((l) => resample(l, stepM).map(([lon, lat]) => elevationAt(lon, lat)));
  const all = profiles.flat();
  const isLines = item.geometry.type === 'lines';
  const climb = isLines && profiles.length === 1 && (item.kind === 'nordic' || item.kind === 'skitour') ? ascentDescent(profiles[0]) : null;
  const ends = item.kind === 'lift' ? profiles[0] : null;
  return {
    lengthM: isLines ? Math.round(lines.reduce((s, l) => s + lineLengthM(l), 0)) : 0,
    areaHa: item.geometry.type === 'polygons' ? Math.round(areaM2(item.geometry.polygons) / 1000) / 10 : null,
    minM: Math.round(Math.min(...all)),
    maxM: Math.round(Math.max(...all)),
    climbM: climb ? Math.round(Math.max(climb.ascent, climb.descent)) : null,
    startM: ends ? Math.round(ends[0]) : null,
    endM: ends ? Math.round(ends.at(-1)!) : null,
  };
}

/** Simplification tolerance for the drawn lines; the statistics use the full geometry. */
const DRAW_TOLERANCE_M = 4;

/**
 * Properties without the empty ones (null, false, 0, one section) and without `osm`, which the id
 * gives: about a third of the file otherwise. The app fills the defaults back in (winter.ts).
 */
export function compactProps(p: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(p).filter(([k, v]) => k !== 'osm' && v !== null && v !== false && !(k === 'ways' && v === 1) && !(k === 'lengthM' && v === 0)));
}

/** The layer file: one feature per item, positions [lon, lat, elevation m] for the snow check in the app. */
export function toWinterCollection(items: readonly WinterItem[], elevationAt: (lon: number, lat: number) => number) {
  const ele = (l: LonLat[]) => simplify(l, DRAW_TOLERANCE_M).map(([lon, lat]): LonLatEle => [lon, lat, Math.round(elevationAt(lon, lat))]);
  return {
    type: 'FeatureCollection' as const,
    features: items.map((item) => {
      const { geometry: g, ...props } = item;
      const geometry =
        g.type === 'lines'
          ? g.lines.length === 1
            ? { type: 'LineString' as const, coordinates: ele(g.lines[0]) }
            : { type: 'MultiLineString' as const, coordinates: g.lines.map(ele) }
          : g.polygons.length === 1
            ? { type: 'Polygon' as const, coordinates: g.polygons[0].map(ele) }
            : { type: 'MultiPolygon' as const, coordinates: g.polygons.map((p) => p.map(ele)) };
      return { type: 'Feature' as const, geometry, properties: compactProps({ ...props, ...winterStats(item, elevationAt) }) };
    }),
  };
}
