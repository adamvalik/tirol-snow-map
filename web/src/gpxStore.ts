// The last GPX track, kept in this browser's IndexedDB so it survives a reload. The site has no
// server, so the track stays on the device. The file's text is kept rather than the parsed lines,
// so a later version of the parser reads old tracks too. Where storage is blocked (private window,
// cleared site data) the track still works until the page is closed.

export interface StoredTrack {
  /** The file name the user picked, for the panel. */
  fileName: string;
  text: string;
  /** ISO time it was added. */
  savedAt: string;
}

export interface TrackStore {
  load(): Promise<StoredTrack | null>;
  save(track: StoredTrack): Promise<void>;
  clear(): Promise<void>;
}

const DB = 'tirol-snow-map';
const STORE = 'gpx';
const KEY = 'last';

const done = <T>(req: IDBRequest<T>): Promise<T> =>
  new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB request failed'));
  });

const isStoredTrack = (v: unknown): v is StoredTrack =>
  typeof v === 'object' &&
  v !== null &&
  typeof (v as StoredTrack).fileName === 'string' &&
  typeof (v as StoredTrack).text === 'string' &&
  typeof (v as StoredTrack).savedAt === 'string';

/** A store in IndexedDB; every call resolves (with null on load) instead of failing when storage is blocked. */
export function indexedDbStore(factory: IDBFactory | null = defaultFactory()): TrackStore {
  let db: Promise<IDBDatabase | null> | null = null;
  const open = () =>
    (db ??= new Promise<IDBDatabase | null>((resolve) => {
      if (!factory) return resolve(null);
      try {
        const req = factory.open(DB, 1);
        req.onupgradeneeded = () => req.result.createObjectStore(STORE);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => resolve(null);
        // Another tab holds an older version open; carry on without storage.
        req.onblocked = () => resolve(null);
      } catch {
        resolve(null);
      }
    }));
  /** Runs one request; resolves with its result, or undefined when storage is unavailable. */
  const run = async (mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest): Promise<unknown> => {
    const d = await open();
    if (!d) return undefined;
    try {
      return await done(fn(d.transaction(STORE, mode).objectStore(STORE)));
    } catch (e) {
      // Quota full or storage cleared while open: keep the track for this visit only.
      console.warn('GPX storage:', e);
      return undefined;
    }
  };
  return {
    load: async () => {
      const v = await run('readonly', (s) => s.get(KEY));
      return isStoredTrack(v) ? v : null;
    },
    save: async (track) => {
      await run('readwrite', (s) => s.put(track, KEY));
    },
    clear: async () => {
      await run('readwrite', (s) => s.delete(KEY));
    },
  };
}

function defaultFactory(): IDBFactory | null {
  try {
    return window.indexedDB ?? null;
  } catch {
    return null;
  }
}
