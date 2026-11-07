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
  },
  worker: { format: 'es' },
  test: {
    root: '.',
    include: ['pipeline/test/**/*.test.ts', 'web/test/**/*.test.ts'],
  },
});
