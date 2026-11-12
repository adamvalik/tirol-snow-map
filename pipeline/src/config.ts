/** Stations are kept inside South Tyrol plus a ~30 km buffer, so neighbouring valleys inform the edges. */
export const STATION_BBOX = { west: 10.0, south: 45.95, east: 12.9, north: 47.4 } as const;

export const URLS = {
  provinceStations: 'https://geoservices.buergernetz.bz.it/services/meteo/v1/stations',
  provinceSensors: 'https://geoservices.buergernetz.bz.it/services/meteo/v1/sensors',
} as const;

/**
 * Euregio station feeds in the "linea" format, as avalanche.report loads them (one file per data
 * provider since November 2026; the old combined eaws_weather_stations/linea.geojson stopped
 * updating on 5 Nov 2026). Only providers with stations inside STATION_BBOX are listed. The
 * first one carries most stations and must work; the others are extras near the edges.
 */
export const LINEA_FEEDS: readonly { provider: string; url: string }[] = [
  { provider: 'ALBINA', url: 'https://static.avalanche.report/weather_stations/linea.geojson.gz' },
  { provider: 'IT-32-BZ', url: 'https://test-api-weather.services.siag.it/api/v2/station/data/geojson/stations.geojson' },
  { provider: 'AT-07-GEOSPHERE', url: 'https://lawinen.at/smet/tir/stations_tir.geojson' },
  { provider: 'AT-08', url: 'https://lawinen.at/smet/vor/stations_vor.geojson' },
  { provider: 'AT-05', url: 'https://lawinen.at/smet/sbg/stations_sbg.geojson' },
  { provider: 'OEBB', url: 'https://oebb.infra.tbbm.at/smet/linea.geojson' },
  { provider: 'AT-02', url: 'https://smet.hydrographie.info/stations_ktn_destiny.geojson' },
  { provider: 'AT-02-GEOSPHERE', url: 'https://lawinen.at/smet/ktn/stations_ktn.geojson' },
  { provider: 'DE-BY', url: 'https://lawinen.at/smet/bay/stations_bay.geojson' },
  { provider: 'IT-36', url: 'https://smet.hydrographie.info/stations_fvg_destiny.geojson' },
];

/** Fixture files that stand in for each URL in `--fixtures` mode (paths relative to the repo root). */
export const FIXTURES: Record<keyof typeof URLS | 'linea', string> = {
  provinceStations: 'fixtures/province-bz/v1-stations.geojson',
  provinceSensors: 'fixtures/province-bz/v1-sensors-all.json',
  linea: 'fixtures/euregio/linea-stations-bbox.geojson',
};

/** Snow readings between this and 0 cm are sensor noise on bare ground and are clamped to 0. */
export const SNOW_NOISE_FLOOR_CM = -5;
/** Readings above this are treated as sensor errors. */
export const SNOW_MAX_CM = 500;
