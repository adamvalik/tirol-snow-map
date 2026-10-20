/// <reference types="vitest/config" />
import { defineConfig } from 'vite';

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
  worker: { format: 'es' },
  test: {
    root: '.',
    include: ['pipeline/test/**/*.test.ts', 'web/test/**/*.test.ts'],
  },
});
