import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Forks exchange transformed modules through temporary files. On Windows
    // sandboxes their atomic rename can fail with EPERM before tests start.
    pool: process.platform === 'win32' ? 'threads' : 'forks',
    // Avoid dependency prebundling stalls in the Windows test environment;
    // Angular already supplies the compiled test application in memory.
    ...(process.platform === 'win32'
      ? { deps: { optimizer: { client: { enabled: false } } } }
      : {}),
    // PO-UI component suites are DOM-heavy. Bound parallelism so CI does not
    // starve jsdom workers and turn fast assertions into false timeout failures.
    maxWorkers: 4,
    hookTimeout: 10_000,
    testTimeout: 10_000,
  },
});
