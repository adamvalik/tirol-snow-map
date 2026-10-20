// Copernicus Snow Cover Extent, Europe, 500 m, daily (CLMS sce_europe_500m_daily_v1).
// Search is open; download needs a Copernicus Data Space (CDSE) account, read from the
// CDSE_USERNAME / CDSE_PASSWORD environment variables (GitHub repository secrets in CI).
//
// Pixel codes (product user manual, table 4.2): 100–200 snow fraction = code − 100 (%),
// 30 cloud, 20/21/22 sea/lake/river, 251 polar night, 254 input error, 255 no data, 0 outside.

import { unzipSync } from 'fflate';
import { fromArrayBuffer } from 'geotiff';
import { cellCenter, type GridSpec } from '../../../shared/grid.ts';
import { COVER_CLOUD, COVER_NODATA } from '../snow/model.ts';

const CATALOGUE = 'https://catalogue.dataspace.copernicus.eu/odata/v1/Products';
const TOKEN_URL = 'https://identity.dataspace.copernicus.eu/auth/realms/CDSE/protocol/openid-connect/token';
const DOWNLOAD = 'https://download.dataspace.copernicus.eu/odata/v1/Products';
const DATASET = 'sce_europe_500m_daily_v1';

export interface SceProduct {
  id: string;
  name: string;
  /** Observation day, YYYY-MM-DD. */
  date: string;
  sensor: 'VIIRS' | 'MODIS';
  /** When the product was published in the catalogue (ISO 8601). */
  published: string;
}

/** Parses e.g. c_gls_SCE500_202610190000_CEURO_VIIRS_V1.0.1_cog. */
export function parseProductName(name: string): { date: string; sensor: 'VIIRS' | 'MODIS'; format: string } | null {
  const m = /^c_gls_SCE500_(\d{4})(\d{2})(\d{2})\d{4}_CEURO_(VIIRS|MODIS)_V[\d.]+_(\w+)$/.exec(name);
  return m ? { date: `${m[1]}-${m[2]}-${m[3]}`, sensor: m[4] as 'VIIRS' | 'MODIS', format: m[5] } : null;
}

export function searchUrl(top = 40): string {
  const filter =
    `Collection/Name eq 'CLMS' and Attributes/OData.CSC.StringAttribute/any(att:att/Name eq 'datasetIdentifier' ` +
    `and att/OData.CSC.StringAttribute/Value eq '${DATASET}')`;
  const p = new URLSearchParams({ $filter: filter, $orderby: 'ContentDate/Start desc', $top: String(top) });
  return `${CATALOGUE}?${p}`;
}

/**
 * Newest products first, COG only, one per day. VIIRS is preferred: MODIS flies on Terra,
 * which is at the end of its life.
 */
export function pickProducts(catalogue: { value: { Id: string; Name: string; PublicationDate?: string }[] }): SceProduct[] {
  const byDate = new Map<string, SceProduct>();
  for (const v of catalogue.value) {
    const p = parseProductName(v.Name);
    if (!p || p.format !== 'cog') continue;
    const existing = byDate.get(p.date);
    if (existing && existing.sensor === 'VIIRS') continue;
    byDate.set(p.date, { id: v.Id, name: v.Name, date: p.date, sensor: p.sensor, published: v.PublicationDate ?? '' });
  }
  return [...byDate.values()].sort((a, b) => b.date.localeCompare(a.date));
}

export async function searchProducts(): Promise<SceProduct[]> {
  const res = await fetch(searchUrl(), { signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`CDSE catalogue: HTTP ${res.status}`);
  return pickProducts(await res.json());
}

export async function getToken(username: string, password: string): Promise<string> {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'password', client_id: 'cdse-public', username, password }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) {
    // Never echo the credentials; the error body names the problem (e.g. invalid_grant).
    const body = await res.text().catch(() => '');
    throw new Error(`CDSE login failed: HTTP ${res.status} ${body.slice(0, 200)}`);
  }
  return ((await res.json()) as { access_token: string }).access_token;
}

/** Downloads a product. Redirects are followed by hand so the bearer token is kept across hosts. */
export async function downloadProduct(id: string, token: string): Promise<ArrayBuffer> {
  let url = `${DOWNLOAD}(${id})/$value`;
  for (let hop = 0; hop < 5; hop++) {
    const res = await fetch(url, {
      headers: { authorization: `Bearer ${token}` },
      redirect: 'manual',
      signal: AbortSignal.timeout(180_000),
    });
    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
      url = new URL(res.headers.get('location')!, url).href;
      continue;
    }
    if (!res.ok) throw new Error(`CDSE download ${id}: HTTP ${res.status}`);
    return res.arrayBuffer();
  }
  throw new Error(`CDSE download ${id}: too many redirects`);
}

