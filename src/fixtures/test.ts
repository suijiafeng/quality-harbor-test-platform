import { test as base, expect } from '@playwright/test';
import { guardAPI, isRequestAllowed } from '../core/request-policy.mjs';

type NetworkOptions = { allowAuthentication: boolean };

// Shared fixtures must not import a business adapter or read its credentials.
export const test = base.extend<NetworkOptions>({
  allowAuthentication: [false, { option: true }],
  // Traces include request bodies and bearer tokens; never persist auth-bearing traces.
  trace: 'off',
  request: async ({ request, baseURL, allowAuthentication }, use) => {
    await use(guardAPI(request, baseURL!, { authenticated: allowAuthentication }));
  },
  context: async ({ context, baseURL, allowAuthentication }, use) => {
    let closing = false;
    context.on('close', () => { closing = true; });
    // UI checks never need business writes, even when API write tests are enabled.
    await context.route('**/*', async route => {
      const req = route.request();
      try {
        if (!isRequestAllowed(req.url(), req.method(), baseURL!, { authenticated: allowAuthentication })) {
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
});
export { expect };
