// Via ferratas (Klettersteige) from OpenStreetMap, for the static layer in web/src/data/ferratas.json.
//
// OSM maps a via ferrata as a chain of ways, tagged highway=via_ferrata or highway=path plus
// via_ferrata_scale; only a few routes have a route=via_ferrata relation. So ways are grouped into
// routes here: by relation, by shared nodes, and by name across small gaps.

import { distanceM, lineLengthM, resample } from '../../shared/geo.ts';
import { STATION_BBOX } from './config.ts';

export interface OsmWay {
  type: 'way';
  id: number;
  nodes: number[];
  geometry: ({ lat: number; lon: number } | null)[];
  tags?: Record<string, string>;
}

export interface OsmRelation {
  type: 'relation';
  id: number;
  members: { type: string; ref: number; role: string }[];
  tags?: Record<string, string>;
}

type OsmElement = OsmWay | OsmRelation | { type: 'node'; id: number };

export type LonLat = [number, number];
export type LonLatEle = [number, number, number];

/** A route before elevations are added. */
export interface FerrataRoute {
  /** `r<relation id>`, or `w<lowest way id>`. */
  id: string;
  name: string | null;
  /** Names of other sections (variants, descents, linked ferratas), longest first. */
  otherNames: string[];
  /** Hardest section on the OSM via_ferrata_scale (0–6, like Hüsler K0–K6), or null if no section is graded. */
  grade: number | null;
  /** Easiest graded section. */
  gradeMin: number | null;
  /** The hardest section's grade as written, cleaned up: "3", "3+", "2-". */
  scale: string | null;
  closed: boolean;
  /** The mapper's note on a closed section ("closed because of rockfall …"), if any. */
  closedNote: string | null;
  website: string | null;
  /** `relation/<id>` or `way/<id>`, for a link to openstreetmap.org. */
  osm: string;
  ways: number;
  /** Mapped sections, joined where they share an end node. */
  lines: LonLat[][];
}

/** Statistics from the terrain model along the mapped sections. */
export interface FerrataStats {
  lengthM: number;
  minM: number;
  maxM: number;
  /** Height gained walking the route uphill; null when the sections do not form one line. */
  climbM: number | null;
}

/** Same box as the stations and bivouacs: South Tyrol plus about 30 km around it. */
const BBOX = `${STATION_BBOX.south},${STATION_BBOX.west},${STATION_BBOX.north},${STATION_BBOX.east}`;

/**
 * Both tagging styles, plus route relations and all their member ways (a few relations are made
 * only of plain paths). Ways need `out geom` (not `out geom tags`, which also drops the relation
 * members) so the node ids come along for joining sections.
 */
export const OVERPASS_QUERY = `[out:json][timeout:180];
(
  way["highway"="via_ferrata"](${BBOX});
  way["highway"="path"]["via_ferrata_scale"](${BBOX});
);
out geom;
relation["route"="via_ferrata"](${BBOX})->.r;
.r out body;
way(r.r);
out geom;`;

const LETTERS = 'ABCDEF';

/** "3+" ranks above "3", which ranks above "3-". */
const rank = (g: { grade: number; label: string }) => g.grade + (g.label.endsWith('+') ? 0.3 : g.label.endsWith('-') ? -0.3 : 0);
const harder = <T extends { grade: number; label: string }>(a: T, b: T): T => (rank(b) > rank(a) ? b : a);

/**
 * Parses a via_ferrata_scale value. Seen in the region: "0"–"6", "2+", "3-", "1.5", "C"; also
 * accepted: "K3", "2;3", "2-3", "B/C". Returns the hardest grade in it, or null if none is readable.
 */
export function parseScale(raw: string | undefined): { grade: number; min: number; label: string } | null {
  if (!raw) return null;
  const tokens = raw
    .toUpperCase()
    .replace(/(\d)\s*[-–]\s*(?=K?\d)/g, '$1;') // "2-3" is a range, "3-" a minus
    .split(/[;/,]/)
    .map((t) => t.trim());
  const found: { grade: number; label: string }[] = [];
  for (const t of tokens) {
    const n = /^K?\s*([0-6])(\.5|\+|-)?$/.exec(t);
    const l = /^([A-F])([+-])?$/.exec(t);
    if (n) found.push({ grade: Number(n[1]), label: `${n[1]}${n[2] === '.5' ? '+' : (n[2] ?? '')}` });
    else if (l) found.push({ grade: LETTERS.indexOf(l[1]) + 1, label: `${LETTERS.indexOf(l[1]) + 1}${l[2] ?? ''}` });
  }
  if (!found.length) return null;
  const hardest = found.reduce(harder);
  return { grade: hardest.grade, min: Math.min(...found.map((f) => f.grade)), label: hardest.label };
}

