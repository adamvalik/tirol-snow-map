// Overpass API requests for the static OpenStreetMap lists (bivouacs, via ferratas).
// OVERPASS_URL picks one Overpass instance; by default the main one and a mirror are tried in turn.

const URLS = process.env.OVERPASS_URL
  ? [process.env.OVERPASS_URL]
  : ['https://overpass-api.de/api/interpreter', 'https://maps.mail.ru/osm/tools/overpass/api/interpreter'];
/** overpass-api.de answers 406 to requests without an identifying User-Agent. */
const HEADERS = { 'User-Agent': 'tirol-snow-map (github.com/adamvalik/tirol-snow-map)', Accept: 'application/json' };

/** Runs `query`; `tag` prefixes the progress messages. Throws when no instance answers with elements. */
export async function fetchOverpass(query: string, tag: string): Promise<unknown> {
  const errors: string[] = [];
  // Busy instances answer 429 or 504; a few rounds with a pause usually get through.
  for (let round = 0; round < 3; round++) {
    for (const url of URLS) {
      try {
        const res = await fetch(url, { method: 'POST', headers: HEADERS, body: new URLSearchParams({ data: query }) });
        if (!res.ok) {
          errors.push(`${url}: HTTP ${res.status}`);
        } else {
          // A busy instance can answer 200 with no elements and a `remark` saying why.
          const json = (await res.json()) as { elements?: unknown[]; remark?: string };
          if (json.elements?.length) return json;
          errors.push(`${url}: no elements${json.remark ? ` (${json.remark})` : ''}`);
        }
      } catch (e) {
        errors.push(`${url}: ${e instanceof Error ? e.message : String(e)}`);
      }
      console.warn(`[${tag}] ${errors.at(-1)}, trying again`);
    }
    await new Promise((r) => setTimeout(r, 15_000 * (round + 1)));
  }
  throw new Error(`Overpass unavailable:\n${errors.join('\n')}`);
}
