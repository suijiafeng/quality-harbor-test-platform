import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { buildRunSummary } from '../../src/core/run-summary.mjs';
import RunSummaryReporter from '../../src/reporters/run-summary.ts';

const rootDir = path.join(os.tmpdir(), 'qualityharbor-source');
const metadata = {
  schemaVersion: 1,
  runId: '20260102-example',
  project: { id: 'example', name: 'Example' },
  targetURL: 'http://127.0.0.1:3000',
  profile: 'generic',
  suite: 'smoke',
  allowWrites: false,
  startedAt: '2026-01-02T03:04:05.000Z',
  versions: { node: 'v24.0.0', playwright: '1.56.1' },
  selection: { filtered: false },
};
const result = { status: 'passed', startTime: new Date(metadata.startedAt), duration: 250 };

function testCase({ outcome = 'expected', statuses = ['passed'], expectedStatus = 'passed', workerIndex = 0, title = 'works' } = {}) {
  const project = { type: 'project', title: 'generic-chromium', project: () => ({ name: 'generic-chromium' }) };
  const file = { type: 'file', title: 'example.spec.ts', parent: project, project: project.project };
  const parent = { type: 'describe', title: 'page', parent: file, project: project.project };
  return {
    title, parent, expectedStatus,
    location: { file: path.join(rootDir, 'projects/generic/example.spec.ts'), line: 12, column: 3 },
    results: statuses.map((status, index) => ({ status, duration: 10 + index, workerIndex })),
    outcome: () => outcome,
  };
}

function summary(tests, options = {}) {
  return buildRunSummary({ metadata, tests, result, rootDir, ...options });
}

test('summary uses a stable allowlist and relative report and test paths', () => {
  const input = testCase();
  input.results[0].errors = [{ message: 'synthetic-secret' }];
  input.results[0].stdout = ['synthetic-secret'];
  input.results[0].attachments = [{ body: Buffer.from('synthetic-secret') }];
  const actual = summary([input], {
    metadata: {
      ...metadata, password: 'synthetic-secret', env: { HF_PASSWORD: 'synthetic-secret' },
      project: { ...metadata.project, password: 'synthetic-secret' },
      selection: { filtered: true, raw: 'synthetic-secret', playwrightArgs: ['--grep=synthetic-secret'] },
      versions: { ...metadata.versions, token: 'synthetic-secret' },
    },
  });
  assert.deepEqual(actual, {
    ...metadata,
    selection: { filtered: true },
    finishedAt: '2026-01-02T03:04:05.250Z',
    durationMs: 250,
    status: 'passed',
    counts: { total: 1, passed: 1, failed: 0, skipped: 0, flaky: 0, notRun: 0 },
    globalErrorCount: 0,
    reports: { html: 'html/index.html', json: 'results.json', junit: 'junit.xml' },
    tests: [{ project: 'generic-chromium', title: 'page › works', file: 'projects/generic/example.spec.ts', line: 12, outcome: 'expected', status: 'passed', durationMs: 10 }],
  });
  assert.equal(JSON.stringify(actual).includes('synthetic-secret'), false);
});

test('counts expected failures, unexpected passes, retries, skips, and missing results correctly', () => {
  const actual = summary([
    testCase(),
    testCase({ expectedStatus: 'failed', statuses: ['failed'] }),
    testCase({ expectedStatus: 'failed', statuses: ['passed'], outcome: 'unexpected' }),
    testCase({ statuses: ['failed'], outcome: 'unexpected' }),
    testCase({ statuses: ['failed', 'passed'], outcome: 'flaky' }),
    testCase({ statuses: ['skipped'], outcome: 'skipped', expectedStatus: 'skipped', workerIndex: -1 }),
    testCase({ statuses: [], outcome: 'skipped' }),
    testCase({ statuses: ['skipped'], outcome: 'skipped' }),
  ]);
  assert.deepEqual(actual.counts, { total: 8, passed: 2, failed: 2, skipped: 1, flaky: 1, notRun: 2 });
  assert.equal(actual.tests[1].outcome, 'expected');
  assert.equal(actual.tests[1].status, 'failed');
  assert.equal(actual.tests[4].durationMs, 21);
  assert.equal(actual.tests[6].outcome, 'notRun');
  assert.equal(actual.tests[6].status, 'notRun');
  assert.equal(actual.tests[6].durationMs, 0);
  assert.equal(actual.globalErrorCount, 0);
});

test('missing expected-skip results remain notRun', () => {
  assert.equal(summary([testCase({ statuses: [], expectedStatus: 'skipped' })]).counts.notRun, 1);
});