export const isFerrataWay = (tags: Record<string, string> = {}): boolean =>
  tags.highway === 'via_ferrata' || (tags.highway === 'path' && tags.via_ferrata_scale !== undefined);

/** access=no with foot=yes still lets walkers through, so foot decides when it is set. */
export function isClosed(tags: Record<string, string> = {}): boolean {
  if (tags['disused:highway'] || tags['abandoned:highway']) return true;
  if (tags.foot) return tags.foot === 'no' || tags.foot === 'private';
  return tags.access === 'no' || tags.access === 'private';
}

/** Joins lines (with their node ids) that share an end node, greedily in input order. */
export function joinLines(parts: { nodes: number[]; coords: LonLat[] }[]): LonLat[][] {
  const lines = parts.map((p) => ({ nodes: [...p.nodes], coords: [...p.coords] }));
  let joined = true;
  while (joined) {
    joined = false;
    for (let i = 0; i < lines.length && !joined; i++) {
      for (let j = i + 1; j < lines.length && !joined; j++) {
        const a = lines[i];
        const b = lines[j];
        const [a0, a1, b0, b1] = [a.nodes[0], a.nodes.at(-1), b.nodes[0], b.nodes.at(-1)];
        let nodes: number[] | null = null;
        let coords: LonLat[] = [];
        if (a1 === b0) [nodes, coords] = [[...a.nodes, ...b.nodes.slice(1)], [...a.coords, ...b.coords.slice(1)]];
        else if (b1 === a0) [nodes, coords] = [[...b.nodes, ...a.nodes.slice(1)], [...b.coords, ...a.coords.slice(1)]];
        else if (a1 === b1) [nodes, coords] = [[...a.nodes, ...b.nodes.slice(0, -1).reverse()], [...a.coords, ...b.coords.slice(0, -1).reverse()]];
        else if (a0 === b0) [nodes, coords] = [[...a.nodes.slice(1).reverse(), ...b.nodes], [...a.coords.slice(1).reverse(), ...b.coords]];
        // A closed loop stays as it is.
        if (nodes && nodes[0] !== nodes.at(-1)) {
          lines[i] = { nodes, coords };
          lines.splice(j, 1);
          joined = true;
        }
      }
    }
  }
  return lines.map((l) => l.coords);
}

/** Douglas–Peucker in local metres; keeps the ends. */
export function simplify<T extends readonly number[]>(line: T[], toleranceM: number): T[] {
  if (line.length < 3) return line;
  // Metres east and north of the first point.
  const m = Math.PI / 180 * 6371008.8;
  const xy = line.map((p) => [(p[0] - line[0][0]) * m * Math.cos(line[0][1] * Math.PI / 180), (p[1] - line[0][1]) * m]);
  const keep = new Uint8Array(line.length);
  keep[0] = keep[line.length - 1] = 1;
  const stack: [number, number][] = [[0, line.length - 1]];
  while (stack.length) {
    const [s, e] = stack.pop()!;
    const [x1, y1] = xy[s];
    const [x2, y2] = xy[e];
    const len = Math.hypot(x2 - x1, y2 - y1);
    let worst = -1;
    let at = -1;
    for (let i = s + 1; i < e; i++) {
      const [x, y] = xy[i];
      const d = len === 0 ? Math.hypot(x - x1, y - y1) : Math.abs((x2 - x1) * (y1 - y) - (x1 - x) * (y2 - y1)) / len;
      if (d > worst) [worst, at] = [d, i];
    }
    if (worst > toleranceM) {
      keep[at] = 1;
      stack.push([s, at], [at, e]);
    }
  }
  return line.filter((_, i) => keep[i]);
}

class UnionFind {
  private parent = new Map<number, number>();
  find(a: number): number {
    let p = this.parent.get(a) ?? a;
    if (p !== a) this.parent.set(a, (p = this.find(p)));
    return p;
  }
  union(a: number, b: number) {
    const [ra, rb] = [this.find(a), this.find(b)];
    if (ra !== rb) this.parent.set(Math.max(ra, rb), Math.min(ra, rb));
  }
}

