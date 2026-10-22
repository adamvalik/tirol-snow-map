// "Sun here" in a clicked point's panel: the skyline seen from the point with the sun's path for
// the chosen day over it, and when the sun really appears and goes behind the mountains.

import { type Horizon, horizonAt, SUN_RADIUS, type SunWindow, sunWindows } from '../../shared/horizon.ts';
import { compass, escapeHtml, TZ } from './format.ts';
import { clockTime, dayMinutes, localMidnight, type SunDay, sunDay, type SunPosition } from './sun.ts';

export interface SunHere {
  lon: number;
  lat: number;
  horizon: Horizon;
  sunAt: SunAt;
  date: string;
  /** Local midnight at the start and end of the day. */
  start: number;
  end: number;
  windows: SunWindow[];
  /** Sunrise and sunset over a flat horizon, for comparison. */
  flat: SunDay;
}

export type SunAt = (t: number) => SunPosition;

/** Visible sun on a local day for a horizon already traced from the point. */
export function sunHereFor(lon: number, lat: number, horizon: Horizon, date: string, sunAt: SunAt): SunHere {
  const start = localMidnight(date);
  const end = start + dayMinutes(date) * 60_000;
  return { lon, lat, horizon, sunAt, date, start, end, windows: sunWindows(horizon, sunAt, start, end), flat: sunDay(date, lat, lon) };
}

const clearance = (h: Horizon, s: SunPosition) => s.altitude + SUN_RADIUS - horizonAt(h, s.azimuth);

function duration(ms: number): string {
  const minutes = Math.round(ms / 60_000);
  const h = Math.floor(minutes / 60);
  return h ? `${h} h ${String(minutes % 60).padStart(2, '0')} min` : `${minutes} min`;
}

/** "over a ridge in the SE, 3.2 km away" for the skyline towards an azimuth. */
function skyline(h: Horizon, azimuth: number, preposition: string): string {
  const i = Math.round((((azimuth % 360) + 360) % 360) / h.stepDeg) % h.angles.length;
  const d = h.distances[i];
  const angle = horizonAt(h, azimuth);
  const where = `in the ${compass(azimuth)}`;
  if (Number.isNaN(d) || angle < 0.5) return `${where}, over an open horizon`;
  const km = d < 1000 ? `${Math.round(d / 10) * 10} m` : `${(d / 1000).toFixed(d < 10_000 ? 1 : 0)} km`;
  return `${preposition} a ridge ${where}, ${Math.round(angle)}° high, ${km} away`;
}

// --- Chart ------------------------------------------------------------------------

const W = 328;
const H = 150;
const PAD = { left: 26, right: 6, top: 8, bottom: 18 };

/**
 * The skyline from north through east, south and west back to north, with the sun's path for the
 * day: solid where the sun is above the skyline, dashed where it is hidden, and a marker at `now`.
 */
