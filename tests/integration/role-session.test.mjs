import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { request } from '@playwright/test';
import { RoleSession } from '../../projects/hireflow/helpers/role-session.ts';

// Credentials and tokens below are fake test strings, never real authentication data.
test('role sessions enforce explicit disposable-local writes and sanitize auth diagnostics', async () => {
  const old = { writes: process.env.HF_ALLOW_WRITES, environment: process.env.HF_TEST_ENV };
  let requests = 0;
  const server = createServer((req, res) => {
    requests++;
    if (req.url === '/api/auth/login') { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ accessToken: 'synthetic-test-token', user: { id: 'test-user' } })); }
    else if (req.url === '/api/redirect') { res.writeHead(307, { location: '/api/destination' }); res.end(); }
    else if (req.url === '/api/broken') { res.destroy(); }
    else { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ authorized: req.headers.authorization === 'Bearer synthetic-test-token' })); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  let session;
  try {
    delete process.env.HF_ALLOW_WRITES;
    process.env.HF_TEST_ENV = 'disposable';
    assert.throws(() => new RoleSession({ request }, base), /Write tests require/);
    process.env.HF_ALLOW_WRITES = '1';
    assert.throws(() => new RoleSession({ request }, 'https://example.test'), /Remote writes are disabled/);
    process.env.HF_TEST_ENV = 'production';
    assert.throws(() => new RoleSession({ request }, base), /Write tests require/);
    process.env.HF_TEST_ENV = 'disposable';
    session = new RoleSession({ request }, base);
    await assert.rejects(session.request('missing', 'GET', '/jobs'), /must authenticate/);
    await assert.rejects(session.request(null, 'GET', '//example.test'), /API-relative/);
    await assert.rejects(session.request(null, 'GET', '/../outside'), /remain under/);
    assert.equal(requests, 0);
    await session.login('synthetic', 'staff@example.test', 'synthetic-password');
    assert.deepEqual(await session.call('synthetic', 'GET', '/profile'), { authorized: true });
    assert.deepEqual(await session.call('candidate', 'GET', '/profile'), { authorized: false });
    const beforeRedirect = requests;
    assert.equal((await session.request('synthetic', 'POST', '/redirect')).status, 307);
    assert.equal(requests, beforeRedirect + 1);
    await assert.rejects(session.call('synthetic', 'GET', '/portal/offers/synthetic-test-token', undefined, 403), error => error.message.includes('[REDACTED]') && !error.message.includes('synthetic-test-token'));
    await assert.rejects(session.call('synthetic', 'GET', '/broken'), error => !error.message.includes('synthetic-test-token') && /details omitted/.test(error.message));
    assert.equal(session.redact('synthetic-password'), '[REDACTED]');
  } finally {
    await session?.dispose();
    for (const [key, value] of [['HF_ALLOW_WRITES', old.writes], ['HF_TEST_ENV', old.environment]]) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    await new Promise(resolve => server.close(resolve));
  }
});
