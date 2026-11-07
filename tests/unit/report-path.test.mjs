import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { findHTMLReport } from '../../src/core/report-path.mjs';

async function fixture(fn) {
  const root = await mkdtemp(join(tmpdir(), 'qh-report-'));
  await mkdir(join(root, 'reports'), { recursive: true });
  try { await fn(root); } finally { await rm(root, { recursive: true, force: true }); }
}
async function html(path) { await mkdir(path, { recursive: true }); await writeFile(join(path, 'index.html'), '<title>Test</title>'); }

test('report viewer resolves the latest isolated run and explicit older run', () => fixture(async root => {
  const old = join(root, 'reports', 'runs', 'demo', 'old');
  const current = join(root, 'reports', 'runs', 'demo', 'current');
  await html(join(old, 'html')); await html(join(current, 'html'));
  await writeFile(join(root, 'reports', 'latest.json'), JSON.stringify({ schemaVersion: 1, reportDir: 'runs/demo/current' }));
  assert.equal(await findHTMLReport(root), join(current, 'html'));
  assert.equal(await findHTMLReport(root, old), join(old, 'html'));
  assert.equal(await findHTMLReport(root, join(old, 'html')), join(old, 'html'));
}));
test('legacy reports are available only when no new run pointer exists', () => fixture(async root => {
  const legacy = join(root, 'reports', 'html');
  await html(legacy);
  assert.equal(await findHTMLReport(root), legacy);
  await writeFile(join(root, 'reports', 'latest.json'), JSON.stringify({ schemaVersion: 1, reportDir: 'runs/demo/missing' }));
  await assert.rejects(findHTMLReport(root), /no HTML report/);
}));
for (const value of [
  '{broken',
  JSON.stringify({ schemaVersion: 1, reportDir: '../../../outside' }),
  JSON.stringify({ schemaVersion: 1, reportDir: '/tmp/outside' }),
  JSON.stringify({ schemaVersion: 1, reportDir: 'runs/../../outside' }),
  JSON.stringify({ schemaVersion: 1, reportDir: 'runs' }),
  JSON.stringify({ schemaVersion: 2, reportDir: 'runs/demo/id' }),
]) test('report viewer rejects an invalid or escaping pointer', () => fixture(async root => {
  await writeFile(join(root, 'reports', 'latest.json'), value);
  await assert.rejects(findHTMLReport(root));
}));
