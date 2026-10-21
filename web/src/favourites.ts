// Favourite bivouacs (visited or planned), kept by OSM id in this browser's localStorage. The site
// has no server, so favourites stay on the device; when storage is blocked (private window, cleared
// site data) they still work until the page is closed.

const KEY = 'bivouac-favourites';

export class Favourites {
  private ids: Set<string>;
  private listeners: (() => void)[] = [];

  constructor(private storage: Pick<Storage, 'getItem' | 'setItem'> | null = defaultStorage()) {
    this.ids = new Set(this.read());
  }

  private read(): string[] {
    try {
      const list: unknown = JSON.parse(this.storage?.getItem(KEY) ?? '[]');
      return Array.isArray(list) ? list.filter((x): x is string => typeof x === 'string') : [];
    } catch {
      return [];
    }
  }

  has = (id: string): boolean => this.ids.has(id);

  get size(): number {
    return this.ids.size;
  }

  /** Adds or removes `id`; returns whether it is a favourite now. */
  toggle(id: string): boolean {
    const on = !this.ids.has(id);
    if (on) this.ids.add(id);
    else this.ids.delete(id);
    try {
      this.storage?.setItem(KEY, JSON.stringify([...this.ids]));
    } catch {
      // Storage full or blocked: keep the change for this visit.
    }
    for (const l of this.listeners) l();
    return on;
  }

  onChange(listener: () => void) {
    this.listeners.push(listener);
  }
}

function defaultStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}
