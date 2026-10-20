/** Stations are kept inside South Tyrol plus a ~30 km buffer, so neighbouring valleys inform the edges. */
export const STATION_BBOX = { west: 10.0, south: 45.95, east: 12.9, north: 47.4 } as const;

export const URLS = {
  provinceStations: 'https://geoservices.buergernetz.bz.it/services/meteo/v1/stations',
  provinceSensors: 'https://geoservices.buergernetz.bz.it/services/meteo/v1/sensors',
  linea: 'https://static.avalanche.report/eaws_weather_stations/linea.geojson',
} as const;

/** Fixture files that stand in for each URL in `--fixtures` mode (paths relative to the repo root). */
export const FIXTURES: Record<keyof typeof URLS, string> = {
  provinceStations: 'fixtures/province-bz/v1-stations.geojson',
  provinceSensors: 'fixtures/province-bz/v1-sensors-all.json',
  linea: 'fixtures/euregio/linea-stations-bbox.geojson',
};

/** Snow readings between this and 0 cm are sensor noise on bare ground and are clamped to 0. */
export const SNOW_NOISE_FLOOR_CM = -5;
/** Readings above this are treated as sensor errors. */
export const SNOW_MAX_CM = 500;
