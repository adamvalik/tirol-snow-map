// status.json: what went wrong in the last run and for how many runs in a row. The app shows it
// as a warning; the deploy workflow opens an issue when a step keeps failing.

import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { SCHEMA_VERSION, type StatusFile, type StepId } from '../../shared/types.ts';

export async function writeStatus(outDir: string, now: string, problems: Record<StepId, string[]>): Promise<StatusFile> {
  const file = path.join(outDir, 'status.json');
  let previous: StatusFile | null = null;
  try {
    previous = JSON.parse(await readFile(file, 'utf8')) as StatusFile;
    if (previous.schemaVersion !== SCHEMA_VERSION) previous = null;
  } catch {
    // first run
  }
  const steps = {} as StatusFile['steps'];
  for (const id of Object.keys(problems) as StepId[]) {
    const p = problems[id];
    const prev = previous?.steps[id];
    steps[id] = p.length
      ? {
          ok: false,
          problems: p,
          consecutiveFailures: (prev?.consecutiveFailures ?? 0) + 1,
          failingSince: prev?.failingSince ?? now,
        }
      : { ok: true, problems: [], consecutiveFailures: 0, failingSince: null };
  }
  const status: StatusFile = { schemaVersion: SCHEMA_VERSION, generatedAt: now, steps };
  await writeFile(file, JSON.stringify(status, null, 2));
  return status;
}