test('distinguishes interrupted attempts from tests stopped before they start', () => {
  const actual = summary([
    testCase({ statuses: ['interrupted'], outcome: 'skipped' }),
    testCase({ statuses: ['interrupted'], outcome: 'skipped', workerIndex: -1 }),
  ], { result: { ...result, status: 'interrupted' } });
  assert.equal(actual.status, 'interrupted');
  assert.equal(actual.counts.failed, 1);
  assert.equal(actual.counts.notRun, 1);
  assert.equal(actual.counts.skipped, 0);
  assert.equal(actual.tests[0].status, 'interrupted');
});

test('global errors are counted separately from test failures, including pre-suite errors', () => {
  const actual = summary([], { globalErrorCount: 2, result: { ...result, status: 'failed' } });
  assert.equal(actual.globalErrorCount, 2);
  assert.equal(actual.counts.failed, 0);
  assert.equal(actual.counts.total, 0);
  assert.equal(actual.status, 'failed');
});

for (const status of ['passed', 'failed', 'timedout', 'interrupted']) {
  test(`preserves full-run ${status} status`, () => {
    assert.equal(summary([], { result: { ...result, status } }).status, status);
  });
}

test('reporter writes the summary onEnd and counts only global errors', async () => {
  const runDir = await mkdtemp(path.join(os.tmpdir(), 'qh-summary-'));
  const original = process.env.QH_RUN_DIR;
  try {
    process.env.QH_RUN_DIR = runDir;
    await writeFile(path.join(runDir, 'run.json'), JSON.stringify(metadata));
    const reporter = new RunSummaryReporter();
    reporter.onBegin({ configFile: path.join(rootDir, 'playwright.config.ts'), rootDir }, { allTests: () => [testCase()] });
    reporter.onError({ message: 'synthetic-secret' });
    await reporter.onEnd({ ...result, status: 'failed' });
    const actual = JSON.parse(await readFile(path.join(runDir, 'summary.json'), 'utf8'));
    assert.equal(actual.globalErrorCount, 1);
    assert.equal(actual.counts.passed, 1);
    assert.equal(actual.status, 'failed');
    assert.equal(JSON.stringify(actual).includes('synthetic-secret'), false);
    assert.equal(reporter.printsToStdio(), false);
  } finally {
    if (original === undefined) delete process.env.QH_RUN_DIR;
    else process.env.QH_RUN_DIR = original;
    await rm(runDir, { recursive: true, force: true });
  }
});

test('reporter handles errors before onBegin without including their contents', async () => {
  const runDir = await mkdtemp(path.join(os.tmpdir(), 'qh-summary-'));
  const original = process.env.QH_RUN_DIR;
  try {
    process.env.QH_RUN_DIR = runDir;
    await writeFile(path.join(runDir, 'run.json'), JSON.stringify(metadata));
    const reporter = new RunSummaryReporter();
    reporter.onError({ message: 'synthetic-secret' });
    await reporter.onEnd({ ...result, status: 'failed' });
    const actual = JSON.parse(await readFile(path.join(runDir, 'summary.json'), 'utf8'));
    assert.equal(actual.globalErrorCount, 1);
    assert.equal(actual.counts.total, 0);
    assert.deepEqual(actual.tests, []);
  } finally {
    if (original === undefined) delete process.env.QH_RUN_DIR;
    else process.env.QH_RUN_DIR = original;
    await rm(runDir, { recursive: true, force: true });
  }
});

test('direct Playwright invocation without QH_RUN_DIR is a no-op', async () => {
  const original = process.env.QH_RUN_DIR;
  try {
    delete process.env.QH_RUN_DIR;
    const reporter = new RunSummaryReporter();
    // Restoring the variable must not change an already constructed reporter.
    process.env.QH_RUN_DIR = '/path/that/does/not/exist';
    await reporter.onEnd(result);
  } finally {
    if (original === undefined) delete process.env.QH_RUN_DIR;
    else process.env.QH_RUN_DIR = original;
  }
});

test('unreadable metadata produces only a generic warning and no summary', async t => {
  const runDir = await mkdtemp(path.join(os.tmpdir(), 'qh-summary-'));
  const original = process.env.QH_RUN_DIR;
  const warnings = [];
  t.mock.method(console, 'error', message => warnings.push(message));
  try {
    process.env.QH_RUN_DIR = runDir;
    await writeFile(path.join(runDir, 'run.json'), '{"synthetic-secret":');
    await new RunSummaryReporter().onEnd(result);
    assert.deepEqual(warnings, ['QualityHarbor could not write the run summary.']);
    assert.deepEqual(await readdir(runDir), ['run.json']);
  } finally {
    if (original === undefined) delete process.env.QH_RUN_DIR;
    else process.env.QH_RUN_DIR = original;
    await rm(runDir, { recursive: true, force: true });
  }
});
