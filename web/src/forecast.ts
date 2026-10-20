// Point forecast straight from Open-Meteo (CORS-enabled, CC BY 4.0), cached for an hour.

const API = 'https://api.open-meteo.com/v1/forecast';
const TTL_MS = 60 * 60 * 1000;
const TIMEOUT_MS = 15_000;
const CACHE_PREFIX = 'om1:';

export interface Forecast {
  fetchedAt: string;
  /** Elevation Open-Meteo downscaled the forecast to, in metres. */
  elevation: number;
  current: {
    time: string;
    temperature_2m: number;
    weather_code: number;
    wind_speed_10m: number;
    wind_direction_10m: number;
    precipitation: number;
    snowfall: number;
  };
  daily: {
    time: string[];
    weather_code: number[];
    temperature_2m_max: number[];
    temperature_2m_min: number[];
    precipitation_sum: number[];
    snowfall_sum: number[];
    wind_speed_10m_max: number[];
  };
}

export function forecastUrl(lat: number, lon: number, elevation: number | null): string {
  const p = new URLSearchParams({
    latitude: lat.toFixed(4),
    longitude: lon.toFixed(4),
    current: 'temperature_2m,weather_code,wind_speed_10m,wind_direction_10m,precipitation,snowfall',
    daily: 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,snowfall_sum,wind_speed_10m_max',
    timezone: 'Europe/Rome',
    forecast_days: '7',
  });
  // Without this Open-Meteo uses its own 90 m DEM, which flattens peaks; the map's terrain is far sharper.
  if (elevation !== null) p.set('elevation', Math.round(elevation).toString());
  return `${API}?${p}`;
}

/** Cache key rounds to ~100 m and 10 m of height, so nearby clicks share one request. */
const cacheKey = (lat: number, lon: number, elevation: number | null) =>
  `${CACHE_PREFIX}${lat.toFixed(3)},${lon.toFixed(3)},${elevation === null ? 'x' : Math.round(elevation / 10)}`;

const memory = new Map<string, Forecast>();

function readCache(key: string): Forecast | null {
  let f = memory.get(key) ?? null;
  if (!f) {
    try {
      const raw = localStorage.getItem(key);
      f = raw ? (JSON.parse(raw) as Forecast) : null;
    } catch {
      f = null;
    }
  }
  return f && Date.now() - Date.parse(f.fetchedAt) < TTL_MS ? f : null;
}

function writeCache(key: string, f: Forecast) {
  memory.set(key, f);
  try {
    // Drop expired entries so storage does not grow without bound.
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (!k?.startsWith(CACHE_PREFIX)) continue;
      const v = JSON.parse(localStorage.getItem(k) ?? 'null') as Forecast | null;
      if (!v || Date.now() - Date.parse(v.fetchedAt) >= TTL_MS) localStorage.removeItem(k);
    }
    localStorage.setItem(key, JSON.stringify(f));
  } catch {
    // Storage unavailable (private mode, quota): the in-memory cache still works for this visit.
  }
}

export async function getForecast(
  lat: number,
  lon: number,
  elevation: number | null,
  signal?: AbortSignal,
): Promise<Forecast> {
  const key = cacheKey(lat, lon, elevation);
  const cached = readCache(key);
  if (cached) return cached;
  const timeout = AbortSignal.timeout(TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(forecastUrl(lat, lon, elevation), { signal: signal ? AbortSignal.any([signal, timeout]) : timeout });
  } catch (e) {
    if (timeout.aborted && !signal?.aborted) throw new Error('Open-Meteo did not answer in time. Try again in a moment.');
    throw e;
  }
  if (!res.ok) {
    let reason = `HTTP ${res.status}`;
    try {
      reason = ((await res.json()) as { reason?: string }).reason ?? reason;
    } catch {
      /* keep status text */
    }
    throw new Error(reason);
  }
  const body = (await res.json()) as Omit<Forecast, 'fetchedAt'>;
  const f: Forecast = { fetchedAt: new Date().toISOString(), elevation: body.elevation, current: body.current, daily: body.daily };
  writeCache(key, f);
  return f;
}
