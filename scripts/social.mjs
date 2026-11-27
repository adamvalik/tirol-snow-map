// Instagram posts rendered from the live map (docs/social.md). Not part of the app.
//
//   node scripts/social.mjs <post> [--site https://cimamap.com/] [--out social/posts/<date>-<post>] [--quick]
//
// One file per post in scripts/social/posts/, named after it (storm.mjs is `storm`); what it
// makes and its options are at the top of the file. What the posts share is in
// scripts/social/core.mjs. A new post is a new file there: this script finds it by its name, and
// with no post or an unknown one it lists them all.
//
// Opens the site in Chromium, captures the bare map canvas the way scripts/share-mockups.mjs
// does (map resized to the export size / 2, pixel ratio 2, read in the `render` event), and
// frames it with HTML in the app's font. Feed pictures are 4:5 (1080 × 1350): the Instagram API
// takes 4:5 to 1.91:1 only, and the frame keeps its text out of the strips the 3:4 profile grid
// cuts off. The reel needs ffmpeg on the PATH.
//
// Env: CHROMIUM_PATH, HTTPS_PROXY as for scripts/smoke.mjs.

import { mkdir, readdir } from 'node:fs/promises';
import path from 'node:path';
import { arg, start, stop, today } from './social/core.mjs';

// Each post file exports `usage` (its name and options), `run({ outDir })`, and if it needs them
// `needs` (options it cannot do without) and `variant()` (a suffix for the default folder).
const dir = new URL('./social/posts/', import.meta.url);
const load = (name) => import(new URL(`${name}.mjs`, dir).href);
const names = (await readdir(dir)).filter((f) => f.endsWith('.mjs')).map((f) => f.slice(0, -4)).sort();

const POST = process.argv[2];
if (!names.includes(POST)) {
  const posts = await Promise.all(names.map(load));
  console.error(['usage: node scripts/social.mjs <post> [--site URL] [--out DIR] [--quick]', ...posts.map((p) => `  ${p.usage}`)].join('\n'));
  process.exit(2);
}
const post = await load(POST);
if (post.needs?.some((name) => !arg(name))) {
  console.error(`usage: node scripts/social.mjs ${post.usage}`);
  process.exit(2);
}
const outDir = path.resolve(arg('out', `social/posts/${today}-${POST}${post.variant?.() ?? ''}`));
await mkdir(outDir, { recursive: true });

await start();
await post.run({ outDir });
await stop();
