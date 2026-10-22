// Monitoring for the scheduled pipeline (run by .github/workflows/deploy.yml after the pipeline).
// Reads web/public/data/status.json and keeps one GitHub issue, labelled `data-pipeline`, in step
// with it: opened when a step has failed FAIL_RUNS times in a row (or the pipeline crashed),
// updated while it keeps failing, commented and closed when everything works again. GitHub
// notifies the repository's watchers about new issues, which is the alert.
//
// Env: GH_TOKEN (for the gh CLI), PIPELINE_EXIT (exit code of npm run pipeline), RUN_URL.

import { execFileSync } from 'node:child_process';
import { appendFileSync, readFileSync } from 'node:fs';

/** 3 runs at three a day: a failing upstream for about a day, not a single blip. */
const FAIL_RUNS = 3;
const LABEL = 'data-pipeline';

const exit = process.env.PIPELINE_EXIT ?? '';
const crashed = exit !== '0' && exit !== '2';
let status = null;
try {
  status = JSON.parse(readFileSync('web/public/data/status.json', 'utf8'));
} catch {
  // no status yet (first run crashed)
}

const failing = Object.entries(status?.steps ?? {}).filter(([, s]) => !s.ok);
const alarming = failing.filter(([, s]) => s.consecutiveFailures >= FAIL_RUNS);
const lines = [
  crashed ? `- **The pipeline crashed** (exit code ${exit || 'unknown'}); the site keeps the data of the previous run.` : null,
  ...failing.map(
    ([id, s]) => `- **${id}**: failing for ${s.consecutiveFailures} run(s) since ${s.failingSince}: ${s.problems.join('; ')}`,
  ),
].filter(Boolean);

const summary = lines.length ? `### Data problems\n\n${lines.join('\n')}\n` : '### Data: all steps OK\n';
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary);
console.log(summary);

const gh = (...args) => execFileSync('gh', args, { encoding: 'utf8' }).trim();
let open;
try {
  open = JSON.parse(gh('issue', 'list', '--label', LABEL, '--state', 'open', '--json', 'number', '--limit', '1'))[0]?.number;
} catch {
  // Labels are created on first use; a missing label just means no issue yet.
  open = undefined;
}

const body = [
  'The scheduled data update keeps failing. The app shows the last good data with a warning until it recovers.',
  '',
  ...lines,
  '',
  `Latest run: ${process.env.RUN_URL ?? 'unknown'}`,
  '',
  'This issue is updated by `scripts/monitor.mjs` and closed automatically when all steps work again.',
].join('\n');

if (crashed || alarming.length) {
  const title = crashed ? 'Data pipeline crashed' : `Data pipeline: ${alarming.map(([id]) => id).join(', ')} failing`;
  if (open) {
    gh('issue', 'edit', String(open), '--title', title, '--body', body);
    console.log(`updated issue #${open}`);
  } else {
    gh('label', 'create', LABEL, '--color', 'd93f0b', '--description', 'Scheduled data update problems', '--force');
    console.log(gh('issue', 'create', '--title', title, '--body', body, '--label', LABEL));
  }
} else if (open && !failing.length && !crashed) {
  gh('issue', 'comment', String(open), '--body', `All steps work again (${process.env.RUN_URL ?? 'latest run'}).`);
  gh('issue', 'close', String(open));
  console.log(`closed issue #${open}`);
}