const wayName = (t: Record<string, string> = {}) => t.name ?? t['name:de'] ?? t['name:it'] ?? null;
/** Sections with the same name are joined across mapping gaps up to this size. */
const NAME_GAP_M = 150;

/** Overpass JSON -> via ferrata routes, sorted by id so repeated runs give clean diffs. */
export function parseFerratas(osm: { elements: OsmElement[] }): FerrataRoute[] {
  const wayById = new Map<number, OsmWay>();
  for (const e of osm.elements) {
    if (e.type !== 'way' || wayById.has(e.id)) continue;
    const pts = (e.geometry ?? []).filter((p): p is { lat: number; lon: number } => !!p && Number.isFinite(p.lat) && Number.isFinite(p.lon));
    if (pts.length >= 2 && pts.length === e.nodes?.length) wayById.set(e.id, e);
  }
  const relations = osm.elements.filter((e): e is OsmRelation => e.type === 'relation').sort((a, b) => a.id - b.id);

  // Ways in the layer: every ferrata way, plus the members of relations that have no ferrata way
  // (a relation with ferrata ways lists its approach paths too, which are left out).
  const used = new Map<number, OsmWay>();
  for (const w of wayById.values()) if (isFerrataWay(w.tags)) used.set(w.id, w);
  const relationOf = new Map<number, OsmRelation>();
  for (const r of relations) {
    const members = r.members.filter((m) => m.type === 'way' && wayById.has(m.ref)).map((m) => wayById.get(m.ref)!);
    const ferrata = members.filter((w) => isFerrataWay(w.tags));
    for (const w of ferrata.length ? ferrata : members) {
      used.set(w.id, w);
      if (!relationOf.has(w.id)) relationOf.set(w.id, r);
    }
  }

  // Sections are one route when they share a relation or a node, or carry the same name across a
  // small gap. Names alone do not split: variants, rope bridges and descents are often named
  // separately. Ferratas that really connect (Bocchette, Paternkofel) become one route system.
  const ids = [...used.keys()].sort((a, b) => a - b);
  const uf = new UnionFind();
  const firstOf = new Map<number, number>();
  for (const id of ids) {
    const r = relationOf.get(id);
    if (r && firstOf.has(r.id)) uf.union(firstOf.get(r.id)!, id);
    else if (r) firstOf.set(r.id, id);
  }
  const firstAtNode = new Map<number, number>();
  for (const id of ids) {
    for (const n of used.get(id)!.nodes) {
      if (firstAtNode.has(n)) uf.union(firstAtNode.get(n)!, id);
      else firstAtNode.set(n, id);
    }
  }
  const ends = ids.map((id) => {
    const g = used.get(id)!.geometry as { lat: number; lon: number }[];
    return { id, name: wayName(used.get(id)!.tags)?.trim().toLowerCase(), ends: [g[0], g.at(-1)!].map((p) => [p.lon, p.lat]) };
  });
  for (let i = 0; i < ends.length; i++) {
    for (let j = i + 1; j < ends.length; j++) {
      const [a, b] = [ends[i], ends[j]];
      if (!a.name || a.name !== b.name || uf.find(a.id) === uf.find(b.id)) continue;
      if (a.ends.some((p) => b.ends.some((q) => distanceM(p, q) < NAME_GAP_M))) uf.union(a.id, b.id);
    }
  }

  const groups = new Map<number, OsmWay[]>();
  for (const id of ids) groups.set(uf.find(id), [...(groups.get(uf.find(id)) ?? []), used.get(id)!]);

  const routes: FerrataRoute[] = [];
  for (const ways of groups.values()) {
    const relation = ways.map((w) => relationOf.get(w.id)).find(Boolean);
    const rt = relation?.tags ?? {};
    const coordsOf = (w: OsmWay): LonLat[] =>
      (w.geometry as { lat: number; lon: number }[]).map((p) => [Math.round(p.lon * 1e5) / 1e5, Math.round(p.lat * 1e5) / 1e5]);
    // The name carried by most of the route's length.
    const byName = new Map<string, number>();
    for (const w of ways) {
      const n = wayName(w.tags);
      if (n) byName.set(n, (byName.get(n) ?? 0) + lineLengthM(coordsOf(w)));
    }
    const names = [...byName].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([n]) => n);
    const name = wayName(rt) ?? names[0] ?? null;
    const grades = ways.map((w) => parseScale(w.tags?.via_ferrata_scale)).filter((g) => g !== null);
    // The relation's own grade wins; otherwise the hardest section's.
    const own = parseScale(rt.via_ferrata_scale);
    const hardest = own ?? (grades.length ? grades.reduce(harder) : null);
    const graded = own ? [...grades, own] : grades;
    const closedWay = ways.find((w) => isClosed(w.tags));
    const closed = isClosed(rt) || !!closedWay;
    const minId = Math.min(...ways.map((w) => w.id));
    const site = (t: Record<string, string> = {}) => t.website ?? t['contact:website'] ?? t.url ?? null;
    routes.push({
      id: relation ? `r${relation.id}` : `w${minId}`,
      name,
      otherNames: names.filter((n) => n !== name).slice(0, 6),
      grade: hardest?.grade ?? null,
      gradeMin: graded.length ? Math.min(...graded.map((g) => g.min)) : null,
      scale: hardest?.label ?? null,
      closed,
      closedNote: closed ? (rt.note ?? closedWay?.tags?.note ?? closedWay?.tags?.description ?? null) : null,
      website: site(rt) ?? ways.map((w) => site(w.tags)).find(Boolean) ?? null,
      osm: relation ? `relation/${relation.id}` : `way/${minId}`,
      ways: ways.length,
      lines: joinLines(ways.sort((a, b) => a.id - b.id).map((w) => ({ nodes: w.nodes, coords: coordsOf(w) }))),
    });
  }
  return routes.sort((a, b) => a.id.localeCompare(b.id, 'en', { numeric: true }));
}

