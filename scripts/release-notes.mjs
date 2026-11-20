// The Releases table of docs/release-plan.md, read the same way by scripts/release.mjs (GitHub
// Release notes, CI check) and vite.config.ts (the app's What's new card).
//
// The "What" column of a row is a comma-separated list; commas inside brackets do not split, so
// "GPX tracks (load, measure, draw, keep)" stays one item.

/** The table row of a tag ("v0.2.2"), or undefined. */
export function row(md, tag) {
  return md.split('\n').find((l) => l.startsWith(`| \`${tag}\` |`));
}

/** The items of a "What" text. */
export function items(what) {
  const out = [];
  let depth = 0;
  let cur = '';
  for (const ch of what) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ',' && depth === 0) {
      out.push(cur.trim());
      cur = '';
    } else cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out.filter(Boolean);
}

/** The notes of a tag as a list, each starting with a capital; empty when the tag has no row. */
export function releaseNotes(md, tag) {
  const r = row(md, tag);
  return r ? items(r.split('|')[3].trim()).map((i) => `${i[0].toUpperCase()}${i.slice(1)}`) : [];
}
