// Diagnostic: downloads recent snow cover products and prints their GeoTIFF metadata and the
// pixel codes found over the model grid, to check the coding against the product manual.
// Needs CDSE_USERNAME / CDSE_PASSWORD. Run: npx tsx pipeline/src/snow/inspect-cover.ts [days]

import { fromArrayBuffer } from 'geotiff';
import { MODEL_GRID } from '../../../shared/grid.ts';
import { decodeToGrid, downloadProduct, extractTiff, getToken, pickProducts, searchUrl } from '../sources/snowCover.ts';

const days = Number(process.argv[2] ?? 3);
const token = await getToken(process.env.CDSE_USERNAME!, process.env.CDSE_PASSWORD!);
const catalogue = await (await fetch(searchUrl(40))).json();
// pickProducts keeps one product per day; inspect both sensors instead.
const all = (catalogue.value as { Id: string; Name: string }[])
  .filter((v) => v.Name.endsWith('_cog'))
  .slice(0, days * 2);
console.log(`newest per day: ${pickProducts(catalogue).slice(0, days).map((p) => `${p.date} ${p.sensor}`).join(', ')}`);

for (const v of all) {
  const { tiff } = extractTiff(await downloadProduct(v.Id, token));
  const img = await (await fromArrayBuffer(tiff)).getImage();
  const grid = await decodeToGrid(tiff, MODEL_GRID);
  const codes = Object.entries(grid.rawCodes)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([c, n]) => `${c}:${n}`)
    .join(' ');
  console.log(`\n${v.Name}`);
  console.log(`  size ${img.getWidth()}×${img.getHeight()}, bands ${img.getSamplesPerPixel()}, bbox ${img.getBoundingBox().map((x) => x.toFixed(3)).join(',')}, res ${img.getResolution().map((x) => x.toFixed(5)).join(',')}`);
  console.log(`  nodata ${img.getGDALNoData()}, GDAL metadata ${JSON.stringify(img.getGDALMetadata(0))}`);
  const fd = img.getFileDirectory() as unknown as Record<string, unknown>;
  const desc = fd.ImageDescription ?? fd.GDAL_METADATA;
  if (desc) console.log(`  description ${String(desc).slice(0, 600)}`);
  console.log(`  region codes: ${codes}`);
}
