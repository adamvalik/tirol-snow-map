// Aerial lifts in 3D, built from fill-extrusion blocks like the bivouac cabins (cabins.ts): a
// station at each end, a pylon with a cross-arm at every mapped pylon (or evenly spaced where OSM
// maps none), two cables between the cross-arms, and the carriers hanging from them: cabins on
// gondolas and cable cars, chairs on chairlifts, both in turn on mixed lifts.
//
// A fill-extrusion stands on the terrain the map draws (exaggerated with "Terrain height"), and
// its base and height are metres above that ground. So the cables are cut into short pieces, and
// each piece's base is the straight line between the two cross-arms minus the drawn ground under
// it, read with `groundAt` (map.queryTerrainElevation). The cables then run straight between the
// pylons at any terrain height.

import type { Feature, Polygon } from 'geojson';
import { distanceM } from '../../shared/geo.ts';

/**
 * Sizes in metres. Pylons and cables are close to life; cabins and stations are drawn about twice
 * as large, so they show from a few hundred metres away (the bivouac cabins are 8 times life).
 */
export const LIFT_3D = {
  pylonHeight: 22,
  pylonWidth: 3.2,
  /** Distance of each cable from the line's centre. */
  track: 5,
  armThickness: 1.6,
  cableWidth: 1.1,
  cableThickness: 0.7,
  /** Longest straight piece of cable, and the most a piece may rise: steep spans get more, shorter pieces. */
  piece: 10,
  pieceRise: 0.5,
  /** Sag in the middle of a span, as a share of its length. */
  sag: 0.015,
  /** Lowest a cable may come to the drawn ground. */
  clearance: 3,
  station: { width: 20, length: 28, height: 10, cable: 9 },
  cabin: { size: 6, height: 5.5, hanger: 2.5, spacing: 120 },
  /**
   * Chairs, about 3.5 times life so they read as chairs from a few hundred metres: width per seat,
   * seat depth and thickness, hanger, backrest, bar thickness; closer together than cabins, as on a real lift.
   */
  chair: { seat: 1.9, depth: 2.8, thickness: 0.8, hanger: 6, back: 3.6, bar: 0.6, spacing: 55, defaultSeats: 4 },
  /** Pylons where none are mapped: spans of at most this length. */
  span: 220,
} as const;

export const LIFT_3D_COLORS = {
  pylon: '#868e96',
  arm: '#495057',
  cable: '#212529',
  station: '#dee2e6',
  roof: '#495057',
  cabin: '#d6336c',
  cabinRoof: '#343a40',
  chair: '#1c7ed6',
  hood: '#f59f00',
} as const;

export type Ground = (lon: number, lat: number) => number | null;
type Pos = readonly number[];
export type Block = Feature<Polygon, { id: string; base: number; height: number; color: string }>;

/** What hangs on the cable: from the OSM aerialway type, seats per chair and a weather hood. */
export interface Carriers {
  kind: 'cabin' | 'chair' | 'mixed';
  seats?: number | null;
  bubble?: boolean;
}

/** Chairs for chairlifts, both for mixed lifts, cabins for the rest. */
export const carriersFor = (lift: string | null, seats: number | null = null, bubble = false): Carriers => ({
  kind: lift === 'chair_lift' ? 'chair' : lift === 'mixed_lift' ? 'mixed' : 'cabin',
  seats,
  bubble,
});

/** Local metres east and north of `origin`, and back. */
function frame(origin: Pos) {
  const mPerLat = 110_540;
  const mPerLon = 111_320 * Math.cos((origin[1] * Math.PI) / 180);
  return {
    toXY: (p: Pos): [number, number] => [(p[0] - origin[0]) * mPerLon, (p[1] - origin[1]) * mPerLat],
    toLonLat: (x: number, y: number): [number, number] => [origin[0] + x / mPerLon, origin[1] + y / mPerLat],
  };
}

