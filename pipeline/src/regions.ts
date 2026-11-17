// EAWS avalanche warning regions for the place panel: which micro-region a point lies in, and
// which warning service publishes its bulletin. Pure functions; regions-run.ts fetches the data.
//
// Source: https://regions.avalanches.org (gitlab.com/eaws/eaws-regions), CC0 1.0. Only regions that
// are valid now (no end date) and touch the data area are kept, simplified to about 30 m.

import type { Feature, MultiPolygon, Polygon, Position } from 'geojson';
import type { Bbox4, Region, RegionsFile } from '../../shared/types.ts';

export const REGIONS_URL = 'https://regions.avalanches.org';
/** Region files (one per warning service area) that reach the data area, 10.2–12.7° E, 46.1–47.25° N. */
export const REGION_FILES = ['AT-02', 'AT-05', 'AT-07', 'CH', 'IT-25', 'IT-25-SO-LI', 'IT-32-BZ', 'IT-32-TN', 'IT-34', 'IT-36'];
/** The Euregio services publish on avalanche.report, whose bulletin page shows all their regions. */
export const EUREGIO = ['AT-07', 'IT-32-BZ', 'IT-32-TN'];
export const EUREGIO_BULLETIN = 'https://avalanche.report/bulletin/latest';
/** Douglas–Peucker tolerance in degrees (about 30 m north–south, 22 m east–west here). */
const TOLERANCE = 0.0003;

type RegionFeature = Feature<Polygon | MultiPolygon, { id: string; start_date?: string | null; end_date?: string | null }>;

interface ServiceProps {
  id: string;
  aws?: { name: string; url?: Record<string, string | string[]> }[];
}

function perpendicular(p: Position, a: Position, b: Position): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return Math.hypot(p[0] - a[0], p[1] - a[1]);
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

/** Douglas–Peucker on an open line (iterative, so long borders do not overflow the stack). */
export function simplifyLine(points: Position[], tolerance: number): Position[] {
  if (points.length < 3) return points;
  const keep = new Uint8Array(points.length);
  keep[0] = keep[points.length - 1] = 1;
  const stack: [number, number][] = [[0, points.length - 1]];
  while (stack.length) {
    const [i, j] = stack.pop()!;
    let max = 0;
    let at = -1;
    for (let k = i + 1; k < j; k++) {
      const d = perpendicular(points[k], points[i], points[j]);
      if (d > max) [max, at] = [d, k];
    }
    if (at >= 0 && max > tolerance) {
      keep[at] = 1;
      stack.push([i, at], [at, j]);
    }
  }
  return points.filter((_, k) => keep[k]);
}

/** A closed ring, simplified and rounded; null when too little of it is left. */
function simplifyRing(ring: Position[], tolerance: number): Position[] | null {
  const round = (p: Position): Position => [Math.round(p[0] * 1e4) / 1e4, Math.round(p[1] * 1e4) / 1e4];
  const out = simplifyLine(ring, tolerance).map(round);
  const dedup = out.filter((p, k) => k === 0 || p[0] !== out[k - 1][0] || p[1] !== out[k - 1][1]);
  return dedup.length >= 4 ? dedup : null;
}

function bboxOf(polygons: Position[][][]): Bbox4 {
  const b: Bbox4 = [Infinity, Infinity, -Infinity, -Infinity];
  for (const poly of polygons)
    for (const [x, y] of poly[0]) {
      b[0] = Math.min(b[0], x);
      b[1] = Math.min(b[1], y);
      b[2] = Math.max(b[2], x);
      b[3] = Math.max(b[3], y);
    }
  return b;
}

const intersects = (a: Bbox4, b: Bbox4) => a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1];

/** The longest service id that is a prefix of the region id (`IT-25-SO-LI` before `IT-25`). */
export function serviceFor(regionId: string, serviceIds: string[]): string | null {
  return serviceIds.filter((s) => regionId === s || regionId.startsWith(`${s}-`)).sort((a, b) => b.length - a.length)[0] ?? null;
}

/** Local name(s) to show next to the English one. */
/** The source names contain non-breaking spaces; plain ones wrap and compare better. */
const clean = (s: string | undefined) => s?.replace(/\s+/g, ' ').trim();

export function localName(id: string, names: { en: Record<string, string>; de: Record<string, string>; it: Record<string, string> }): string | undefined {
  const [en, de, it] = [names.en[id], names.de[id], names.it[id]].map(clean);
  const local = id.startsWith('IT-32-BZ')
    ? [...new Set([de, it].filter(Boolean))].join(' / ')
    : id.startsWith('IT-')
      ? it
      : de;
  return local && local !== en ? local : undefined;
}

export function buildRegions(opts: {
  /** The micro-region GeoJSON files. */
  collections: { features: RegionFeature[] }[];
  /** outline_properties/index.json: the warning services and their pages. */
  services: ServiceProps[];
  names: { en: Record<string, string>; de: Record<string, string>; it: Record<string, string> };
  area: Bbox4;
  date: string;
}): RegionsFile {
  const serviceIds = opts.services.map((s) => s.id);
  const regions: Region[] = [];
  const used = new Set<string>();
  for (const fc of opts.collections) {
    for (const f of fc.features) {
      const { id, end_date } = f.properties;
      if (end_date && end_date <= opts.date) continue;
      const raw = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
      const polygons = raw
        .map((poly) => poly.map((ring) => simplifyRing(ring, TOLERANCE)))
        .filter((poly) => poly[0] !== null)
        .map((poly) => poly.filter((r): r is Position[] => r !== null));
      if (!polygons.length) continue;
      const bbox = bboxOf(polygons);
      if (!intersects(bbox, opts.area)) continue;
      const service = serviceFor(id, serviceIds);
      if (!service) throw new Error(`No warning service for region ${id}`);
      used.add(service);
      regions.push({ id, name: clean(opts.names.en[id]) ?? id, local: localName(id, opts.names), service, bbox, polygons });
    }
  }
  const services: RegionsFile['services'] = {};
  for (const s of opts.services) {
    if (!used.has(s.id)) continue;
    if (EUREGIO.includes(s.id)) {
      services[s.id] = { name: 'avalanche.report', url: EUREGIO_BULLETIN };
      continue;
    }
    const aws = s.aws?.[0];
    const url = aws?.url?.en ?? aws?.url?.de ?? aws?.url?.it;
    if (!aws || typeof url !== 'string') throw new Error(`No bulletin page for warning service ${s.id}`);
    services[s.id] = { name: aws.name, url };
  }
  regions.sort((a, b) => a.id.localeCompare(b.id));
  return {
    source: `EAWS micro-regions, ${REGIONS_URL}, ${opts.date}`,
    licence: 'CC0 1.0',
    attribution: 'EAWS regions (regions.avalanches.org)',
    services,
    regions,
  };
}
