import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  testMatch: 'pwa-offline.spec.ts',
  fullyParallel: false,
  workers: 1,
  reporter: [
    ['list'],
    ['html', { open: 'never' }],
    ['./tools/dev-e2e-summary-reporter.ts'],
  ],
  use: {
    baseURL: 'http://127.0.0.1:4301',
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'pwa-chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: 'node tools/pwa-e2e-server.mjs',
    url: 'http://127.0.0.1:4301/__pwa_test/health',
    reuseExistingServer: false,
  },
});
