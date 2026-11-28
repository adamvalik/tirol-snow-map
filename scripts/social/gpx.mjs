// GPX tracks for the tour reels (track, overnight): reading a file, and the geometry along it as
// shared/geo.ts does it (metres on a sphere, a point every few metres, climb with 5 m hysteresis).

import { readFile } from 'node:fs/promises';
import path from 'node:path';

/**
 * The points of a GPX file as [lon, lat, ele, time] (ele NaN without heights, time in ms, NaN
 * without times), with the track's name and <type>. Nothing else of the file is read.
 */
export async function readGpx(file) {
  const { DOMParser } = await import('@xmldom/xmldom');
  const doc = new DOMParser().parseFromString(await readFile(path.resolve(file), 'utf8'), 'application/xml');
  const tags = (root, name) => Array.from(root.getElementsByTagName('*')).filter((e) => e.localName === name);
  const childText = (el, name) => Array.from(el.childNodes).find((n) => n.localName === name)?.textContent?.trim() || null;
  const pts = tags(doc, 'trkpt').length ? tags(doc, 'trkpt') : tags(doc, 'rtept');
  const raw = pts
    .map((p) => {
      const time = childText(p, 'time');
      return [Number(p.getAttribute('lon')), Number(p.getAttribute('lat')), Number(childText(p, 'ele') ?? NaN), time ? Date.parse(time) : NaN];
    })
    .filter(([lon, lat]) => Number.isFinite(lon) && Number.isFinite(lat));
  if (raw.length < 2) throw new Error(`${path.basename(file)} has no track to fly along`);
  const trk = tags(doc, 'trk')[0];
  return {
    raw,
    hasEle: raw.every((p) => Number.isFinite(p[2])),
    hasTime: raw.every((p) => Number.isFinite(p[3])),
    name: trk ? childText(trk, 'name') : null,
    type: (trk ? childText(trk, 'type') : null) ?? '',
  };
}

export const RAD = Math.PI / 180;
export const dist = (a, b) => 6371008.8 * Math.hypot((b[0] - a[0]) * RAD * Math.cos(((a[1] + b[1]) / 2) * RAD), (b[1] - a[1]) * RAD);
/** Metres from the start at each point. */
export const along = (line) => line.reduce((acc, p, i) => (acc.push(i ? acc[i - 1] + dist(line[i - 1], p) : 0), acc), []);

/** A point every `step` metres, every value of a point interpolated (height, time). */
export const resample = (line, step) => {
  const cum = along(line);
  const out = [];
  let k = 0;
  for (let d = 0; d < cum.at(-1); d += step) {
    while (cum[k + 1] < d) k++;
    const t = (d - cum[k]) / (cum[k + 1] - cum[k] || 1);
    out.push(line[k].map((v, j) => v + (line[k + 1][j] - v) * t));
  }
  out.push(line.at(-1).slice());
  return out;
};

/** Metres climbed, with 5 m hysteresis so GPS noise does not add up. */
export const climb = (eles) => {
  let [up, ref, dir] = [0, eles[0], 0];
  for (const e of eles.slice(1)) {
    if (dir >= 0 && e > ref && (dir === 1 || e - ref >= 5)) [up, ref, dir] = [up + e - ref, e, 1];
    else if (dir <= 0 && e < ref && (dir === -1 || ref - e >= 5)) [ref, dir] = [e, -1];
    else if (dir === 1 && ref - e >= 5) [ref, dir] = [e, -1];
    else if (dir === -1 && e - ref >= 5) [up, ref, dir] = [up + e - ref, e, 1];
  }
  return up;
};

/** Degrees clockwise from north, from a to b. */
export const bearing = (a, b) => {
  const dLon = (b[0] - a[0]) * RAD;
  const y = Math.sin(dLon) * Math.cos(b[1] * RAD);
  const x = Math.cos(a[1] * RAD) * Math.sin(b[1] * RAD) - Math.sin(a[1] * RAD) * Math.cos(b[1] * RAD) * Math.cos(dLon);
  return Math.atan2(y, x) / RAD;
};

/** Box average of value j over ±k points. */
export const smooth = (P, k, j) => P.map((_, i) => {
  let [sum, n] = [0, 0];
  for (let m = Math.max(0, i - k); m <= Math.min(P.length - 1, i + k); m++) [sum, n] = [sum + P[m][j], n + 1];
  return sum / n;
});

/** arr (evenly spaced over 0..L) at s. */
export const at = (arr, s, L) => {
  const x = Math.max(0, Math.min(arr.length - 1, (s / L) * (arr.length - 1)));
  const i = Math.min(arr.length - 2, Math.floor(x));
  return arr[i] + (arr[i + 1] - arr[i]) * (x - i);
};

/** Hike, Ski tour, Trail run, Bike ride or Tour, from a file's <type>. */
export const kindOf = (type) => (/ski|backcountry/i.test(type) ? 'Ski tour' : /hik|walk|trek/i.test(type) ? 'Hike' : /run/i.test(type) ? 'Trail run' : /bik|cycl/i.test(type) ? 'Bike ride' : 'Tour');
