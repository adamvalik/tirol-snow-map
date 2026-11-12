/// <reference types="vitest/config" />
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';

// App version from package.json and the short commit it was built from (GITHUB_SHA in Actions,
// git locally, "dev" without git). Shown in "About the data".
const version = (JSON.parse(readFileSync('package.json', 'utf8')) as { version: string }).version;
function commit(): string {
  if (process.env.GITHUB_SHA) return process.env.GITHUB_SHA.slice(0, 7);
  try {
    return execSync('git rev-parse --short=7 HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  } catch {
    return 'dev';
  }
}

// Optional, from the deploy workflow's repository variables (see README, Deployment). Empty turns
// the feedback e-mail links and the visit counting off.
const feedbackEmail = (process.env.FEEDBACK_EMAIL ?? '').trim();
const goatcounterCode = (process.env.GOATCOUNTER_CODE ?? '').trim();
if (feedbackEmail && !/^[^\s@<>"]+@[^\s@<>"]+\.[a-z]{2,}$/i.test(feedbackEmail)) {
  throw new Error(`FEEDBACK_EMAIL is not an e-mail address: ${feedbackEmail}`);
}
if (goatcounterCode && !/^[a-z0-9-]+$/.test(goatcounterCode)) {
  throw new Error(`GOATCOUNTER_CODE should be the site code only (the part before .goatcounter.com): ${goatcounterCode}`);
}

export default defineConfig({
  root: 'web',
  // Relative base so the build works both at a GitHub Pages sub-path and locally.
  base: './',
  build: {
    outDir: '../dist',
    emptyOutDir: true,
    target: 'es2022',
    // MapLibre alone is ~1 MB minified; it is split into its own chunk below.
    chunkSizeWarningLimit: 1500,
    rolldownOptions: {
      output: {
        codeSplitting: { groups: [{ name: 'maplibre', test: /node_modules[\\/]maplibre-gl/ }] },
      },
    },
  },
  define: {
    __APP_VERSION__: JSON.stringify(version),
    __APP_COMMIT__: JSON.stringify(commit()),
    __FEEDBACK_EMAIL__: JSON.stringify(feedbackEmail),
    __GOATCOUNTER_CODE__: JSON.stringify(goatcounterCode),
  },
  worker: { format: 'es' },
  test: {
    root: '.',
    include: ['pipeline/test/**/*.test.ts', 'web/test/**/*.test.ts'],
  },
});