/** Supports along the line, bottom to top: the stations, the angle stations and the pylons. */
export function supports(line: readonly Pos[], pylons: readonly Pos[] | null): { at: [number, number]; d: number; station: boolean }[] {
  // Distance along the line of each vertex.
  const dist = [0];
  for (let i = 1; i < line.length; i++) dist.push(dist[i - 1] + distanceM(line[i - 1], line[i]));
  const length = dist.at(-1)!;
  const pointAt = (d: number): [number, number] => {
    let i = 1;
    while (i < line.length - 1 && dist[i] < d) i++;
    const t = (d - dist[i - 1]) / (dist[i] - dist[i - 1] || 1);
    return [line[i - 1][0] + (line[i][0] - line[i - 1][0]) * t, line[i - 1][1] + (line[i][1] - line[i - 1][1]) * t];
  };
  /** Distance along the line of the point nearest to `p` (pylons sit on the line in OSM). */
  const along = (p: Pos) => {
    const f = frame(p);
    let best = { d: 0, gap: Infinity };
    for (let i = 1; i < line.length; i++) {
      const [ax, ay] = f.toXY(line[i - 1]);
      const [bx, by] = f.toXY(line[i]);
      const len2 = (bx - ax) ** 2 + (by - ay) ** 2 || 1;
      const t = Math.min(1, Math.max(0, -(ax * (bx - ax) + ay * (by - ay)) / len2));
      const gap = Math.hypot(ax + (bx - ax) * t, ay + (by - ay) * t);
      if (gap < best.gap) best = { d: dist[i - 1] + (dist[i] - dist[i - 1]) * t, gap };
    }
    return best.d;
  };
  const out = [
    { at: [line[0][0], line[0][1]] as [number, number], d: 0, station: true },
    { at: [line.at(-1)![0], line.at(-1)![1]] as [number, number], d: length, station: true },
  ];
  // Angle stations: where the line bends.
  for (let i = 1; i < line.length - 1; i++) out.push({ at: [line[i][0], line[i][1]], d: dist[i], station: true });
  if (pylons?.length) {
    for (const p of pylons) out.push({ at: [p[0], p[1]], d: along(p), station: false });
  } else {
    const n = Math.ceil(length / LIFT_3D.span);
    for (let k = 1; k < n; k++) out.push({ at: pointAt((length * k) / n), d: (length * k) / n, station: false });
  }
  // A pylon at a station (OSM sometimes maps both) is left to the station; a pylon mapped twice is one.
  const stations = out.filter((s) => s.station);
  return out
    .filter((s) => s.station || stations.every((t) => Math.abs(t.d - s.d) > 10))
    .sort((a, b) => a.d - b.d)
    .filter((s, i, all) => i === 0 || s.station || all[i - 1].station || s.d - all[i - 1].d > 5);
}

/**
 * The blocks of one lift, or null while the ground under it is not known (terrain tiles still
 * loading). `line` is [lon, lat, ...] bottom to top.
 */