const isTiff = (b: Uint8Array) =>
  (b[0] === 0x49 && b[1] === 0x49 && (b[2] === 42 || b[2] === 43)) || (b[0] === 0x4d && b[1] === 0x4d && (b[3] === 42 || b[3] === 43));

/**
 * The download is either the GeoTIFF itself or a ZIP around it (possibly with extra layers such
 * as quality flags). Returns the snow cover TIFF and a note on what was found, for the logs.
 */
export function extractTiff(download: ArrayBuffer): { tiff: ArrayBuffer; note: string } {
  const bytes = new Uint8Array(download);
  if (isTiff(bytes)) return { tiff: download, note: 'plain GeoTIFF' };
  if (bytes[0] === 0x50 && bytes[1] === 0x4b) {
    const files = unzipSync(bytes, { filter: (f) => /\.tiff?$/i.test(f.name) });
    const names = Object.keys(files);
    if (names.length === 0) throw new Error('ZIP download contains no .tif file');
    // Prefer the snow cover layer itself over side layers (quality flags, observation counts).
    const pick =
      names.find((n) => /SCE/i.test(n.split('/').pop()!) && !/QFLAG|QA|NOBS|AGE|UNC/i.test(n.split('/').pop()!)) ??
      names.sort((a, b) => files[b].length - files[a].length)[0];
    const f = files[pick];
    return { tiff: f.buffer.slice(f.byteOffset, f.byteOffset + f.byteLength) as ArrayBuffer, note: `ZIP, using ${pick} of [${names.join(', ')}]` };
  }
  const head = [...bytes.slice(0, 16)].map((b) => b.toString(16).padStart(2, '0')).join(' ');
  const text = new TextDecoder().decode(bytes.slice(0, 200)).replace(/[^\x20-\x7e]/g, '.');
  throw new Error(`Download is neither GeoTIFF nor ZIP (${bytes.length} bytes; starts ${head}; "${text}")`);
}

/** Maps a raw product code to the model's cover value. */
export function decodeCode(code: number): number {
  if (code >= 100 && code <= 200) return code - 100;
  if (code === 30) return COVER_CLOUD;
  return COVER_NODATA;
}

export interface CoverGrid {
  /** Per model cell: 0–100 snow percent, COVER_CLOUD or COVER_NODATA. */
  values: Uint8Array;
  stats: { snow: number; bare: number; cloud: number; nodata: number };
  /** Raw code counts inside the region, to check the file still follows the manual. */
  rawCodes: Record<number, number>;
  bands: number;
}

/** Reads the product's first band around the grid and samples it at each cell centre. */
export async function decodeToGrid(tiff: ArrayBuffer, grid: GridSpec): Promise<CoverGrid> {
  const image = await (await fromArrayBuffer(tiff)).getImage();
  const [minX, , , maxY] = image.getBoundingBox();
  const [resX, resY] = image.getResolution(); // resY is negative for north-up images
  const px = (lon: number) => Math.floor((lon - minX) / resX);
  const py = (lat: number) => Math.floor((lat - maxY) / resY);
  const win = [
    Math.max(0, px(grid.west) - 1),
    Math.max(0, py(grid.north) - 1),
    Math.min(image.getWidth(), px(grid.east) + 2),
    Math.min(image.getHeight(), py(grid.south) + 2),
  ];
  const [band] = (await image.readRasters({ window: win, samples: [0] })) as unknown as ArrayLike<number>[];
  const winWidth = win[2] - win[0];

  const values = new Uint8Array(grid.width * grid.height);
  const stats = { snow: 0, bare: 0, cloud: 0, nodata: 0 };
  const rawCodes: Record<number, number> = {};
  for (let row = 0; row < grid.height; row++) {
    for (let col = 0; col < grid.width; col++) {
      const { lon, lat } = cellCenter(grid, col, row);
      const x = px(lon) - win[0];
      const y = py(lat) - win[1];
      const code = x >= 0 && y >= 0 && x < winWidth ? band[y * winWidth + x] : 255;
      rawCodes[code] = (rawCodes[code] ?? 0) + 1;
      const v = decodeCode(code);
      values[row * grid.width + col] = v;
      if (v === COVER_CLOUD) stats.cloud++;
      else if (v === COVER_NODATA) stats.nodata++;
      else if (v >= 15) stats.snow++;
      else stats.bare++;
    }
  }
  return { values, stats, rawCodes, bands: image.getSamplesPerPixel() };
}
