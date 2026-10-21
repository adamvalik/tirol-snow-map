// Bivouacs (bivacchi, Biwaks) from OpenStreetMap, for the static list in web/src/data/bivouacs.json.

import { STATION_BBOX } from './config.ts';

export interface Bivouac {
  name: string;
  lat: number;
  lon: number;
  /** Metres, or null when OSM has no usable `ele`. */
  ele: number | null;
  /** Places to sleep, or null when unknown. */
  capacity: number | null;
  /** How the app draws it: the classic red/orange metal box, or a wooden cabin. */
  kind: 'metal' | 'wood';
  osm: string;
}

interface OsmElement {
  type: 'node' | 'way' | 'relation';
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
}

/** Same box as the stations: South Tyrol plus about 30 km around it. */
const BBOX = `${STATION_BBOX.south},${STATION_BBOX.west},${STATION_BBOX.north},${STATION_BBOX.east}`;

/** Huts and shelters whose name says bivouac; the name is the one tag mappers use consistently. */
export const OVERPASS_QUERY = `[out:json][timeout:120];
(
  nwr["tourism"="wilderness_hut"]["name"~"bivac|biwak|bivak|bivou",i](${BBOX});
  nwr["amenity"="shelter"]["name"~"bivac|biwak|bivak|bivou",i](${BBOX});
  nwr["tourism"="alpine_hut"]["name"~"bivac|biwak|bivak|bivou",i](${BBOX});
);
out center tags;`;

const NAME = /bivac|biwak|bivak|bivou/i;
/** Wood named in the description, unless the wood is only the frame under sheet metal ("ricoperta di lamiera"). */
const WOOD_TEXT = /\b(interamente in legno|(edificio|costruzione|capanna|casetta|bivacco|struttura) in legno)\b|holzhütte|holzbiwak|wooden (hut|cabin|shelter)/i;
const METAL_TEXT = /lamiera|blech|metal|steel|acciaio|alluminio/i;

const number = (s: string | undefined): number | null => {
  const v = Number.parseFloat((s ?? '').replace(',', '.'));
  return Number.isFinite(v) ? v : null;
};

export function bivouacKind(tags: Record<string, string>): Bivouac['kind'] {
  const material = tags['building:material'] ?? tags.material;
  if (material) return material === 'wood' ? 'wood' : 'metal';
  const text = `${tags.description ?? ''} ${tags.note ?? ''}`;
  return WOOD_TEXT.test(text) && !METAL_TEXT.test(text) ? 'wood' : 'metal';
}

/** Overpass JSON -> bivouacs open to the public, highest first. */
export function parseBivouacs(osm: { elements: OsmElement[] }): Bivouac[] {
  const out: Bivouac[] = [];
  const seen = new Set<string>();
  for (const e of osm.elements) {
    const t = e.tags ?? {};
    const name = t.name ?? t['name:it'] ?? t['name:de'];
    const lat = e.lat ?? e.center?.lat;
    const lon = e.lon ?? e.center?.lon;
    if (!name || !NAME.test(name) || lat === undefined || lon === undefined) continue;
    if (t.access === 'private' || t.access === 'no' || t.disused === 'yes' || t.abandoned === 'yes' || t.ruins === 'yes') continue;
    const osmRef = `${e.type}/${e.id}`;
    if (seen.has(osmRef)) continue;
    seen.add(osmRef);
    const ele = number(t.ele);
    const capacity = number(t.capacity ?? t.beds);
    out.push({
      name,
      lat: Math.round(lat * 1e5) / 1e5,
      lon: Math.round(lon * 1e5) / 1e5,
      ele: ele === null ? null : Math.round(ele),
      capacity: capacity === null ? null : Math.round(capacity),
      kind: bivouacKind(t),
      osm: osmRef,
    });
  }
  return out.sort((a, b) => (b.ele ?? 0) - (a.ele ?? 0) || a.name.localeCompare(b.name));
}
