import { type APIRequestContext } from '@playwright/test';
import { test as base, expect } from '../../../src/fixtures/test.js';
import { assertWriteTarget } from '../../../src/core/target.mjs';
import { guardAPI } from '../../../src/core/request-policy.mjs';
import { hasCredentials, writesEnabled, login } from '../helpers/auth.js';

export const test = base.extend<{ admin: APIRequestContext; writeGuard: void }>({
  allowAuthentication: hasCredentials,
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

export { hasCredentials, writesEnabled, credentials, login, loginUI } from '../helpers/auth.js';
export { unique } from '../helpers/test-data.js';
