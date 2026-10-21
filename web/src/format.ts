const TZ = 'Europe/Rome';

export function formatTime(iso: string | null | undefined): string {
  if (!iso) return 'unknown';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'unknown';
  return d.toLocaleString('en-GB', {
    timeZone: TZ,
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** "09:21" for a time today (Europe/Rome), otherwise like formatTime. */
export function formatTimeShort(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return 'unknown';
  const day = (t: number) => new Date(t).toLocaleDateString('en-GB', { timeZone: TZ });
  const t = Date.parse(iso);
  if (Number.isNaN(t) || day(t) !== day(now)) return formatTime(iso);
  return new Date(t).toLocaleTimeString('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit' });
}

/** "12 min ago", "3 h ago", "2 days ago". */
export function formatAge(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return '';
  const minutes = Math.round((now - Date.parse(iso)) / 60_000);
  if (Number.isNaN(minutes)) return '';
  if (minutes < 1) return 'just now';
  if (minutes < 90) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} h ago`;
  return `${Math.round(hours / 24)} days ago`;
}

export const ageHours = (iso: string | null | undefined, now = Date.now()): number =>
  iso ? (now - Date.parse(iso)) / 3_600_000 : Infinity;

export function fmt(v: number | null | undefined, unit: string, digits = 0): string {
  if (v === null || v === undefined || Number.isNaN(v)) return '–';
  return `${v.toFixed(digits)} ${unit}`;
}

const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
export const compass = (deg: number | null): string =>
  deg === null ? '' : COMPASS[Math.round((((deg % 360) + 360) % 360) / 45) % 8];

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

/** WMO weather interpretation codes used by Open-Meteo. */
const WMO: Record<number, string> = {
  0: 'Clear',
  1: 'Mostly clear',
  2: 'Partly cloudy',
  3: 'Overcast',
  45: 'Fog',
  48: 'Rime fog',
  51: 'Light drizzle',
  53: 'Drizzle',
  55: 'Heavy drizzle',
  56: 'Freezing drizzle',
  57: 'Freezing drizzle',
  61: 'Light rain',
  63: 'Rain',
  65: 'Heavy rain',
  66: 'Freezing rain',
  67: 'Freezing rain',
  71: 'Light snow',
  73: 'Snow',
  75: 'Heavy snow',
  77: 'Snow grains',
  80: 'Light showers',
  81: 'Showers',
  82: 'Heavy showers',
  85: 'Snow showers',
  86: 'Heavy snow showers',
  95: 'Thunderstorm',
  96: 'Thunderstorm, hail',
  99: 'Thunderstorm, hail',
};
export const weatherText = (code: number | null | undefined): string =>
  code === null || code === undefined ? '–' : (WMO[code] ?? `Code ${code}`);
