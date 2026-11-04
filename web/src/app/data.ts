import { SCHEMA_VERSION } from '../../../shared/types.ts';

/** Where the pipeline's files are served. */
export const DATA = `${import.meta.env.BASE_URL}data/`;

/** A data file, or null when it is missing, unreadable or from another schema version. */
export async function loadJson<T extends { schemaVersion: number }>(name: string): Promise<T | null> {
  try {
    const res = await fetch(`${DATA}${name}`, { cache: 'no-cache' });
    if (!res.ok) return null;
    const f = (await res.json()) as T;
    return f.schemaVersion === SCHEMA_VERSION ? f : null;
  } catch {
    return null;
  }
}
