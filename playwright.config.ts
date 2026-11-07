import { defineConfig, devices } from '@playwright/test';
import { validateBaseURL, assertWriteTarget } from './scripts/safety.mjs';
const baseURL = validateBaseURL(process.env.TARGET_URL ?? 'http://127.0.0.1:5173');
if (process.env.HF_ALLOW_WRITES === '1') assertWriteTarget(baseURL, process.env.HF_TEST_ENV === 'disposable');
const profile = process.env.TEST_PROFILE ?? 'hireflow';
export default defineConfig({
  testDir: './projects', fullyParallel: false, workers: 1,
  forbidOnly: Boolean(process.env.CI), retries: 0, timeout: 30_000,
  expect: { timeout: 10_000 }, outputDir: 'reports/artifacts',
  reporter: [['list'], ['html', { outputFolder: 'reports/html', open: 'never' }], ['junit', { outputFile: 'reports/junit.xml' }], ['json', { outputFile: 'reports/results.json' }]],
  use: { baseURL, trace: 'retain-on-failure', screenshot: 'only-on-failure', video: 'off', actionTimeout: 10_000, serviceWorkers: 'block' },
  projects: [
    { name: 'generic-chromium', testMatch: '**/generic/*.spec.ts', use: { ...devices['Desktop Chrome'], launchOptions: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : {} } },
    ...(profile === 'hireflow' ? [
      { name: 'hireflow-api', testMatch: '**/hireflow/tests/*.api.spec.ts' },
      { name: 'hireflow-chromium', testMatch: '**/hireflow/tests/*.ui.spec.ts', use: { ...devices['Desktop Chrome'], launchOptions: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : {} } },
    ] : []),
  ],
});
