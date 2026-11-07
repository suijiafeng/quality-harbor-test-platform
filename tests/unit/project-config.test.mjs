import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadProjectConfig, selectProject, validateProjectConfig } from '../../src/core/project-config.mjs';
import { parseOptions } from '../../src/core/cli-options.mjs';

const config = (entry = { url: 'http://localhost:5173/' }) => ({ version: 1, defaultProject: 'demo', projects: { demo: entry } });
test('project configuration normalizes URLs and keeps read-only defaults', () => {
  const parsed = validateProjectConfig(config());
  assert.deepEqual(selectProject(parsed), { id: 'demo', name: 'demo', url: 'http://localhost:5173', profile: 'auto', suite: 'all' });
  assert.equal(selectProject(parsed, 'demo'), parsed.projects.demo);
});
test('configuration supports named adapters and smoke suites', () => {
  const parsed = validateProjectConfig(config({ name: '测试应用', url: 'https://example.test', profile: 'generic', suite: 'smoke' }));
  assert.equal(selectProject(parsed).suite, 'smoke');
});
for (const [label, value] of [
  ['version', { ...config(), version: 2 }],
  ['empty projects', { version: 1, projects: {} }],
  ['non-object', []],
  ['array projects', { version: 1, projects: [] }],
  ['missing URL', config({})],
  ['URL credentials', config({ url: 'https://me:secret@example.test' })],
  ['URL path', config({ url: 'https://example.test/login' })],
  ['URL query', config({ url: 'https://example.test?token=secret' })],
  ['writes', config({ url: 'http://localhost', allowWrites: true })],
  ['credentials', config({ url: 'http://localhost', password: 'secret' })],
  ['nested settings', config({ url: 'http://localhost', use: { baseURL: 'https://other.test' } })],
  ['unknown top-level field', { ...config(), env: {} }],
  ['invalid profile', config({ url: 'http://localhost', profile: 'other' })],
  ['invalid suite', config({ url: 'http://localhost', suite: 'isolated-write' })],
  ['path traversal ID', { version: 1, projects: { '../outside': { url: 'http://localhost' } } }],
  ['reserved ID', JSON.parse('{"version":1,"projects":{"__proto__":{"url":"http://localhost"}}}')],
  ['log control name', config({ url: 'http://localhost', name: 'name\nsecret' })],
  ['missing default', { ...config(), defaultProject: 'unknown' }],
]) test(`project configuration rejects ${label}`, () => assert.throws(() => validateProjectConfig(value)));

test('selection rejects unknown and absent target without guessing', () => {
  const parsed = validateProjectConfig({ ...config(), defaultProject: undefined });
  assert.throws(() => selectProject(parsed), /Select a configured project/);
  assert.throws(() => selectProject(parsed, 'unknown'), /Unknown target/);
  assert.throws(() => selectProject(parsed, 'toString'), /Unknown target/);
});
test('JSON errors do not disclose content', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'qh-config-'));
  try {
    const file = join(dir, 'config.json');
    await writeFile(file, '{"password":"private-token",');
    await assert.rejects(loadProjectConfig(file), error => !error.message.includes('private-token') && /valid JSON/.test(error.message));
    await assert.rejects(loadProjectConfig(join(dir, 'missing')), /Cannot read/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
test('CLI accepts equal and spaced values and preserves Playwright filters', () => {
  const parsed = parseOptions(['--target', 'demo', '--config=./projects.json', 'https://example.test', '--profile=generic', '--smoke', '--project=generic-chromium', '--grep', 'G01']);
  assert.equal(parsed.values['--target'], 'demo');
  assert.equal(parsed.values['--config'], './projects.json');
  assert.equal(parsed.url, 'https://example.test');
  assert.ok(parsed.flags.has('--smoke'));
  assert.deepEqual(parsed.passThrough, ['--project=generic-chromium', '--grep', 'G01']);
});
for (const args of [['--target'], ['--profile='], ['--config', '--smoke'], ['--target=a', '--target', 'b'], ['--smoke=false'], ['http://localhost:1', 'http://localhost:2']]) {
  test(`CLI rejects ambiguous arguments ${args.join(' ')}`, () => assert.throws(() => parseOptions(args)));
}

test('URL-shaped Playwright option values cannot replace the target', () => {
  const parsed = parseOptions(['--grep', 'https://example.test', '--target=demo']);
  assert.equal(parsed.url, undefined);
  assert.deepEqual(parsed.passThrough, ['--grep', 'https://example.test']);
});
