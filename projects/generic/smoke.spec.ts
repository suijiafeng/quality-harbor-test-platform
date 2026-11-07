import { test, expect } from '../hireflow/support/fixtures.js';
// Observe only the supplied entry URL. No blind form submissions or crawler clicks.
test('G01 entry page returns a successful document', async ({ page }) => {
  const response = await page.goto('/');
  expect(response).not.toBeNull();
  expect(response!.status()).toBeLessThan(400);
  await expect(page.locator('body')).toBeVisible();
  await expect.poll(() => page.locator('body').innerText()).not.toBe('');
});
test('G02 page has a nonempty document title', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveTitle(/\S/);
});
test('G03 entry does not throw uncaught JavaScript exceptions', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await page.waitForLoadState('load');
  await expect(page.locator('body')).toBeVisible();
  // A short bounded observation window, not a readiness condition for interactions.
  await page.waitForTimeout(1500);
  expect(errors).toEqual([]);
});
