import { join } from 'node:path';
import { defineConfig, devices } from '@playwright/test';
import { validateBaseURL, assertWriteTarget } from './src/core/target.mjs';

const baseURL = validateBaseURL(process.env.TARGET_URL ?? 'http://127.0.0.1:5173');
if (process.env.HF_ALLOW_WRITES === '1') {
  assertWriteTarget(baseURL, process.env.HF_TEST_ENV === 'disposable');
}

const profile = process.env.TEST_PROFILE ?? 'hireflow';
const reportDir = process.env.QH_RUN_DIR || 'reports';
const chromium = {
  ...devices['Desktop Chrome'],
  launchOptions: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
    ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH }
    : {},
};

export default defineConfig({
  testDir: './projects',
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  timeout: 30_000,
  expect: { timeout: 10_000 },
  outputDir: join(reportDir, 'artifacts'),
  reporter: [
    ['list'],
    ['./src/reporters/run-summary.ts'],
    ['html', { outputFolder: join(reportDir, 'html'), open: 'never' }],
    ['junit', { outputFile: join(reportDir, 'junit.xml') }],
    ['json', { outputFile: join(reportDir, 'results.json') }],
  ],
  use: {
    baseURL,
    trace: 'off',
    screenshot: 'only-on-failure',
    video: 'off',
    actionTimeout: 10_000,
    serviceWorkers: 'block',
  },
  projects: [
    {
      name: 'generic-chromium',
      testMatch: '**/generic/tests/ui/*.spec.ts',
      use: chromium,
    },
    ...(profile === 'hireflow' ? [
      { name: 'hireflow-api', testMatch: '**/hireflow/tests/api/*.spec.ts' },
      {
        name: 'hireflow-chromium',
        testMatch: '**/hireflow/tests/ui/*.spec.ts',
        use: chromium,
      },
    ] : []),
  ],
});
