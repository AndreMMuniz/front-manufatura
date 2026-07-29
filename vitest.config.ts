import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // PO-UI component suites are DOM-heavy. Bound parallelism so CI does not
    // starve jsdom workers and turn fast assertions into false timeout failures.
    maxWorkers: 4,
    hookTimeout: 10_000,
    testTimeout: 10_000,
  },
});
