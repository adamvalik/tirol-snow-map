// Small 3D cabins for the bivouacs, built from fill-extrusion blocks: a stepped half-barrel for the
// metal boxes, a gabled hut for the wooden ones, each with a door on its front end. A real bivouac
// is about 3 m long, a pixel even at the closest zoom, so the cabins are drawn SCALE times larger.

import type { Feature, FeatureCollection, Polygon } from 'geojson';

export const CABIN_SCALE = 8;
/** Real size in metres: width across the barrel, length along it, height. */
const SIZE = { width: 2.6, length: 3.4, height: 2.4 };
/** Slices across the width; more make a rounder barrel and a smoother roof. */
const SLICES = 9;

export const CABIN_COLORS = {
  metal: '#e04a26',
  wood: '#a8703c',
  roof: '#6b3d1d',
  metalDoor: '#fbefe4',
  woodDoor: '#4a2a12',
} as const;

export interface CabinSite {
  lat: number;
  lon: number;
  kind: 'metal' | 'wood';
  osm: string;
}

/** Same turn for the same bivouac on every load, but not all facing one way. */
export function cabinBearing(osm: string): number {
  let h = 0;
  for (const c of osm) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return h % 360;
}

type Block = { x0: number; x1: number; y0: number; y1: number; base: number; height: number; color: string };

/** Blocks in metres around the cabin's centre: x across, y along (front at -y), already scaled. */
export function cabinBlocks(kind: CabinSite['kind']): Block[] {
  const w = (SIZE.width * CABIN_SCALE) / 2;
  const l = (SIZE.length * CABIN_SCALE) / 2;
  const h = SIZE.height * CABIN_SCALE;
  const blocks: Block[] = [];
  const slice = (i: number, half: number) => {
    const x0 = -half + (2 * half * i) / SLICES;
    const x1 = -half + (2 * half * (i + 1)) / SLICES;
    return { x0, x1, mid: Math.abs((x0 + x1) / 2) / half };
  };
  if (kind === 'metal') {
    // Half-barrel on low walls: each slice as high as the arc over its middle.
    for (let i = 0; i < SLICES; i++) {
      const { x0, x1, mid } = slice(i, w);
      const height = h * (0.3 + 0.7 * Math.sqrt(Math.max(0, 1 - mid * mid)));
      blocks.push({ x0, x1, y0: -l, y1: l, base: 0, height, color: CABIN_COLORS.metal });
    }
  } else {
    // Walls, then a gabled roof with eaves that overhang them a little.
    const eaves = h * 0.55;
    blocks.push({ x0: -w, x1: w, y0: -l, y1: l, base: 0, height: eaves, color: CABIN_COLORS.wood });
    const roofHalf = w * 1.15;
    for (let i = 0; i < SLICES; i++) {
      const { x0, x1, mid } = slice(i, roofHalf);
      const height = eaves + (h - eaves) * (1 - mid);
      blocks.push({ x0, x1, y0: -l * 1.08, y1: l * 1.08, base: eaves * 0.92, height, color: CABIN_COLORS.roof });
    }
  }
  // The door stands slightly proud of the front so it shows from outside.
  const door = w * 0.32;
  blocks.push({
    x0: -door,
    x1: door,
    y0: -l - 0.15 * CABIN_SCALE,
    y1: -l + 0.05 * CABIN_SCALE,
    base: 0,
    height: h * 0.55,
    color: kind === 'metal' ? CABIN_COLORS.metalDoor : CABIN_COLORS.woodDoor,
  });
  return blocks;
}

/** One polygon per block, turned to the cabin's bearing and placed at its site. */
export function cabinGeoJson(sites: CabinSite[]): FeatureCollection<Polygon> {
  const features: Feature<Polygon>[] = [];
  sites.forEach((site, index) => {
    const rad = (cabinBearing(site.osm) * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    const mPerLat = 110_540;
    const mPerLon = 111_320 * Math.cos((site.lat * Math.PI) / 180);
    const at = (x: number, y: number): [number, number] => {
      // Bearing clockwise from north: y points along it, x to its right.
      const east = x * cos + y * sin;
      const north = -x * sin + y * cos;
      return [site.lon + east / mPerLon, site.lat + north / mPerLat];
    };
    for (const b of cabinBlocks(site.kind)) {
      features.push({
        type: 'Feature',
        geometry: {
          type: 'Polygon',
          coordinates: [[at(b.x0, b.y0), at(b.x1, b.y0), at(b.x1, b.y1), at(b.x0, b.y1), at(b.x0, b.y0)]],
        },
        properties: { index, base: b.base, height: b.height, color: b.color },
      });
    }
  });
  return { type: 'FeatureCollection', features };
}
