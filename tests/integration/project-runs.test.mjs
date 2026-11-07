import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { cp, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repository = fileURLToPath(new URL('../../', import.meta.url));
async function fixture(fn) {
  const root = await mkdtemp(join(tmpdir(), 'qh-platform-'));
  // Isolate the platform's run history too: self-tests must not overwrite a user's latest report.
  for (const path of ['src', 'projects', 'playwright.config.ts', 'tsconfig.json', 'package.json']) await cp(join(repository, path), join(root, path), { recursive: true });
  await symlink(join(repository, 'node_modules'), join(root, 'node_modules'), 'dir');
  const paths = [];
  let healthy = true;
  let hanging = false;
  let notifyHealth;
  const healthRequest = new Promise(resolve => { notifyHealth = resolve; });
  const server = createServer((req, res) => {
    paths.push([req.method, req.url]);
    if (hanging && req.url === '/api/health') { notifyHealth(); return; }
    const status = req.url === '/api/health' ? (healthy ? 200 : 503) : req.url.startsWith('/api/portal/') ? 404 : 401;
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(req.url === '/api/health' ? { service: 'hireflow-api', status: 'ok', time: new Date().toISOString() } : { statusCode: status }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}`;
  const config = { version: 1, defaultProject: 'alpha', projects: {
    alpha: { name: 'Alpha fixture', url, profile: 'hireflow' },
    beta: { name: 'Beta fixture', url, profile: 'generic', suite: 'smoke' },
  } };
  await writeFile(join(root, 'qualityharbor.config.json'), JSON.stringify(config));
  try { await fn({ root, url, paths, config, failHealth: () => { healthy = false; }, hangHealth: () => { hanging = true; }, healthRequest }); }
  finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await rm(root, { recursive: true, force: true }); }
}
function run(root, args, envOverrides = {}, onChild = () => {}) {
  const env = { ...process.env };
  for (const key of ['TARGET_URL', 'TEST_PROFILE', 'HF_EMAIL', 'HF_PASSWORD', 'HF_ALLOW_WRITES', 'HF_TEST_ENV', 'QH_RUN_DIR']) delete env[key];
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [join(root, 'src/cli/run.mjs'), ...args], { cwd: tmpdir(), env: { ...env, ...envOverrides }, stdio: ['ignore', 'pipe', 'pipe'] });
    onChild(child);
    let output = '';
    child.stdout.on('data', chunk => { output += chunk; });
    child.stderr.on('data', chunk => { output += chunk; });
    child.on('error', reject);
    child.on('close', code => resolve({ code, output }));
  });
}
async function result(root, output) {
  const directory = output.match(/^Reports: (.+)$/m)?.[1];
  assert.ok(directory, output);
  const path = join(root, directory);
  return { path, metadata: JSON.parse(await readFile(join(path, 'run.json'), 'utf8')), summary: JSON.parse(await readFile(join(path, 'summary.json'), 'utf8')) };
}

test('configured projects list and discover without creating run history or contacting the target', () => fixture(async ({ root, paths }) => {
  const list = await run(root, ['--list-targets']);
  assert.equal(list.code, 0, list.output);
  assert.match(list.output, /alpha \(default\)/);
  assert.match(list.output, /beta.*generic.*smoke/);
  const preview = await run(root, ['--target', 'beta', '--list']);
  assert.equal(preview.code, 0, preview.output);
  assert.match(preview.output, /Total: 3 tests in/);
  assert.deepEqual(paths, []);
  await assert.rejects(readdir(join(root, 'reports')), { code: 'ENOENT' });
}));

test('URL and profile override selected project settings; config file paths use caller working directory', () => fixture(async ({ root, paths }) => {
  const relativeConfig = `${root.slice(tmpdir().length + 1)}/qualityharbor.config.json`;
  const preview = await run(root, ['http://127.0.0.1:9', '--config', relativeConfig, '--target=alpha', '--profile=generic', '--list'], { TARGET_URL: 'not a URL', HF_EMAIL: 'unrelated-account' });
  assert.equal(preview.code, 0, preview.output);
  assert.match(preview.output, /Target: http:\/\/127.0.0.1:9.*project: alpha.*profile: generic/);
  assert.match(preview.output, /Total: 3 tests in/);
  assert.deepEqual(paths, []);
}));

test('success, repeat, failure and skipped checks retain independent reports and sanitized summaries', { timeout: 60000 }, () => fixture(async ({ root, paths, failHealth }) => {
  const flags = ['--target=alpha', '--project=hireflow-api'];
  const success = await run(root, flags, { PLAYWRIGHT_JSON_OUTPUT_FILE: join(root, 'forbidden.json'), PLAYWRIGHT_HTML_OUTPUT_DIR: join(root, 'forbidden-html') });
  assert.equal(success.code, 0, success.output);
  const first = await result(root, success.output);
  assert.equal(first.summary.status, 'passed');
  assert.equal(first.summary.counts.total, 16);
  assert.equal(first.summary.counts.passed, 9);
  assert.equal(first.summary.counts.skipped, 7);
  assert.equal(first.metadata.project.id, 'alpha');
  assert.equal(first.metadata.allowWrites, false);
  assert.equal(first.metadata.selection.filtered, true);
  for (const file of ['html/index.html', 'results.json', 'junit.xml']) await readFile(join(first.path, file));
  await assert.rejects(readFile(join(root, 'forbidden.json')), { code: 'ENOENT' });
  const before = await readFile(join(first.path, 'summary.json'), 'utf8');

  const repeat = await run(root, [...flags, '--grep=A01']);
  assert.equal(repeat.code, 0, repeat.output);
  const second = await result(root, repeat.output);
  assert.notEqual(first.path, second.path);
  assert.equal(second.summary.counts.passed, 1);
  assert.equal(await readFile(join(first.path, 'summary.json'), 'utf8'), before);

  failHealth();
  const failed = await run(root, [...flags, '--grep=A01']);
  assert.equal(failed.code, 1, failed.output);
  const third = await result(root, failed.output);
  assert.equal(third.summary.status, 'failed');
  assert.equal(third.summary.counts.failed, 1);
  assert.equal(third.summary.globalErrorCount, 0);
  assert.equal(await readFile(join(first.path, 'summary.json'), 'utf8'), before);
  const latest = JSON.parse(await readFile(join(root, 'reports', 'latest.json'), 'utf8'));
  assert.equal(latest.runId, third.metadata.runId);
  assert.equal(latest.status, 'failed');
  assert.ok(paths.every(([method]) => method === 'GET'));
}));

test('startup and selection errors do not pretend test coverage passed', { timeout: 30000 }, () => fixture(async ({ root }) => {
  const bad = await run(root, ['--target=alpha', '--project=missing']);
  assert.equal(bad.code, 1, bad.output);
  const saved = await result(root, bad.output);
  assert.ok(['failed', 'runner-error'].includes(saved.summary.status));
  assert.ok(saved.summary.counts?.passed === 0 || saved.summary.counts === undefined);
  const unknown = await run(root, ['--target=unknown', '--list']);
  assert.equal(unknown.code, 1, unknown.output);
  assert.match(unknown.output, /Unknown target/);
}));

for (const flag of ['--reporter=list', '--output=/tmp/elsewhere', '--ui', '-c=other.config.ts', '-cother.config.ts', '-xcother.config.ts', '--tsconfig=other.json', '--last-failed', '--trace=on']) {
  test(`tracked runs reject output or lifecycle override ${flag}`, () => fixture(async ({ root, paths }) => {
    const output = await run(root, ['--target=alpha', flag]);
    assert.equal(output.code, 1, output.output);
    assert.match(output.output, /not supported by the tracked runner/);
    assert.deepEqual(paths, []);
  }));
}

test('terminated runs retain an interrupted summary without claiming success', { timeout: 30000 }, () => fixture(async ({ root, hangHealth, healthRequest }) => {
  hangHealth();
  let child;
  const completion = run(root, ['--target=alpha', '--project=hireflow-api', '--grep=A01'], {}, value => { child = value; });
  await healthRequest;
  child.kill('SIGTERM');
  const stopped = await completion;
  assert.equal(stopped.code, 143, stopped.output);
  const saved = await result(root, stopped.output);
  assert.equal(saved.summary.status, 'interrupted');
  assert.equal(saved.summary.counts?.passed ?? 0, 0);
}));

test('concurrent targets keep separate reports and a valid completed-run pointer', { timeout: 30000 }, () => fixture(async ({ root }) => {
  const flags = ['--project=hireflow-api', '--grep=A01'];
  const results = await Promise.all([
    run(root, ['--target=alpha', ...flags]),
    run(root, ['--target=beta', '--profile=hireflow', '--project=hireflow-api']),
  ]);
  for (const output of results) assert.equal(output.code, 0, output.output);
  const saved = await Promise.all(results.map(output => result(root, output.output)));
  assert.notEqual(saved[0].path, saved[1].path);
  assert.deepEqual(saved.map(item => item.metadata.project.id).sort(), ['alpha', 'beta']);
  const latest = JSON.parse(await readFile(join(root, 'reports/latest.json'), 'utf8'));
  assert.ok(saved.some(item => item.metadata.runId === latest.runId));
  assert.equal(latest.status, 'passed');
}));