/**
 * Ascent and descent along a profile with hysteresis: a change only counts once the profile has
 * moved `thresholdM` from the last turning point, so terrain-model noise on gentle ground does not
 * add up (the spike measured +30 % on a gentle path with plain summing).
 */
export function ascentDescent(elevations: readonly number[], thresholdM = 5): { ascent: number; descent: number } {
  let ascent = 0;
  let descent = 0;
  let ref = elevations[0];
  let dir = 0;
  for (const e of elevations.slice(1)) {
    if (dir >= 0 && e > ref && (dir === 1 || e - ref >= thresholdM)) {
      ascent += e - ref;
      [ref, dir] = [e, 1];
    } else if (dir <= 0 && e < ref && (dir === -1 || ref - e >= thresholdM)) {
      descent += ref - e;
      [ref, dir] = [e, -1];
    } else if (dir === 1 && ref - e >= thresholdM) {
      descent += ref - e;
      [ref, dir] = [e, -1];
    } else if (dir === -1 && e - ref >= thresholdM) {
      ascent += e - ref;
      [ref, dir] = [e, 1];
    }
  }
  return { ascent, descent };
}

/** Terrain statistics over the mapped sections; `elevationAt` reads the terrain model in metres. */
export function routeStats(lines: readonly LonLat[][], elevationAt: (lon: number, lat: number) => number, stepM = 10): FerrataStats {
  const profiles = lines.map((l) => resample(l, stepM).map(([lon, lat]) => elevationAt(lon, lat)));
  const all = profiles.flat();
  const climb = profiles.length === 1 ? ascentDescent(profiles[0]) : null;
  return {
    lengthM: Math.round(lines.reduce((s, l) => s + lineLengthM(l), 0)),
    minM: Math.round(Math.min(...all)),
    maxM: Math.round(Math.max(...all)),
    climbM: climb ? Math.round(Math.max(climb.ascent, climb.descent)) : null,
  };
}

/** Simplification tolerance for the drawn lines; the statistics use the full geometry. */
const DRAW_TOLERANCE_M = 2;

/** The layer file: one feature per route, positions [lon, lat, elevation m] for the snow check in the app. */
export function toFeatureCollection(routes: readonly FerrataRoute[], elevationAt: (lon: number, lat: number) => number) {
  return {
    type: 'FeatureCollection' as const,
    features: routes.map(({ lines, ...props }) => {
      const coords = lines.map((l) =>
        simplify(l, DRAW_TOLERANCE_M).map(([lon, lat]): LonLatEle => [lon, lat, Math.round(elevationAt(lon, lat))]),
      );
      return {
        type: 'Feature' as const,
        geometry: coords.length === 1 ? { type: 'LineString' as const, coordinates: coords[0] } : { type: 'MultiLineString' as const, coordinates: coords },
        properties: { ...props, ...routeStats(lines, elevationAt) },
      };
    }),
  };
}
