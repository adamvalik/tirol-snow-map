// Checks what GitHub Pages really serves after a deploy (run by .github/workflows/deploy.yml, job
// deploy). The smoke test checks the build in CI, not the live site, so a broken deploy (missing
// data, a wrong path, a stale picture) was only found by a person. For the site and the dev preview:
// - index.html loads and names the commit that was built (<meta name="app-commit">),
// - data/status.json is there and fresh,
// - the basemap file answers, and at the root also the link preview picture og.jpg.
// Like scripts/monitor.mjs it keeps one issue, labelled `live-site`, in step: opened or updated
// while a check fails, commented and closed when all pass again.
//
// Env: SITE (the site's address, ending in /), MAIN_COMMIT and DEV_COMMIT (short commits built,
// DEV_COMMIT empty when there is no dev preview), GH_TOKEN, RUN_URL. --dry-run: no issue changes.

import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';

/** Data older than this is stale: runs are 8 hours apart, and GitHub often starts them late. */
export const MAX_DATA_AGE_H = 14;
const LABEL = 'live-site';
const ATTEMPTS = 3;
const RETRY_MS = 20_000;

/**
 * Checks one deployed build. Returns the problems found (empty when all is well) and notes that do
 * not fail it. `fetchFn` is fetch; `now` the current time in ms.
 */
export async function checkSite({ base, commit, picture }, fetchFn = fetch, now = Date.now()) {
  const problems = [];
  const notes = [];
  const bust = `check=${now}`;
  const get = async (path, init) => {
    try {
      return await fetchFn(`${base}${path}${path.includes('?') ? '&' : '?'}${bust}`, { cache: 'no-store', ...init });
    } catch (e) {
      return { ok: false, status: `network error (${e instanceof Error ? e.message : e})` };
    }
  };

  const page = await get('');
  if (!page.ok) problems.push(`\`${base}\` answers ${page.status}`);
  else {
    const html = await page.text();
    const built = /<meta name="app-commit" content="([^"]*)"/.exec(html)?.[1];
    if (!built) notes.push(`\`${base}\` names no commit (a build from before the commit tag)`);
    else if (commit && built !== commit) problems.push(`\`${base}\` serves commit ${built}, expected ${commit}`);
  }

  const status = await get('data/status.json');
  if (!status.ok) problems.push(`\`${base}data/status.json\` answers ${status.status}`);
  else {
    const generatedAt = await status
      .json()
      .then((s) => s.generatedAt)
      .catch(() => null);
    const ageH = generatedAt ? (now - Date.parse(generatedAt)) / 3_600_000 : NaN;
    if (!Number.isFinite(ageH)) problems.push(`\`${base}data/status.json\` has no readable generatedAt`);
    else if (ageH > MAX_DATA_AGE_H) problems.push(`\`${base}data/status.json\` is ${Math.round(ageH)} h old (from ${generatedAt})`);
  }

  // The first bytes only: the file is about 90 MB.
  const basemap = await get('basemap/south-tyrol.pmtiles', { headers: { range: 'bytes=0-15' } });
  if (!basemap.ok) problems.push(`\`${base}basemap/south-tyrol.pmtiles\` answers ${basemap.status}`);

  if (picture) {
    const og = await get('og.jpg', { method: 'HEAD' });
    if (!og.ok) problems.push(`\`${base}og.jpg\` answers ${og.status}`);
  }
  return { problems, notes };
}

/** Checks the site and the dev preview, a few times while the CDN may still serve old files. */
async function checkAll(site, mainCommit, devCommit) {
  const targets = [{ base: site, commit: mainCommit, picture: true }];
  if (devCommit) targets.push({ base: `${site}dev/`, commit: devCommit, picture: false });
  let result = { problems: [], notes: [] };
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    const results = await Promise.all(targets.map((t) => checkSite(t)));
    result = { problems: results.flatMap((r) => r.problems), notes: results.flatMap((r) => r.notes) };
    if (!result.problems.length || attempt === ATTEMPTS) break;
    console.log(`attempt ${attempt}: ${result.problems.length} problem(s), trying again`);
    await new Promise((r) => setTimeout(r, RETRY_MS));
  }
  return result;
}

async function main() {
  const site = (process.env.SITE ?? '').replace(/\/?$/, '/');
  if (!/^https?:\/\//.test(site)) throw new Error(`SITE is not an address: ${process.env.SITE}`);
  const { problems, notes } = await checkAll(site, process.env.MAIN_COMMIT ?? '', process.env.DEV_COMMIT ?? '');
  const lines = problems.map((p) => `- ${p}`);
  const summary = (problems.length ? `### Live site: problems\n\n${lines.join('\n')}\n` : '### Live site: all checks pass\n') + notes.map((n) => `\n_${n}_`).join('');
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${summary}\n`);
  console.log(summary);
  if (process.argv.includes('--dry-run')) {
    process.exitCode = problems.length ? 1 : 0;
    return;
  }

  const gh = (...args) => execFileSync('gh', args, { encoding: 'utf8' }).trim();
  let open;
  try {
    open = JSON.parse(gh('issue', 'list', '--label', LABEL, '--state', 'open', '--json', 'number', '--limit', '1'))[0]?.number;
  } catch {
    // The label is created on first use.
    open = undefined;
  }
  const run = process.env.RUN_URL ?? 'unknown';
  if (problems.length) {
    const body = [
      'After the deploy, the live site does not serve what was built:',
      '',
      ...lines,
      '',
      `Latest run: ${run}`,
      '',
      'Re-running the workflow usually fixes a deploy GitHub Pages did not pick up. This issue is updated by `scripts/live-check.mjs` and closed automatically when all checks pass again.',
    ].join('\n');
    const title = `Live site check failed: ${problems.length} problem${problems.length === 1 ? '' : 's'}`;
    if (open) {
      gh('issue', 'edit', String(open), '--title', title, '--body', body);
      console.log(`updated issue #${open}`);
    } else {
      gh('label', 'create', LABEL, '--color', 'd93f0b', '--description', 'The live site does not serve what was deployed', '--force');
      console.log(gh('issue', 'create', '--title', title, '--body', body, '--label', LABEL));
    }
  } else if (open) {
    gh('issue', 'comment', String(open), '--body', `All live site checks pass again (${run}).`);
    gh('issue', 'close', String(open));
    console.log(`closed issue #${open}`);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
