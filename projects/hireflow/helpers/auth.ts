import { expect, type APIRequestContext, type Page } from '@playwright/test';

export const hasCredentials = Boolean(process.env.HF_EMAIL && process.env.HF_PASSWORD);
export const writesEnabled = process.env.HF_ALLOW_WRITES === '1' && process.env.HF_TEST_ENV === 'disposable';
export const credentials = { email: process.env.HF_EMAIL ?? '', password: process.env.HF_PASSWORD ?? '' };
export async function login(request: APIRequestContext, email = credentials.email, password = credentials.password) {
  const response = await request.post('/api/auth/login', { data: { email, password } });
  expect(response.status(), 'Dedicated test account must log in successfully').toBe(200);
  const body = await response.json();
  expect(body.accessToken).toEqual(expect.any(String));
  return body as { accessToken: string; user: { id: string; email: string; name: string; permissions: string[]; department: { id: string } | null } };
}
export async function loginUI(page: Page) {
  await page.getByRole('textbox', { name: /^邮箱/ }).fill(credentials.email);
  await page.getByLabel(/^密码/).fill(credentials.password);
  await page.getByRole('button', { name: /^登\s*录$/ }).click();
}
