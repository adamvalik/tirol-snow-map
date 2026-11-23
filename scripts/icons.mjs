// Renders the home screen and favicon PNGs from web/public/icons/icon.svg, and the square avatar for the
// social accounts into docs/design/logo/. Run after editing the SVG:
//   node scripts/icons.mjs
import sharp from 'sharp';

const dir = new URL('../web/public/icons/', import.meta.url);
const svg = new URL('icon.svg', dir).pathname;

// The artwork is full-bleed, and the mark stays inside the central circle of 80% of the width
// (radius 196 of 205 at 512), so one image serves iOS (which rounds the corners itself), Android's
// maskable icon shapes and the round avatars of Instagram, TikTok and YouTube.
const outputs = [
  { file: 'apple-touch-icon.png', size: 180 },
  { file: 'icon-192.png', size: 192 },
  { file: 'icon-512.png', size: 512 },
  { file: 'favicon-32.png', size: 32 },
  { file: '../../../docs/design/logo/cima-avatar-1080.png', size: 1080 },
];

for (const { file, size } of outputs) {
  await sharp(svg, { density: Math.max(300, (72 * size) / 512) }).resize(size, size).png().toFile(new URL(file, dir).pathname);
  console.log(file);
}
