// Snow detection from Sentinel-2 L2A, via the Sentinel Hub Process API on Copernicus Data Space
// (same OAuth client as the satellite picture). One request per pass day returns a class per pixel
// on the fine grid; the pipeline combines the days into a "last clear view" snow map.
//
// Classification (per pixel, Sentinel Hub reflectances 0–1):
// - snow: NDSI = (B03 − B11) / (B03 + B11) > 0.4 on bright ground (B08 > 0.11, B03 > 0.1), the
//   standard Sentinel-2 snow test; in terrain or cloud shadow (SCL 2/3) the brightness gate drops
//   to B03 > 0.03 so shaded north faces still count; or the scene classification says snow (SCL 11)
// - cloud: SCL 8/9/10, unless the pixel looks like snow and not like a cloud (clouds reflect
//   strongly in SWIR B11, snow does not); bright snow fields are often mislabelled as cloud
// - water (SCL 6) and everything else with data: bare

import sharp from 'sharp';
import { type GridSpec, mercY } from '../../../shared/grid.ts';
import { PROCESS_URL } from './sentinel2.ts';

export const S2_NODATA = 0;
export const S2_CLOUD = 1;
export const S2_BARE = 2;
export const S2_SNOW = 3;

export const SNOW_EVALSCRIPT = `//VERSION=3
function setup() {
  return { input: [{ bands: ["B03", "B08", "B11", "SCL", "dataMask"] }], output: { bands: 1, sampleType: "UINT8" } };
}
function evaluatePixel(s) {
  if (!s.dataMask || s.SCL === 0) return [0];
  var ndsi = (s.B03 - s.B11) / (s.B03 + s.B11 + 1e-6);
  var cloud = s.SCL === 8 || s.SCL === 9 || s.SCL === 10;
  if (cloud && !(ndsi > 0.6 && s.B11 < 0.12)) return [1];
  if (s.SCL === 6) return [2];
  var bright = s.B08 > 0.11 && s.B03 > 0.1;
  var shaded = (s.SCL === 2 || s.SCL === 3) && s.B03 > 0.03;
  if (s.SCL === 11 || (ndsi > 0.4 && (bright || shaded))) return [3];
  return [2];
}`;

const R = 6378137;
const mercX = (lon: number) => (R * lon * Math.PI) / 180;

/** The fine grid in Web Mercator, cut into column chunks of at most `maxPx` (Process API limit 2500). */
export function snowChunks(grid: GridSpec, maxPx = 2500): { box: [number, number, number, number]; x0: number; width: number }[] {
  if (grid.height > maxPx) throw new Error('fine grid too tall for one request row');
  const n = Math.ceil(grid.width / maxPx);
  const x = (col: number) => mercX(grid.west + (col / grid.width) * (grid.east - grid.west));
  const out = [];
  for (let i = 0; i < n; i++) {
    const x0 = Math.round((i * grid.width) / n);
    const x1 = Math.round(((i + 1) * grid.width) / n);
    out.push({ box: [x(x0), mercY(grid.south), x(x1), mercY(grid.north)] as [number, number, number, number], x0, width: x1 - x0 });
  }
  return out;
}

export function snowRequest(date: string, box: [number, number, number, number], width: number, height: number) {
  return {
    input: {
      bounds: { bbox: box, properties: { crs: 'http://www.opengis.net/def/crs/EPSG/0/3857' } },
      data: [
        {
          type: 'sentinel-2-l2a',
          dataFilter: { timeRange: { from: `${date}T00:00:00Z`, to: `${date}T23:59:59Z` }, mosaickingOrder: 'leastCC' },
          processing: { upsampling: 'NEAREST', downsampling: 'NEAREST' },
        },
      ],
    },
    output: { width, height, responses: [{ identifier: 'default', format: { type: 'image/png' } }] },
    evalscript: SNOW_EVALSCRIPT,
  };
}

/** Classes for one pass day on the fine grid (row-major, row 0 north). */
export async function classifyDay(token: string, date: string, grid: GridSpec): Promise<Uint8Array> {
  const out = new Uint8Array(grid.width * grid.height);
  for (const c of snowChunks(grid)) {
    const png = await post(token, snowRequest(date, c.box, c.width, grid.height));
    const { data, info } = await sharp(Buffer.from(png)).extractChannel(0).raw().toBuffer({ resolveWithObject: true });
    if (info.width !== c.width || info.height !== grid.height) throw new Error(`snow chunk ${info.width}×${info.height}, expected ${c.width}×${grid.height}`);
    for (let row = 0; row < grid.height; row++) out.set(data.subarray(row * c.width, (row + 1) * c.width), row * grid.width + c.x0);
  }
  return out;
}

async function post(token: string, body: unknown): Promise<ArrayBuffer> {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(PROCESS_URL, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', accept: 'image/png' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(180_000),
    });
    if (res.ok) return res.arrayBuffer();
    if (res.status === 429 && attempt < 4) {
      await new Promise((r) => setTimeout(r, 5000 * 2 ** attempt));
      continue;
    }
    throw new Error(`Sentinel Hub process (snow): HTTP ${res.status} ${(await res.text()).slice(0, 300)}`);
  }
}
