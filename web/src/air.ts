// The fog and inversion note of the Place tab: from the latest station readings around the point
// (shared/inversion.ts). Shown only when the readings are recent and the stations show a layer.
import { airLayers, type FogLayer, type Inversion, type ProfileStation, RADIUS_M } from '../../shared/inversion.ts';
import { formatTimeShort } from './format.ts';
import { noteCardHtml } from './placeHtml.ts';

/** Fog forms and lifts within hours: older readings are not shown. */
export const MAX_AGE_HOURS = 6;

const round100 = (m: number) => Math.round(m / 100) * 100;
const ceil100 = (m: number) => Math.ceil(m / 100) * 100;
const metres = (m: number) => `${m.toLocaleString('en-GB')} m`;

export function airNoteHtml(r: FogLayer | Inversion | null, now = Date.now()): string {
  if (!r || now - Date.parse(r.observedAt) > MAX_AGE_HOURS * 3_600_000) return '';
  const from = `Stations within ${RADIUS_M / 1000} km, read at ${formatTimeShort(r.observedAt, now)}.`;
  if (r.kind === 'fog') {
    const clear = metres(Math.max(ceil100(r.clearFromM), round100(r.cloudTopM) + 100));
    const above =
      r.sunAbove > 0
        ? `Sun from about ${clear}${r.warmerC ? `, ${r.warmerC} °C warmer` : ''}.`
        : `Drier air from about ${clear}, but no sun measured up there.`;
    return noteCardHtml('cloud', `Fog or low cloud up to about ${metres(round100(r.cloudTopM))}`, `${above} ${from}`);
  }
  return noteCardHtml(
    'thermometer-simple',
    `Inversion: ${r.warmerC} °C warmer at about ${metres(round100(r.topM))}`,
    `Than in the valley at about ${metres(round100(r.valleyM))}. ${from}`,
  );
}

/** The note for a point, from the latest stations (not a slider day's). */
export const pointAirHtml = (stations: readonly ProfileStation[] | null, lon: number, lat: number, now = Date.now()): string =>
  stations ? airNoteHtml(airLayers(stations, lon, lat), now) : '';
