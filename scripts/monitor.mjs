// Monitoring for the scheduled pipeline (run by .github/workflows/deploy.yml after the pipeline).
// Reads web/public/data/status.json and keeps one GitHub issue, labelled `data-pipeline`, in step
// with it: opened when a step has failed FAIL_RUNS times in a row (or the pipeline crashed),
// updated while it keeps failing, commented and closed when everything works again. GitHub
// notifies the repository's watchers about new issues, which is the alert.
//
// It also watches the free upstream quotas recorded in status.json (`usage`, pipeline/src/usage.ts):
// a second issue, labelled `upstream-budget`, opens when any of them passes BUDGET_WARN of its
// limit and closes when the totals are below it again (normally in the new month).
//
// Env: GH_TOKEN (for the gh CLI), PIPELINE_EXIT (exit code of npm run pipeline), RUN_URL.

import { execFileSync } from 'node:child_process';
import { appendFileSync, readFileSync } from 'node:fs';

/** 3 runs at three a day: a failing upstream for about a day, not a single blip. */
const FAIL_RUNS = 3;
const LABEL = 'data-pipeline';
const BUDGET_LABEL = 'upstream-budget';
/** Share of a free limit that opens the budget issue. */
const BUDGET_WARN = 0.8;

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

const usage = status?.usage;
const budget = usage
  ? [
      { name: 'Sentinel Hub processing units', used: usage.sentinelHub.processingUnits, limit: usage.sentinelHub.limitProcessingUnits, per: 'this month' },
      { name: 'Sentinel Hub requests', used: usage.sentinelHub.requests, limit: usage.sentinelHub.limitRequests, per: 'this month' },
      { name: 'Open-Meteo calls', used: usage.openMeteo.calls, limit: usage.openMeteo.limitMonth, per: 'this month' },
      { name: 'Open-Meteo calls', used: usage.openMeteo.callsToday, limit: usage.openMeteo.limitDay, per: 'today' },
    ].map((b) => ({ ...b, share: b.used / b.limit }))
  : [];
const budgetLines = budget.map(
  (b) => `- ${b.name}: ${b.used} of ${b.limit} ${b.per} (${Math.round(b.share * 100)} %)${b.share >= BUDGET_WARN ? ' – **near the limit**' : ''}`,
);
const nearLimit = budget.filter((b) => b.share >= BUDGET_WARN);

const summary =
  (lines.length ? `### Data problems\n\n${lines.join('\n')}\n` : '### Data: all steps OK\n') +
  (usage ? `\n### Upstream quotas, ${usage.month}\n\n${budgetLines.join('\n')}\n` : '');
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

// Upstream quotas.
let budgetOpen;
try {
  budgetOpen = JSON.parse(gh('issue', 'list', '--label', BUDGET_LABEL, '--state', 'open', '--json', 'number', '--limit', '1'))[0]?.number;
} catch {
  budgetOpen = undefined;
}
if (nearLimit.length) {
  const title = `Upstream quota near the limit: ${nearLimit.map((b) => `${b.name} (${Math.round(b.share * 100)} %)`).join(', ')}`;
  const budgetBody = [
    `The pipeline has used more than ${Math.round(BUDGET_WARN * 100)} % of a free upstream allowance (${usage.month}, counted by production runs only):`,
    '',
    ...budgetLines,
    '',
    'Past the limit, Sentinel Hub refuses requests until the 1st (the satellite picture and the snow from space then stay as they are), and Open-Meteo refuses the forecast grid. To use less: run the check workflow less often, or render the satellite picture less often (pipeline/src/satellite/).',
    '',
    `Latest run: ${process.env.RUN_URL ?? 'unknown'}`,
    '',
    'This issue is updated by `scripts/monitor.mjs` and closed automatically when the totals are below the threshold again.',
  ].join('\n');
  if (budgetOpen) {
    gh('issue', 'edit', String(budgetOpen), '--title', title, '--body', budgetBody);
    console.log(`updated issue #${budgetOpen}`);
  } else {
    gh('label', 'create', BUDGET_LABEL, '--color', 'fbca04', '--description', 'Free upstream quotas nearly used up', '--force');
    console.log(gh('issue', 'create', '--title', title, '--body', budgetBody, '--label', BUDGET_LABEL));
  }
} else if (budgetOpen && usage) {
  gh('issue', 'comment', String(budgetOpen), '--body', `Usage is below ${Math.round(BUDGET_WARN * 100)} % of every limit again (${usage.month}).`);
  gh('issue', 'close', String(budgetOpen));
  console.log(`closed issue #${budgetOpen}`);
}
