// The data age: how old the stations, the satellite view and the forecast are, in the sidebar and
// in the phone's name pill. Amber when a source is stale. Tapping it opens About.

export type AgeKey = 'stations' | 'satellite' | 'forecast';

const NAMES: Record<AgeKey, string> = { stations: 'Stations', satellite: 'Satellite', forecast: 'Forecast' };

interface Age {
  /** An ISO time (a reading, a fetch) or a YYYY-MM-DD day (a satellite pass). */
  at: string | null;
  stale: boolean;
  /** Shown when there is no time: "off", "none". */
  missing?: string;
}

const ages = new Map<AgeKey, Age>();

/** "12 min", "5 h", "3 days" for a time; "today", "1 day", "4 days" for a day. */
export function shortAge(at: string, now = Date.now()): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(at)) {
    const days = Math.max(0, Math.floor((now - Date.parse(`${at}T12:00:00Z`)) / 86_400_000 + 0.5));
    return days === 0 ? 'today' : days === 1 ? '1 day' : `${days} days`;
  }
  const minutes = Math.max(0, Math.round((now - Date.parse(at)) / 60_000));
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} h`;
  return `${Math.round(hours / 24)} days`;
}

function render() {
  const words: string[] = [];
  for (const key of Object.keys(NAMES) as AgeKey[]) {
    const a = ages.get(key);
    const text = a?.at ? shortAge(a.at) : (a?.missing ?? '–');
    for (const el of document.querySelectorAll<HTMLElement>(`[data-age="${key}"]`)) {
      el.classList.toggle('stale', !!a?.stale);
      el.querySelector('.age-value')!.textContent = text;
      el.title = a?.stale ? `${NAMES[key]}: out of date` : '';
    }
    words.push(`${NAMES[key]} ${text}${a?.stale ? ', out of date' : ''}`);
  }
  const label = `Data age: ${words.join(', ')}. Open About the data`;
  document.getElementById('data-age')?.setAttribute('aria-label', label);
  document.getElementById('brand-pill')?.setAttribute('aria-label', `South Tyrol Snow. ${label}`);
}

/** Sets one source's age. */
export function setAge(key: AgeKey, at: string | null, stale = false, missing?: string) {
  ages.set(key, { at, stale, missing });
  render();
}

// The ages grow while the page stays open.
window.setInterval(render, 60_000);
