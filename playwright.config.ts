import { defineConfig, devices } from '@playwright/test';

/**
 * Read environment variables from file.
 * https://github.com/motdotla/dotenv
 */
// import dotenv from 'dotenv';
// import path from 'path';
// dotenv.config({ path: path.resolve(__dirname, '.env') });

/**
 * See https://playwright.dev/docs/test-configuration.
 */
export default defineConfig({
  testDir: './tests',
  testIgnore: 'pwa-offline.spec.ts',
  /* Run tests in files in parallel */
  fullyParallel: true,
  /* Fail the build on CI if you accidentally left test.only in the source code. */
  forbidOnly: !!process.env.CI,
  /* Retry on CI only */
  retries: process.env.CI ? 2 : 0,
  /* Opt out of parallel tests on CI. */
  // PO-UI + three browser engines are memory intensive; bound local
  // parallelism to avoid browser starvation and false navigation timeouts.
  workers: process.env.CI ? 1 : 3,
  /* Relatório detalhado no navegador + resumo humano no terminal e em Markdown local. */
  reporter: [['html', { open: 'never' }], ['./tools/dev-e2e-summary-reporter.ts']],
  /* Shared settings for all the projects below. See https://playwright.dev/docs/api/class-testoptions. */
  use: {
    /* Base URL to use in actions like `await page.goto('')`. */
    baseURL: process.env['PLAYWRIGHT_BASE_URL'] ?? 'http://127.0.0.1:4201',

    /* Collect trace when retrying the failed test. See https://playwright.dev/docs/trace-viewer */
    trace: 'on-first-retry',
  },

  /* Configure projects for major browsers */
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },

    {
      name: 'firefox',
      use: { ...devices['Desktop Firefox'] },
    },

    {
      name: 'webkit',
      // VS Code installed through Snap exports GTK/library paths that make the
      // Playwright WPE network process load an incompatible core20 libpthread.
      // Keep the WebKit child process isolated while preserving the test runner
      // and web-server environment.
      use: {
        ...devices['Desktop Safari'],
        launchOptions: {
          env: {
            HOME: process.env['HOME'] ?? '',
            PATH: process.env['PATH'] ?? '',
          },
        },
      },
    },

    /* Test against mobile viewports. */
    // {
    //   name: 'Mobile Chrome',
    //   use: { ...devices['Pixel 5'] },
    // },
    // {
    //   name: 'Mobile Safari',
    //   use: { ...devices['iPhone 12'] },
    // },

    /* Test against branded browsers. */
    // {
    //   name: 'Microsoft Edge',
    //   use: { ...devices['Desktop Edge'], channel: 'msedge' },
    // },
    // {
    //   name: 'Google Chrome',
    //   use: { ...devices['Desktop Chrome'], channel: 'chrome' },
    // },
  ],

  /* Run your local dev server before starting the tests */
  webServer: process.env['PLAYWRIGHT_BASE_URL']
    ? undefined
    : {
        command:
          'APP_OFFLINE_SESSION_TTL_MS=28800000 npm start -- --configuration e2e --host 127.0.0.1 --port 4201 --allowed-hosts',
        url: 'http://127.0.0.1:4201',
        reuseExistingServer: !process.env.CI,
      },
});
