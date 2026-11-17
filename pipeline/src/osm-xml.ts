// Reads OSM XML as osmium writes it (one element or child per line, nodes before ways before
// relations) into the shape Overpass answers `out geom` with, keeping only what lies in a box.
// Used for the OpenSnowMap daily piste extract, the winter layer's source when Overpass is busy.

import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { Readable } from 'node:stream';
import { createGunzip } from 'node:zlib';
import type { OsmRelation, OsmWay } from './ferratas.ts';

export interface Box {
  west: number;
  south: number;
  east: number;
  north: number;
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const unescape = (s: string) =>
  s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_, e: string) =>
    e[0] === '#' ? String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : Number(e.slice(1))) : ENTITIES[e.toLowerCase()],
  );
const attr = (line: string, name: string) => {
  const m = new RegExp(`\\s${name}="([^"]*)"`).exec(line);
  return m ? unescape(m[1]) : undefined;
};

/**
 * Ways with at least one node in `box` (nodes outside it come back as null in `geometry`, like
 * Overpass outside a bounding box), and relations with at least one of those ways as a member.
 */
export async function readOsmXml(lines: AsyncIterable<string>, box: Box): Promise<{ elements: (OsmWay | OsmRelation)[] }> {
  const nodes = new Map<number, { lat: number; lon: number }>();
  const ways = new Map<number, OsmWay>();
  const elements: (OsmWay | OsmRelation)[] = [];
  let way: OsmWay | null = null;
  let relation: OsmRelation | null = null;
  let tags: Record<string, string> = {};
  for await (const raw of lines) {
    const line = raw.trimStart();
    if (line.startsWith('<node ')) {
      const lat = Number(attr(line, 'lat'));
      const lon = Number(attr(line, 'lon'));
      if (lat >= box.south && lat <= box.north && lon >= box.west && lon <= box.east) nodes.set(Number(attr(line, 'id')), { lat, lon });
    } else if (line.startsWith('<way ')) {
      tags = {};
      way = { type: 'way', id: Number(attr(line, 'id')), nodes: [], geometry: [], tags };
    } else if (line.startsWith('<relation ')) {
      tags = {};
      relation = { type: 'relation', id: Number(attr(line, 'id')), members: [], tags };
    } else if (line.startsWith('<nd ') && way) {
      const ref = Number(attr(line, 'ref'));
      way.nodes.push(ref);
      way.geometry.push(nodes.get(ref) ?? null);
    } else if (line.startsWith('<member ') && relation) {
      relation.members.push({ type: attr(line, 'type') ?? '', ref: Number(attr(line, 'ref')), role: attr(line, 'role') ?? '' });
    } else if (line.startsWith('<tag ')) {
      const k = attr(line, 'k');
      if (k !== undefined) tags[k] = attr(line, 'v') ?? '';
    } else if (line.startsWith('</way>') && way) {
      if (way.geometry.some(Boolean)) {
        ways.set(way.id, way);
        elements.push(way);
      }
      way = null;
    } else if (line.startsWith('</relation>') && relation) {
      if (relation.members.some((m) => m.type === 'way' && ways.has(m.ref))) elements.push(relation);
      relation = null;
    }
    // Self-closing <way .../> or <relation .../> have no nodes or members and are skipped.
    if (way && line.startsWith('<way ') && line.endsWith('/>')) way = null;
    if (relation && line.startsWith('<relation ') && line.endsWith('/>')) relation = null;
  }
  return { elements };
}

/** Lines of a local or downloaded OSM XML file; `.gz` is unpacked on the fly. */
export async function osmXmlLines(source: string): Promise<AsyncIterable<string>> {
  let stream: Readable;
  if (/^https?:/.test(source)) {
    const res = await fetch(source);
    if (!res.ok || !res.body) throw new Error(`${source}: HTTP ${res.status}`);
    stream = Readable.fromWeb(res.body as import('node:stream/web').ReadableStream);
  } else {
    stream = createReadStream(source);
  }
  if (source.endsWith('.gz')) stream = stream.pipe(createGunzip());
  return createInterface({ input: stream, crlfDelay: Infinity });
}
