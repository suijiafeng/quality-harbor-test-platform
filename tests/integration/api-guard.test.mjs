import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { request } from '@playwright/test';
import { guardAPI } from '../../src/core/request-policy.mjs';

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
