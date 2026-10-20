import type { Station } from '../../../shared/types.ts';
import type { ModelStation } from './model.ts';

/** Stations usable by the snow model: those with a snow depth reading (already cleaned by the parsers). */
export function toModelStations(stations: Station[]): ModelStation[] {
  return stations
    .filter((s) => s.snowDepthCm !== null)
    .map((s) => ({ id: s.id, lon: s.lon, lat: s.lat, elevation: s.elevation, depthCm: s.snowDepthCm! }));
}
