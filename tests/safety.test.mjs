import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateBaseURL, assertWriteTarget } from '../scripts/safety.mjs';
test('normalizes local URL', () => assert.equal(validateBaseURL('http://localhost:5173/'), 'http://localhost:5173'));
test('accepts HTTPS remote URL for read-only checks', () => assert.equal(validateBaseURL('https://example.com'), 'https://example.com'));
for (const value of ['file:///etc/passwd', 'https://user:pass@example.com', 'https://example.com/path', 'https://example.com?token=x', 'https://example.com#fragment', 'not a URL']) {
  test(`rejects unsafe or ambiguous URL: ${value}`, () => assert.throws(() => validateBaseURL(value)));
}
for (const value of ['https://remote.example.test', 'http://127.0.0.1.evil.test', 'http://0.0.0.0:3000']) {
  test(`blocks remote writes: ${value}`, () => assert.throws(() => assertWriteTarget(value, true)));
}
test('requires explicit disposable-environment acknowledgment', () => assert.throws(() => assertWriteTarget('http://localhost:5173', false)));
test('allows explicitly acknowledged disposable local target', () => assert.equal(assertWriteTarget('http://127.0.0.1:5173', true), 'http://127.0.0.1:5173'));

import { isRequestAllowed, guardAPI } from '../scripts/request-policy.mjs';
import { createServer } from 'node:http';
import { request } from '@playwright/test';
test('read-only network policy blocks business writes and external requests', () => {
  const base = 'http://localhost:5173';
  assert.equal(isRequestAllowed('/api/jobs', 'POST', base), false);
  assert.equal(isRequestAllowed('/api/jobs', 'GET', base), true);
  assert.equal(isRequestAllowed('https://example.com/api/jobs', 'GET', base), false);
  assert.equal(isRequestAllowed('/api/auth/login', 'POST', base), false);
  assert.equal(isRequestAllowed('/api/auth/login', 'POST', base, { authenticated: true }), true);
  assert.equal(isRequestAllowed('/api/auth/login?next=external', 'POST', base, { authenticated: true }), false);
  assert.equal(isRequestAllowed('/api/jobs', 'POST', base, { writes: true }), true);
  assert.throws(() => isRequestAllowed('/api/jobs', 'POST', 'https://example.com', { writes: true }));
});
test('API guard refuses redirects without replaying credentials or writes', async () => {
  let reachedDestination = 0;
  const destination = createServer((req, res) => { reachedDestination++; res.end('unexpected'); });
  const source = createServer((req, res) => {
    res.writeHead(307, { Location: `http://127.0.0.1:${destination.address().port}/destination` }); res.end();
  });
  await new Promise(resolve => destination.listen(0, '127.0.0.1', resolve));
  await new Promise(resolve => source.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${source.address().port}`;
  const context = await request.newContext({ baseURL: base });
  try {
    const api = guardAPI(context, base, { authenticated: true, writes: true });
    for (const path of ['/api/auth/login', '/api/jobs']) {
      const response = await api.post(path, { data: { synthetic: 'not-a-secret' }, maxRedirects: 20 });
      assert.equal(response.status(), 307);
    }
    assert.equal(reachedDestination, 0);
    assert.throws(() => api.post(`http://127.0.0.1:${destination.address().port}/api/jobs`));
  } finally {
    await context.dispose();
    await Promise.all([source, destination].map(server => new Promise(resolve => server.close(resolve))));
  }
});
test('API transport errors never disclose raw request headers', async () => {
  const api = guardAPI({ post: async () => { throw new Error('authorization: Bearer synthetic-secret'); } }, 'http://localhost:5173', { authenticated: true });
  await assert.rejects(api.post('/api/auth/login'), error => {
    assert.equal(error.message, 'API transport failed (request details omitted to protect credentials).');
    assert.equal(error.cause, undefined);
    return true;
  });
});
