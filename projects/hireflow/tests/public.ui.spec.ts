import { test, expect } from '../support/fixtures.js';
test('U01 login form exposes usable email and password fields', async ({ page }) => {
  await page.goto('/login');
  await expect(page.getByRole('textbox', { name: /^邮箱/ })).toBeVisible();
  await expect(page.getByLabel(/^密码/)).toHaveAttribute('type', 'password');
  await expect(page.getByRole('button', { name: /^登\s*录$/ })).toBeEnabled();
});
test('U02 invalid form is blocked locally without a login request', async ({ page }) => {
  let requests = 0;
  page.on('request', request => { if (request.url().endsWith('/api/auth/login')) requests++; });
  await page.goto('/login');
  await page.getByRole('textbox', { name: /^邮箱/ }).fill('not-an-email');
  await page.getByLabel(/^密码/).fill('1');
  await page.getByRole('button', { name: /^登\s*录$/ }).click();
  await expect(page.getByText('请输入正确的邮箱', { exact: true })).toBeVisible();
  await expect(page.getByText('密码至少 6 位', { exact: true })).toBeVisible();
  expect(requests).toBe(0);
});
for (const path of ['/dashboard', '/jobs', '/candidates', '/settings']) {
  test(`U03 protected navigation preserves return URL: ${path}`, async ({ page }) => {
    await page.goto(path);
    await expect(page).toHaveURL(url => url.pathname === '/login' && url.searchParams.get('redirect') === path);
  });
}
for (const portal of ['offer', 'onboarding', 'interview', 'prescreen']) {
  test(`U04 invalid ${portal} portal displays an actionable error`, async ({ page }) => {
    await page.goto(`/portal/${portal}/qa-invalid-token-do-not-use`);
    await expect(page.getByText('链接无效或已失效', { exact: true })).toBeVisible();
    await expect(page).not.toHaveURL(/\/login/);
  });
}
test('U05 login remains usable on a mobile viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/login');
  await expect(page.getByRole('button', { name: /^登\s*录$/ })).toBeVisible();
  await expect(page.getByRole('textbox', { name: /^邮箱/ })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
});
