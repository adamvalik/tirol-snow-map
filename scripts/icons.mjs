// Renders the home screen and favicon PNGs from web/public/icons/icon.svg. Run after editing the SVG:
//   node scripts/icons.mjs
import sharp from 'sharp';

const dir = new URL('../web/public/icons/', import.meta.url);
const svg = new URL('icon.svg', dir).pathname;

// The artwork is full-bleed with the peaks inside the central 80% circle, so one image serves both
// iOS (which rounds the corners itself) and Android's maskable icon shapes.
const outputs = [
  { file: 'apple-touch-icon.png', size: 180 },
  { file: 'icon-192.png', size: 192 },
  { file: 'icon-512.png', size: 512 },
  { file: 'favicon-32.png', size: 32 },
];

for (const { file, size } of outputs) {
  await sharp(svg, { density: 300 }).resize(size, size).png().toFile(new URL(file, dir).pathname);
  console.log(file);
}
