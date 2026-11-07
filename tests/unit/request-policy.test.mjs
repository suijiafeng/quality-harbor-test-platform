import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isRequestAllowed, guardAPI } from '../../src/core/request-policy.mjs';

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
test('API transport errors never disclose raw request headers', async () => {
  const api = guardAPI({ post: async () => { throw new Error('authorization: Bearer synthetic-secret'); } }, 'http://localhost:5173', { authenticated: true });
  await assert.rejects(api.post('/api/auth/login'), error => {
    assert.equal(error.message, 'API transport failed (request details omitted to protect credentials).');
    assert.equal(error.cause, undefined);
    return true;
  });
});
