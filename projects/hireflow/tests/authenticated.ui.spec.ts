import { test, expect, hasCredentials, loginUI } from '../support/fixtures.js';
test.describe('authenticated browser checks', () => {
  test.skip(!hasCredentials, 'Set HF_EMAIL and HF_PASSWORD for an administrator test account.');
  test('U06 login returns to requested page and survives reload', async ({ page }) => {
    await page.goto('/jobs');
    await expect(page).toHaveURL(/\/login\?/);
    await loginUI(page);
    await expect(page).toHaveURL(/\/jobs$/);
    await expect(page.getByRole('button', { name: /新建职位$/ }).first()).toBeVisible();
    await page.reload();
    await expect(page).toHaveURL(/\/jobs$/);
    await expect(page.getByRole('button', { name: /新建职位$/ }).first()).toBeVisible();
  });
  test('U07 canceled new-job dialog never submits a create request', async ({ page }) => {
    await page.goto('/login?redirect=%2Fjobs');
    await loginUI(page);
    await expect(page).toHaveURL(/\/jobs$/);
    let writes = 0;
    page.on('request', req => { if (req.method() === 'POST' && new URL(req.url()).pathname === '/api/jobs') writes++; });
    await page.getByRole('button', { name: /新建职位$/ }).first().click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.getByRole('dialog').getByPlaceholder('如：后端工程师').fill('QA-cancel-without-saving');
    await page.getByRole('dialog').getByRole('button', { name: /^取\s*消$/ }).click();
    const confirm = page.getByRole('dialog').filter({ hasText: '放弃未保存的内容？' });
    await expect(confirm).toBeVisible();
    await confirm.getByRole('button', { name: '继续编辑', exact: true }).click();
    await expect(confirm).toHaveCount(0);
    const editor = page.getByRole('dialog').filter({ has: page.getByPlaceholder('如：后端工程师') });
    await expect(editor.getByPlaceholder('如：后端工程师')).toHaveValue('QA-cancel-without-saving');
    await editor.getByRole('button', { name: /^取\s*消$/ }).click();
    await expect(confirm).toBeVisible();
    await confirm.getByRole('button', { name: '放弃并关闭', exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect(writes).toBe(0);
  });
  test('U08 logout clears session and Back does not reopen protected data', async ({ page }) => {
    await page.goto('/login?redirect=%2Fjobs');
    await loginUI(page);
    await expect(page).toHaveURL(/\/jobs$/);
    // Create a real protected history entry before logout replaces the current route.
    await page.getByRole('menuitem', { name: /候选人$/ }).click();
    await expect(page).toHaveURL(/\/candidates$/);
    await page.locator('.header-user').hover();
    await page.getByText('退出登录', { exact: true }).click();
    await expect(page).toHaveURL(/\/login$/);
    await page.goBack();
    await expect(page).toHaveURL(/\/login(?:\?|$)/);
    await expect(page.getByRole('button', { name: /新建职位$/ })).toHaveCount(0);
    await page.goto('/jobs');
    await expect(page).toHaveURL(/\/login\?/);
    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('hireflow-auth') ?? '{}'));
    expect(stored.state?.token).toBeNull();
  });
});
