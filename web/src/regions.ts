// The avalanche warning region of a place (web/src/data/regions.json, from `npm run regions`): its
// name in the place panel's bulletin row, and a link to the service that publishes its bulletin.
// Only a link: the app never shows or judges danger levels.
import type { Position } from 'geojson';
import type { Region, RegionsFile } from '../../shared/types.ts';
import regionsUrl from './data/regions.json?url';

/** Simplified borders leave slivers between neighbours; a point this close to a region counts as in it (about 300 m). */
const NEAR_DEG = 0.003;

function inRing(lon: number, lat: number, ring: Position[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function distToRing(lon: number, lat: number, ring: Position[]): number {
  // Degrees of longitude are shorter here; scale them so the distance is roughly isotropic.
  const k = Math.cos((lat * Math.PI) / 180);
  let best = Infinity;
  for (let i = 1; i < ring.length; i++) {
    const ax = ring[i - 1][0] * k, ay = ring[i - 1][1];
    const bx = ring[i][0] * k, by = ring[i][1];
    const px = lon * k;
    const dx = bx - ax, dy = by - ay;
    const t = dx || dy ? Math.max(0, Math.min(1, ((px - ax) * dx + (lat - ay) * dy) / (dx * dx + dy * dy))) : 0;
    best = Math.min(best, Math.hypot(px - (ax + t * dx), lat - (ay + t * dy)));
  }
  return best;
}

const inPolygon = (lon: number, lat: number, rings: Position[][]) => inRing(lon, lat, rings[0]) && !rings.slice(1).some((h) => inRing(lon, lat, h));

/** The region containing the point; failing that, one whose border is within NEAR_DEG; else null. */
export function regionAt(file: RegionsFile, lon: number, lat: number): Region | null {
  const candidates = file.regions.filter(
    (r) => lon >= r.bbox[0] - NEAR_DEG && lon <= r.bbox[2] + NEAR_DEG && lat >= r.bbox[1] - NEAR_DEG && lat <= r.bbox[3] + NEAR_DEG,
  );
  const hit = candidates.find((r) => r.polygons.some((p) => inPolygon(lon, lat, p)));
  if (hit) return hit;
  let best: Region | null = null;
  let bestD = NEAR_DEG;
  for (const r of candidates)
    for (const p of r.polygons) {
      const d = distToRing(lon, lat, p[0]);
      if (d < bestD) [best, bestD] = [r, d];
    }
  return best;
}

export interface BulletinLink {
  href: string;
  /** Region name, local names and id, e.g. "Schnals Ridge (Schnalser Kamm / Cresta di Senales), IT-32-BZ-03". */
  region: string | null;
  /** Who publishes it, e.g. "avalanche.report", "SLF". */
  service: string;
}

/** Where to read the bulletin for a point; avalanche.report when the point is in no known region. */
export function bulletinLink(file: RegionsFile | null, lon: number, lat: number): BulletinLink {
  const r = file ? regionAt(file, lon, lat) : null;
  const s = r ? file!.services[r.service] : null;
  if (!r || !s) return { href: 'https://avalanche.report', region: null, service: 'avalanche.report' };
  return { href: s.url, region: `${r.name}${r.local ? ` (${r.local})` : ''}, ${r.id}`, service: s.name };
}

let loading: Promise<RegionsFile | null> | null = null;
/** The regions, fetched once (about 60 KB compressed); null if they cannot be loaded. */
export function loadRegions(): Promise<RegionsFile | null> {
  return (loading ??= fetch(regionsUrl)
    .then((res) => (res.ok ? (res.json() as Promise<RegionsFile>) : null))
    .catch(() => null));
}

/** Fills in the bulletin rows (`a[data-bulletin]`) under `root` once the regions are loaded. */
export function fillBulletins(root: ParentNode) {
  const rows = [...root.querySelectorAll<HTMLAnchorElement>('a[data-bulletin]')];
  if (!rows.length) return;
  void loadRegions().then((file) => {
    if (!file) return;
    for (const a of rows) {
      const link = bulletinLink(file, Number(a.dataset.lon), Number(a.dataset.lat));
      if (!link.region) continue;
      a.href = link.href;
      const sub = a.querySelector('.act-sub');
      if (sub) sub.textContent = `${link.region}, at ${link.service}`;
    }
  });
}