export function liftBlocks(
  id: string,
  line: readonly Pos[],
  pylons: readonly Pos[] | null,
  groundAt: Ground,
  carriers: Carriers = { kind: 'cabin' },
): Block[] | null {
  if (line.length < 2) return null;
  const s = LIFT_3D;
  const blocks: Block[] = [];
  const f = frame(line[0]);
  /** A box around a centre point, turned along `dir` (unit vector east, north): `len` along, `wid` across. */
  const box = (cx: number, cy: number, dir: [number, number], len: number, wid: number, base: number, height: number, color: string) => {
    const [ux, uy] = dir;
    const [vx, vy] = [-uy, ux];
    const corner = (a: number, b: number) => f.toLonLat(cx + ux * a + vx * b, cy + uy * a + vy * b);
    const ring = [corner(-len / 2, -wid / 2), corner(len / 2, -wid / 2), corner(len / 2, wid / 2), corner(-len / 2, wid / 2)];
    blocks.push({ type: 'Feature', geometry: { type: 'Polygon', coordinates: [[...ring, ring[0]]] }, properties: { id, base, height, color } });
  };

  const seats = Math.min(Math.max(carriers.seats ?? s.chair.defaultSeats, 1), 8);
  const chairWidth = seats * s.chair.seat;
  // Wide chairs need the cables further apart, so the chairs on the two cables pass each other.
  const track = carriers.kind === 'cabin' ? s.track : Math.max(s.track, chairWidth / 2 + 1.5);

  const sup = supports(line, pylons);
  const ground: number[] = [];
  for (const p of sup) {
    const g = groundAt(p.at[0], p.at[1]);
    if (g === null) return null;
    ground.push(g);
  }
  const xy = sup.map((p) => f.toXY(p.at));
  const unit = (dx: number, dy: number): [number, number] => {
    const l = Math.hypot(dx, dy) || 1;
    return [dx / l, dy / l];
  };
  // Direction at each support: along the span arriving, or leaving at the bottom.
  const dirAt = (i: number) => (i === 0 ? unit(xy[1][0] - xy[0][0], xy[1][1] - xy[0][1]) : unit(xy[i][0] - xy[i - 1][0], xy[i][1] - xy[i - 1][1]));
  /** Cable height above the drawn ground at a support, in metres of the drawn map. */
  const top = sup.map((p, i) => ground[i] + (p.station ? s.station.cable : s.pylonHeight));

  sup.forEach((p, i) => {
    const [x, y] = xy[i];
    const dir = dirAt(i);
    if (p.station) {
      box(x, y, dir, s.station.length, s.station.width, 0, s.station.height, LIFT_3D_COLORS.station);
      box(x, y, dir, s.station.length + 1.5, s.station.width + 1.5, s.station.height, s.station.height + 1.2, LIFT_3D_COLORS.roof);
    } else {
      box(x, y, dir, s.pylonWidth, s.pylonWidth, 0, s.pylonHeight, LIFT_3D_COLORS.pylon);
      box(x, y, dir, s.armThickness * 1.5, track * 2 + 2, s.pylonHeight - s.armThickness, s.pylonHeight, LIFT_3D_COLORS.arm);
    }
  });

  /** A cabin hanging from the cable at `cable` metres above the ground. */
  const cabin = (cx: number, cy: number, dir: [number, number], cable: number) => {
    const bottom = cable - s.cabin.hanger - s.cabin.height;
    if (bottom < 0.5) return;
    box(cx, cy, dir, 0.4, 0.4, cable - s.cabin.hanger, cable, LIFT_3D_COLORS.arm);
    box(cx, cy, dir, s.cabin.size, s.cabin.size, bottom, cable - s.cabin.hanger - 0.6, LIFT_3D_COLORS.cabin);
    box(cx, cy, dir, s.cabin.size + 0.3, s.cabin.size + 0.3, cable - s.cabin.hanger - 0.6, cable - s.cabin.hanger, LIFT_3D_COLORS.cabinRoof);
  };
  /**
   * A chair: a hanger, a bar across, the seat, and the backrest behind the riders, who face
   * `travel` (up on one track, down on the other). A weather hood where OSM maps one.
   */
  const chair = (cx: number, cy: number, travel: [number, number], cable: number) => {
    const c = s.chair;
    const seatBase = cable - c.hanger - c.bar;
    if (seatBase < 0.5) return;
    const at = (shift: number): [number, number] => [cx + travel[0] * shift, cy + travel[1] * shift];
    box(cx, cy, travel, c.bar, c.bar, seatBase + c.thickness, cable, LIFT_3D_COLORS.arm);
    box(cx, cy, travel, c.bar, chairWidth, seatBase + c.thickness, seatBase + c.thickness + c.bar, LIFT_3D_COLORS.arm);
    box(...at(0.3), travel, c.depth, chairWidth, seatBase, seatBase + c.thickness, LIFT_3D_COLORS.chair);
    box(...at(-c.depth / 2), travel, c.bar, chairWidth, seatBase, seatBase + c.back, LIFT_3D_COLORS.chair);
    if (carriers.bubble) box(...at(-0.3), travel, c.depth + 1, chairWidth + 0.6, seatBase + c.back, seatBase + c.back + c.bar, LIFT_3D_COLORS.hood);
  };
  const spacing = carriers.kind === 'chair' ? s.chair.spacing : carriers.kind === 'mixed' ? s.cabin.spacing / 2 : s.cabin.spacing;

  // Cables in short pieces, with carriers every so often on each track (staggered between the two).
  for (let i = 1; i < sup.length; i++) {
    const [ax, ay] = xy[i - 1];
    const [bx, by] = xy[i];
    const span = Math.hypot(bx - ax, by - ay);
    if (span < 1) continue;
    const dir = unit(bx - ax, by - ay);
    const across: [number, number] = [-dir[1], dir[0]];
    // Each piece is flat, so it is as thick as the cable rises over it: the pieces then join into
    // one line instead of a staircase.
    const n = Math.max(1, Math.round(span / s.piece), Math.ceil(Math.abs(top[i] - top[i - 1]) / s.pieceRise));
    const rise = Math.abs(top[i] - top[i - 1]) / n;
    for (let k = 0; k < n; k++) {
      const t = (k + 0.5) / n;
      const [cx, cy] = [ax + (bx - ax) * t, ay + (by - ay) * t];
      const [lon, lat] = f.toLonLat(cx, cy);
      const g = groundAt(lon, lat);
      if (g === null) return null;
      const cable = top[i - 1] + (top[i] - top[i - 1]) * t - 4 * s.sag * span * t * (1 - t);
      const base = Math.max(s.clearance, cable - g - rise / 2);
      for (const side of [-1, 1]) {
        const ox = cx + across[0] * track * side;
        const oy = cy + across[1] * track * side;
        box(ox, oy, dir, span / n + 0.3, s.cableWidth, base, base + s.cableThickness + rise, LIFT_3D_COLORS.cable);
      }
    }
    // Carriers, placed by distance from the bottom station so spacing runs on across pylons. The
    // track on the left of the line goes up, the other comes down.
    const d0 = sup[i - 1].d;
    const d1 = sup[i].d;
    for (const side of [-1, 1]) {
      const phase = side === 1 ? 0 : spacing / 2;
      const travel: [number, number] = side === 1 ? dir : [-dir[0], -dir[1]];
      for (let d = Math.ceil((d0 - phase) / spacing) * spacing + phase; d < d1; d += spacing) {
        const t = (d - d0) / (d1 - d0);
        // Keep clear of the stations and pylons.
        if (t * span < 15 || (1 - t) * span < 15) continue;
        const [cx, cy] = [ax + (bx - ax) * t + across[0] * track * side, ay + (by - ay) * t + across[1] * track * side];
        const [lon, lat] = f.toLonLat(cx, cy);
        const g = groundAt(lon, lat);
        if (g === null) return null;
        const cable = Math.max(s.clearance, top[i - 1] + (top[i] - top[i - 1]) * t - 4 * s.sag * span * t * (1 - t) - g);
        // A mixed lift alternates: a cabin, then chairs, by its place on the cable.
        const isChair = carriers.kind === 'chair' || (carriers.kind === 'mixed' && Math.round((d - phase) / spacing) % 2 === 1);
        if (isChair) chair(cx, cy, travel, cable);
        else cabin(cx, cy, dir, cable);
      }
    }
  }
  return blocks;
}
