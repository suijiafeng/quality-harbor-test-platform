import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const runner = fileURLToPath(new URL('../../src/cli/run.mjs', import.meta.url));
const target = 'http://127.0.0.1:9';

async function run(args, options = {}) {
  const env = { ...process.env };
  for (const key of [...Object.keys(env).filter(key => key.startsWith('HF_')), 'TARGET_URL', 'TEST_PROFILE']) {
    delete env[key];
  }
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [runner, ...args], {
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
      ...options,
    });
    let output = '';
    child.stdout.on('data', chunk => { output += chunk; });
    child.stderr.on('data', chunk => { output += chunk; });
    child.on('error', reject);
    child.on('close', code => resolve({ code, output }));
  });
}

// With an explicit profile, --list only loads configuration and fixtures.
// Auto profile discovery still probes /api/health, as tested below.
for (const [label, flags, count] of [
  ['generic', ['--profile=generic'], 3],
  ['HireFlow', ['--profile=hireflow'], 53],
  ['API', ['--profile=hireflow', '--project=hireflow-api'], 31],
  ['UI', ['--profile=hireflow', '--project=hireflow-chromium'], 19],
  ['smoke', ['--profile=hireflow', '--smoke'], 23],
]) {
  test(`runner discovers the configured ${label} suite`, async () => {
    const result = await run([target, ...flags, '--list', '--reporter=list']);
    assert.equal(result.code, 0, result.output);
    assert.match(result.output, new RegExp(`Total: ${count} tests? in`));
  });
}

test('runner resolves the repository configuration from another working directory', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'qualityharbor-runner-'));
  try {
    const result = await run([target, '--profile=generic', '--list', '--reporter=list'], { cwd });
    assert.equal(result.code, 0, result.output);
    assert.match(result.output, /Total: 3 tests in/);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test('runner help does not require a target', async () => {
  const result = await run(['--help']);
  assert.equal(result.code, 0, result.output);
  assert.match(result.output, /Usage: npm test/);
});

for (const [label, args, expected] of [
  ['page URL', [`${target}/login`, '--profile=generic'], /application root URL/],
  ['unknown profile', [target, '--profile=unknown'], /Unknown profile/],
  ['smoke writes', [target, '--smoke', '--allow-writes'], /does not permit write tests/],
  ['unacknowledged writes', [target, '--allow-writes'], /disposable loopback-hosted/],
]) {
  test(`runner rejects ${label} before executing tests`, async () => {
    const result = await run(args);
    assert.equal(result.code, 1, result.output);
    assert.match(result.output, expected);
  });
}

for (const [label, body, profile, count] of [
  ['HireFlow health', { service: 'hireflow-api', status: 'ok' }, 'hireflow', 53],
  ['unrecognized health', { status: 'ok' }, 'generic', 3],
]) {
  test(`runner detects ${label} using only a local test server`, async () => {
    const paths = [];
    const server = createServer((req, res) => {
      paths.push(req.url);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(body));
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    try {
      const result = await run([`http://127.0.0.1:${server.address().port}`, '--list', '--reporter=list']);
      assert.equal(result.code, 0, result.output);
      assert.match(result.output, new RegExp(`profile: ${profile}`));
      assert.match(result.output, new RegExp(`Total: ${count} tests in`));
      assert.deepEqual(paths, ['/api/health']);
    } finally {
      await new Promise(resolve => server.close(resolve));
    }
  });
}