export function horizonChartSvg(s: SunHere, now: number): string {
  const { horizon: h, sunAt } = s;
  // Sun every 10 minutes while it is above -6°.
  const path: { t: number; p: SunPosition }[] = [];
  for (let t = s.start; t <= s.end; t += 10 * 60_000) {
    const p = sunAt(t);
    if (p.altitude > -6) path.push({ t, p });
  }
  const maxSun = Math.max(0, ...path.map((q) => q.p.altitude));
  const maxSky = Math.max(...h.angles);
  const minSky = Math.min(...h.angles);
  const yMax = Math.min(90, Math.ceil((Math.max(maxSun, maxSky) + 4) / 10) * 10);
  const yMin = Math.max(-10, Math.floor(Math.min(-2, minSky - 1)));
  const x = (az: number) => PAD.left + (az / 360) * (W - PAD.left - PAD.right);
  const y = (alt: number) => PAD.top + ((yMax - Math.max(yMin, alt)) / (yMax - yMin)) * (H - PAD.top - PAD.bottom);
  const f = (v: number) => v.toFixed(1);

  const n = h.angles.length;
  const sky = Array.from({ length: n + 1 }, (_, i) => `${f(x(i * h.stepDeg))},${f(y(h.angles[i % n]))}`);
  const ground = `M${f(x(0))},${f(y(yMin))} L${sky.join(' L')} L${f(x(360))},${f(y(yMin))} Z`;

  // Split the path into runs, breaking where it is hidden or wraps past north.
  const segments: { visible: boolean; pts: string[] }[] = [];
  let prev: { p: SunPosition } | null = null;
  for (const q of path) {
    const visible = clearance(h, q.p) > 0;
    const last = segments.at(-1);
    const point = `${f(x(q.p.azimuth))},${f(y(q.p.altitude))}`;
    if (last && prev && last.visible === visible && Math.abs(q.p.azimuth - prev.p.azimuth) < 90) last.pts.push(point);
    else {
      // Start the new run where the last ended, so the line has no gaps.
      const join = last && prev && Math.abs(q.p.azimuth - prev.p.azimuth) < 90 ? [last.pts.at(-1)!] : [];
      segments.push({ visible, pts: [...join, point] });
    }
    prev = q;
  }
  const lines = segments
    .filter((seg) => seg.pts.length > 1)
    .map((seg) => `<polyline class="${seg.visible ? 'sun-path' : 'sun-path hidden'}" points="${seg.pts.join(' ')}"/>`)
    .join('');

  // Full hours along the path.
  const hours = path
    .filter((q) => new Date(q.t).getUTCMinutes() === 0 && q.p.altitude > yMin)
    .map((q) => {
      const label = new Date(q.t).toLocaleTimeString('en-GB', { timeZone: TZ, hour: 'numeric' });
      return `<circle class="sun-hour" cx="${f(x(q.p.azimuth))}" cy="${f(y(q.p.altitude))}" r="1.8"/><text class="sun-hour-label" x="${f(x(q.p.azimuth))}" y="${f(y(q.p.altitude) - 5)}">${Number(label)}</text>`;
    })
    .join('');

  const yTicks: string[] = [];
  for (let a = Math.ceil(yMin / 10) * 10; a <= yMax; a += 10) {
    yTicks.push(`<line class="grid${a === 0 ? ' zero' : ''}" x1="${PAD.left}" x2="${W - PAD.right}" y1="${f(y(a))}" y2="${f(y(a))}"/><text class="axis" x="${PAD.left - 4}" y="${f(y(a) + 3)}" text-anchor="end">${a}°</text>`);
  }
  const xTicks = ['N', 'E', 'S', 'W', 'N']
    .map((label, i) => `<text class="axis" x="${f(x(i * 90))}" y="${H - 5}" text-anchor="middle">${label}</text>`)
    .join('');

  let marker = '';
  const p = sunAt(now);
  if (now >= s.start && now < s.end && p.altitude > yMin) {
    const visible = clearance(h, p) > 0;
    marker = `<circle class="sun-now${visible ? '' : ' hidden'}" cx="${f(x(p.azimuth))}" cy="${f(y(p.altitude))}" r="5"><title>${clockTime(now)}</title></circle>`;
  }

  const label = `Skyline seen from this point and the sun's path on ${s.date}`;
  return `<svg class="horizon-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${escapeHtml(label)}">
    ${yTicks.join('')}
    <path class="skyline" d="${ground}"/>
    ${lines}${hours}${marker}${xTicks}
  </svg>`;
}

// --- Panel section -------------------------------------------------------------------

export function sunHereHtml(s: SunHere, now: number): string {
  const { sunAt } = s;
  const dateLabel = new Date(s.start + 12 * 3_600_000).toLocaleDateString('en-GB', { timeZone: TZ, weekday: 'short', day: 'numeric', month: 'short' });
  const flat = (t: number | null) => (t === null ? '' : ` <span class="muted">(flat horizon ${clockTime(t)})</span>`);
  let rows: string;
  if (!s.windows.length) {
    rows = `<dt>Direct sun</dt><dd>None on this day: the sun stays behind the mountains.</dd>`;
  } else {
    const first = s.windows[0];
    const last = s.windows.at(-1)!;
    const total = s.windows.reduce((sum, w) => sum + w.end - w.start, 0);
    const firstAz = sunAt(first.start).azimuth;
    const lastAz = sunAt(last.end).azimuth;
    rows = `
      <dt>First sun</dt><dd><strong>${clockTime(first.start)}</strong>${flat(s.flat.sunrise)}<br>
        <span class="muted">${escapeHtml(skyline(s.horizon, firstAz, 'over'))}</span></dd>
      <dt>Last sun</dt><dd><strong>${clockTime(last.end)}</strong>${flat(s.flat.sunset)}<br>
        <span class="muted">${escapeHtml(skyline(s.horizon, lastAz, 'behind'))}</span></dd>
      <dt>Sunshine</dt><dd>${duration(total)}</dd>`;
    if (s.windows.length > 1) {
      const gaps = s.windows.slice(1).map((w, i) => `${clockTime(s.windows[i].end)}–${clockTime(w.start)}`);
      rows += `<dt>Hidden</dt><dd>${gaps.join(', ')}</dd>`;
    }
  }
  return `
    <h3>Sun here <span class="chip">${escapeHtml(dateLabel)}</span></h3>
    <dl class="kv">${rows}</dl>
    ${horizonChartSvg(s, now)}
    <p class="muted">Clear sky, terrain only: trees, buildings and cloud are not included. Ridges within 5 km from
    ~26 m terrain, further out from a 250 m grid, so small rocks and the last few metres of a summit are missed.</p>`;
}
