// Releases: one script for the release notes, the CI check and the version bump.
//
//   node scripts/release.mjs bump 0.2.2     Bump package.json and the lockfile, add a row to the
//                                          Releases table in docs/release-plan.md (npm run release)
//   node scripts/release.mjs check          CI: if the version changed, it is new, higher than the
//                                          last tag and has a row in the Releases table
//   node scripts/release.mjs notes v0.2.2   Release notes from the tag's row, printed as Markdown;
//                                          exits 3 when there is no row
//
// The "What" column of a row is a comma-separated list; commas inside brackets do not split, so
// "GPX tracks (load, measure, draw, keep)" stays one item. Tags are read with `git tag`, so fetch
// them first in a shallow clone (`git fetch --tags`).
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

const PLAN = 'docs/release-plan.md';
const SITE = 'https://adamvalik.github.io/tirol-snow-map/';

const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();
const fail = (msg) => {
  console.error(process.env.GITHUB_ACTIONS ? `::error::${msg}` : msg);
  process.exit(1);
};

function parse(version) {
  const m = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(version);
  return m ? m.slice(1).map(Number) : null;
}
function compare(a, b) {
  const [x, y] = [parse(a), parse(b)];
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i];
  return 0;
}
function tags() {
  return git('tag', '-l', 'v*')
    .split('\n')
    .filter((t) => parse(t))
    .sort(compare);
}
const packageVersion = () => JSON.parse(readFileSync('package.json', 'utf8')).version;

function row(md, tag) {
  return md.split('\n').find((l) => l.startsWith(`| \`${tag}\` |`));
}
function items(what) {
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

function notes(tag) {
  const r = row(readFileSync(PLAN, 'utf8'), tag);
  if (!r) {
    console.error(`No row for ${tag} in the Releases table of ${PLAN}.`);
    process.exit(3);
  }
  const list = items(r.split('|')[3].trim()).map((i) => `- ${i[0].toUpperCase()}${i.slice(1)}`);
  console.log(["## What's new", '', ...list, '', `Live at ${SITE}`].join('\n'));
}

function check() {
  const version = packageVersion();
  const tag = `v${version}`;
  const all = tags();
  const last = all.at(-1);
  if (!parse(version)) fail(`package.json version ${version} is not X.Y.Z.`);
  if (!last) fail('No v* tags found. In CI, fetch them first (git fetch --tags).');
  if (tag === last) {
    console.log(`Version ${version} is released already (${last}): this merge deploys without a release.`);
    return;
  }
  if (all.includes(tag)) fail(`${tag} is tagged already. Bump to a version above ${last}.`);
  if (compare(tag, last) < 0) fail(`Version ${version} is lower than the last release ${last}.`);
  if (!row(readFileSync(PLAN, 'utf8'), tag)) {
    fail(`No row for ${tag} in the Releases table of ${PLAN}. Add one (npm run release does it).`);
  }
  console.log(`Releases ${tag} after the merge (last release ${last}). Notes:\n`);
  notes(tag);
}

function bump(version) {
  if (!parse(version)) fail('Usage: npm run release X.Y.Z');
  version = version.replace(/^v/, '');
  const tag = `v${version}`;
  const all = tags();
  const last = all.at(-1);
  if (all.includes(tag)) fail(`${tag} is tagged already.`);
  if (last && compare(tag, last) <= 0) fail(`${version} is not above the last release ${last}.`);
  const md = readFileSync(PLAN, 'utf8');
  if (row(md, tag)) fail(`${PLAN} has a row for ${tag} already.`);

  execFileSync('npm', ['version', version, '--no-git-tag-version'], { stdio: 'inherit' });

  // A first draft of the notes from the commit subjects since the last release, to trim by hand.
  const subjects = last ? git('log', '--no-merges', '--format=%s', `${last}..HEAD`).split('\n') : [];
  const what =
    subjects
      .filter((s) => s && !/^Release v\d/.test(s))
      .reverse()
      .map((s) => s.replaceAll('|', '/').replace(/\.$/, ''))
      .map((s, i) => (i > 0 && !/^[A-Z]{2}/.test(s) ? s[0].toLowerCase() + s.slice(1) : s))
      .join(', ') || 'TODO: what changed';
  const date = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  const header = '| --- | --- | --- |\n';
  const at = md.indexOf(header, md.indexOf('## Releases'));
  if (at < 0) fail(`No Releases table found in ${PLAN}.`);
  const i = at + header.length;
  writeFileSync(PLAN, `${md.slice(0, i)}| \`${tag}\` | ${date} | ${what} |\n${md.slice(i)}`);
  console.log(`\nAdded a row for ${tag} to ${PLAN}. Edit its "What" into short user-facing notes, then`);
  console.log('commit and open the pull request dev → main. The merge deploys, tags and publishes it.');
}

const [cmd, arg] = process.argv.slice(2);
if (cmd === 'notes' && arg) notes(arg);
else if (cmd === 'check') check();
else if (cmd === 'bump' && arg) bump(arg);
else fail('Usage: node scripts/release.mjs bump X.Y.Z | check | notes vX.Y.Z');
