import { test as base, expect, type APIRequestContext, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { assertWriteTarget } from '../../../scripts/safety.mjs';
import { guardAPI, isRequestAllowed } from '../../../scripts/request-policy.mjs';
export const hasCredentials = Boolean(process.env.HF_EMAIL && process.env.HF_PASSWORD);
export const writesEnabled = process.env.HF_ALLOW_WRITES === '1' && process.env.HF_TEST_ENV === 'disposable';
export const credentials = { email: process.env.HF_EMAIL ?? '', password: process.env.HF_PASSWORD ?? '' };
export const unique = (label: string) => `QA-${label}-${randomUUID().slice(0, 8)}`;
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
export const test = base.extend<{ admin: APIRequestContext; writeGuard: void }>({
  // Traces include request bodies and bearer tokens; never persist auth-bearing traces.
  trace: 'off',
  request: async ({ request, baseURL }, use) => {
    await use(guardAPI(request, baseURL!, { authenticated: hasCredentials }));
  },
  context: async ({ context, baseURL }, use) => {
    let closing = false;
    context.on('close', () => { closing = true; });
    // UI checks never need business writes, even when API write tests are enabled.
    await context.route('**/*', async route => {
      const req = route.request();
      try {
        if (!isRequestAllowed(req.url(), req.method(), baseURL!, { authenticated: hasCredentials })) {
          await route.abort('blockedbyclient');
          return;
        }
        // route.continue() can follow redirects without another routing callback.
        // Fetch once and reject redirects rather than risk replaying a login body.
        const response = await route.fetch({ maxRedirects: 0 });
        if (response.status() >= 300 && response.status() < 400 && response.status() !== 304) {
          await route.abort('blockedbyclient');
        } else await route.fulfill({ response });
        await response.dispose();
      } catch {
        // Never propagate Playwright's raw request log: it may include bearer tokens.
        if (closing || req.frame().page().isClosed()) return;
        throw new Error('Browser request failed (request details omitted to protect credentials).');
      }
    });
    await context.routeWebSocket('**/*', socket => socket.close());
    try { await use(context); }
    finally {
      closing = true;
      await Promise.all(context.pages().map(page => page.close()));
      await context.unrouteAll({ behavior: 'ignoreErrors' });
    }
  },
  admin: async ({ playwright, baseURL }, use) => {
    if (!hasCredentials) throw new Error('Provide HF_EMAIL and HF_PASSWORD.');
    const anonymous = await playwright.request.newContext({ baseURL });
    let auth: Awaited<ReturnType<typeof login>>;
    try { auth = await login(guardAPI(anonymous, baseURL!, { authenticated: true })); }
    finally { await anonymous.dispose(); }
    const api = await playwright.request.newContext({ baseURL, extraHTTPHeaders: { Authorization: `Bearer ${auth.accessToken}` } });
    try { await use(guardAPI(api, baseURL!, { authenticated: true, writes: writesEnabled })); }
    finally { await api.dispose(); }
  },
  writeGuard: async ({ baseURL }, use) => {
    assertWriteTarget(baseURL, writesEnabled);
    await use();
  },
});
export { expect };
