// Sentinel-2 L2A true-colour picture of the region, via the Sentinel Hub APIs on Copernicus Data
// Space. Needs an OAuth client (CDSE_CLIENT_ID / CDSE_CLIENT_SECRET).
//
// Strategy: find the newest day whose passes cover most of the region with little cloud
// (catalogue search, cheap), then render only that day (Process API, costs processing units).
// Cloud pixels are made transparent using the scene classification band, so the map underneath
// shows through; snow stays white.

const TOKEN_URL = 'https://identity.dataspace.copernicus.eu/auth/realms/CDSE/protocol/openid-connect/token';
const CATALOG_URL = 'https://sh.dataspace.copernicus.eu/api/v1/catalog/1.0.0/search';
export const PROCESS_URL = 'https://sh.dataspace.copernicus.eu/api/v1/process';

export interface Bbox {
  west: number;
  south: number;
  east: number;
  north: number;
}

export async function getClientToken(clientId: string, clientSecret: string): Promise<string> {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'client_credentials', client_id: clientId, client_secret: clientSecret }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`CDSE OAuth client login failed: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
  return ((await res.json()) as { access_token: string }).access_token;
}

export interface Scene {
  id: string;
  datetime: string;
  /** Scene cloud cover, percent. */
  cloud: number;
  /** Outer ring of the footprint, [lon, lat] pairs. */
  ring: [number, number][];
}

interface StacFeature {
  id: string;
  properties: { datetime: string; 'eo:cloud_cover'?: number };
  geometry: { type: 'Polygon' | 'MultiPolygon'; coordinates: number[][][] | number[][][][] };
}

export function scenesFromStac(features: StacFeature[]): Scene[] {
  const out: Scene[] = [];
  for (const f of features) {
    const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates as number[][][]] : (f.geometry.coordinates as number[][][][]);
    for (const p of polys) {
      out.push({
        id: f.id,
        datetime: f.properties.datetime,
        cloud: f.properties['eo:cloud_cover'] ?? 100,
        ring: p[0].map((c) => [c[0], c[1]] as [number, number]),
      });
    }
  }
  return out;
}

export async function searchScenes(token: string, bbox: Bbox, days: number, now: string): Promise<Scene[]> {
  const to = new Date(now);
  const from = new Date(to.getTime() - days * 86_400_000);
  const features: StacFeature[] = [];
  let body: Record<string, unknown> = {
    collections: ['sentinel-2-l2a'],
    bbox: [bbox.west, bbox.south, bbox.east, bbox.north],
    datetime: `${from.toISOString()}/${to.toISOString()}`,
    limit: 100,
    fields: { include: ['id', 'properties.datetime', 'properties.eo:cloud_cover', 'geometry'] },
  };
  for (let page = 0; page < 10; page++) {
    const res = await fetch(CATALOG_URL, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) throw new Error(`Sentinel Hub catalog: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
    const json = (await res.json()) as { features: StacFeature[]; context?: { next?: number } };
    features.push(...json.features);
    if (json.context?.next === undefined) break;
    body = { ...body, next: json.context.next };
  }
  return scenesFromStac(features);
}

function inRing(lon: number, lat: number, ring: [number, number][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export interface DayChoice {
  /** YYYY-MM-DD (UTC). */
  date: string;
  /** Share of the region inside the day's footprints, 0–1. */
  coverage: number;
  /** Expected share of the region seen clear: footprints weighted by (1 − cloud cover). */
  clearShare: number;
  scenes: string[];
}

/**
 * Scores each day by how much of the region it shows cloud-free (sample points inside footprints,
 * each weighted by its scene's clear fraction) and returns the newest day above `minClearShare`,
 * along with all scored days for logging.
 */
export function chooseDay(scenes: Scene[], bbox: Bbox, minClearShare = 0.45): { choice: DayChoice | null; days: DayChoice[] } {
  const byDay = new Map<string, Scene[]>();
  for (const s of scenes) {
    const d = s.datetime.slice(0, 10);
    byDay.set(d, [...(byDay.get(d) ?? []), s]);
  }
  const nx = 30;
  const ny = 20;
  const days: DayChoice[] = [];
  for (const [date, list] of byDay) {
    let covered = 0;
    let clear = 0;
    for (let i = 0; i < nx; i++) {
      for (let j = 0; j < ny; j++) {
        const lon = bbox.west + ((i + 0.5) / nx) * (bbox.east - bbox.west);
        const lat = bbox.south + ((j + 0.5) / ny) * (bbox.north - bbox.south);
        // Overlapping scenes: the least cloudy one counts.
        const hits = list.filter((s) => inRing(lon, lat, s.ring));
        if (!hits.length) continue;
        covered++;
        clear += 1 - Math.min(...hits.map((s) => s.cloud)) / 100;
      }
    }
    days.push({
      date,
      coverage: covered / (nx * ny),
      clearShare: clear / (nx * ny),
      scenes: [...new Set(list.map((s) => s.id))],
    });
  }
  days.sort((a, b) => b.date.localeCompare(a.date));
  return { choice: days.find((d) => d.clearShare >= minClearShare) ?? null, days };
}

/** True colour with a gentle gamma; clouds, cirrus, cloud shadows and no-data pixels transparent. */
export const EVALSCRIPT = `//VERSION=3
function setup() {
  return { input: [{ bands: ["B02", "B03", "B04", "SCL", "dataMask"] }], output: { bands: 4, sampleType: "UINT8" } };
}
// Scene classification: 3 cloud shadow, 8/9 cloud, 10 thin cirrus (11 is snow and stays visible).
const HIDE = [3, 8, 9, 10];
function tone(x) { return 255 * Math.min(1, Math.pow(Math.max(0, 2.2 * x), 0.85)); }
function evaluatePixel(s) {
  if (!s.dataMask || HIDE.indexOf(s.SCL) >= 0) return [0, 0, 0, 0];
  return [tone(s.B04), tone(s.B03), tone(s.B02), 255];
}`;

/** Process API request body for one day over a Web Mercator box, rendered to `size` × `size` px. */
export function processRequest(date: string, mercBox: [number, number, number, number], size: number) {
  return {
    input: {
      bounds: { bbox: mercBox, properties: { crs: 'http://www.opengis.net/def/crs/EPSG/0/3857' } },
      data: [
        {
          type: 'sentinel-2-l2a',
          dataFilter: { timeRange: { from: `${date}T00:00:00Z`, to: `${date}T23:59:59Z` }, mosaickingOrder: 'leastCC' },
          processing: { upsampling: 'BILINEAR', downsampling: 'BILINEAR' },
        },
      ],
    },
    output: { width: size, height: size, responses: [{ identifier: 'default', format: { type: 'image/png' } }] },
    evalscript: EVALSCRIPT,
  };
}

export async function renderChunk(token: string, date: string, mercBox: [number, number, number, number], size: number): Promise<ArrayBuffer> {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(PROCESS_URL, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', accept: 'image/png' },
      body: JSON.stringify(processRequest(date, mercBox, size)),
      signal: AbortSignal.timeout(180_000),
    });
    if (res.ok) return res.arrayBuffer();
    // Rate limiting: back off and retry a few times.
    if (res.status === 429 && attempt < 4) {
      await new Promise((r) => setTimeout(r, 5000 * 2 ** attempt));
      continue;
    }
    throw new Error(`Sentinel Hub process: HTTP ${res.status} ${(await res.text()).slice(0, 300)}`);
  }
}
