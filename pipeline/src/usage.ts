// Upstream quotas: what this run used of the free Sentinel Hub (CDSE) and Open-Meteo allowances,
// counted where the requests are made, and the month's running totals kept in status.json. The
// workflow monitor opens an issue when a total nears its limit (scripts/monitor.mjs).
//
// Only production runs add up: the check workflow (snow-check.yml) starts from a copy of
// production's data and its counts are thrown away with it, so the totals here are a lower bound.

import type { StatusFile, UpstreamUsage } from '../../shared/types.ts';

/**
 * Free monthly allowances. CDSE, "Copernicus General" account: 10,000 processing units and 10,000
 * requests a month, reset on the 1st (UTC). Open-Meteo, non-commercial: 10,000 calls a day and
 * 300,000 a month, where every location of a multi-location request counts as one call.
 */
export const LIMITS = {
  sentinelHubProcessingUnits: 10_000,
  sentinelHubRequests: 10_000,
  openMeteoCallsPerDay: 10_000,
  openMeteoCallsPerMonth: 300_000,
} as const;

/** Sentinel Hub reports the processing units a request cost in this response header. */
export const PU_HEADER = 'x-processingunits-spent';

/** Counts of this run, filled in by the request code. */
export const runUsage = { sentinelHubRequests: 0, sentinelHubProcessingUnits: 0, openMeteoCalls: 0 };

/** One Sentinel Hub API answer (Process or Catalog). Rate-limit refusals cost nothing and are not counted. */
export function countSentinelHub(res: Response): void {
  if (res.status === 429) return;
  runUsage.sentinelHubRequests++;
  const pu = Number(res.headers.get(PU_HEADER));
  if (Number.isFinite(pu) && pu > 0) runUsage.sentinelHubProcessingUnits += pu;
}

/** An Open-Meteo request for `locations` points; each counts as one call. */
export function countOpenMeteo(locations: number): void {
  runUsage.openMeteoCalls += locations;
}

/** This month's totals: the previous run's plus this run's, starting again in a new month (or day, for the daily count). */
export function addUsage(previous: StatusFile['usage'] | undefined, run: typeof runUsage, now: string): UpstreamUsage {
  const month = now.slice(0, 7);
  const day = now.slice(0, 10);
  const prev = previous?.month === month ? previous : undefined;
  const r1 = (x: number) => Math.round(x * 10) / 10;
  return {
    month,
    sentinelHub: {
      requests: (prev?.sentinelHub.requests ?? 0) + run.sentinelHubRequests,
      processingUnits: r1((prev?.sentinelHub.processingUnits ?? 0) + run.sentinelHubProcessingUnits),
      limitRequests: LIMITS.sentinelHubRequests,
      limitProcessingUnits: LIMITS.sentinelHubProcessingUnits,
    },
    openMeteo: {
      calls: (prev?.openMeteo.calls ?? 0) + run.openMeteoCalls,
      limitMonth: LIMITS.openMeteoCallsPerMonth,
      day,
      callsToday: (prev?.openMeteo.day === day ? prev.openMeteo.callsToday : 0) + run.openMeteoCalls,
      limitDay: LIMITS.openMeteoCallsPerDay,
    },
    lastRun: { ...run, sentinelHubProcessingUnits: r1(run.sentinelHubProcessingUnits) },
  };
}

/** The largest share of any limit used so far (0–1), with the name of that limit. */
export function tightestLimit(u: UpstreamUsage): { name: string; share: number } {
  const all = [
    { name: 'Sentinel Hub processing units this month', share: u.sentinelHub.processingUnits / u.sentinelHub.limitProcessingUnits },
    { name: 'Sentinel Hub requests this month', share: u.sentinelHub.requests / u.sentinelHub.limitRequests },
    { name: 'Open-Meteo calls this month', share: u.openMeteo.calls / u.openMeteo.limitMonth },
    { name: 'Open-Meteo calls today', share: u.openMeteo.callsToday / u.openMeteo.limitDay },
  ];
  return all.reduce((a, b) => (b.share > a.share ? b : a));
}
