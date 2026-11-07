import path from 'node:path';

/**
 * @typedef {object} RunMetadata
 * @property {1} schemaVersion
 * @property {string} runId
 * @property {{id: string, name: string}} project
 * @property {string} targetURL
 * @property {string} profile
 * @property {'all' | 'smoke'} suite
 * @property {boolean} allowWrites
 * @property {string} startedAt
 * @property {{node: string, playwright: string}} versions
 * @property {{filtered: boolean}} selection
 */

/** @param {number} value */
function duration(value) {
  return Number.isFinite(value) && value > 0 ? value : 0;
}

/**
 * Keep the aggregate useful without copying configuration, credentials, errors,
 * console output, attachments, or arbitrary metadata into a second report.
 *
 * @param {object} input
 * @param {RunMetadata} input.metadata
 * @param {import('@playwright/test/reporter').TestCase[]} input.tests
 * @param {import('@playwright/test/reporter').FullResult} input.result
 * @param {string} input.rootDir Directory relative to which test files are shown.
 * @param {number} [input.globalErrorCount] Reporter onError events, not test failures.
 */
export function buildRunSummary({ metadata, tests, result, rootDir, globalErrorCount = 0 }) {
  const counts = { total: tests.length, passed: 0, failed: 0, skipped: 0, flaky: 0, notRun: 0 };
  const entries = tests.map(test => {
    const lastResult = test.results.at(-1);
    const outcome = lastResult ? test.outcome() : 'notRun';
    const status = lastResult?.status ?? 'notRun';

    if (!lastResult) {
      counts.notRun += 1;
    } else if (outcome === 'flaky') {
      counts.flaky += 1;
    } else if (outcome === 'expected') {
      // An expected failure is successful coverage, not a failed run.
      counts.passed += 1;
    } else if (outcome === 'unexpected') {
      counts.failed += 1;
    } else if (test.expectedStatus === 'skipped' && status === 'skipped') {
      counts.skipped += 1;
    } else if (status === 'interrupted' && lastResult.workerIndex !== -1) {
      // Playwright's outcome() returns "skipped" for an interrupted attempt.
      // Preserve that outcome below, but do not count an interrupted test as
      // an intentional skip. The run status tells why it did not complete.
      counts.failed += 1;
    } else {
      // Serial-suite/setup failures and stop-before-start placeholders are not
      // intentional skips. Do not imply these checks executed successfully.
      counts.notRun += 1;
    }

    const titles = [test.title];
    for (let suite = test.parent; suite; suite = suite.parent) {
      if (suite.type === 'describe') titles.unshift(suite.title);
    }

    return {
      project: test.parent.project()?.name ?? '',
      title: titles.join(' › '),
      file: path.relative(rootDir, test.location.file).split(path.sep).join('/'),
      line: test.location.line,
      outcome,
      status,
      durationMs: test.results.reduce((total, attempt) => total + duration(attempt.duration), 0),
    };
  });

  return {
    schemaVersion: 1,
    runId: metadata.runId,
    project: { id: metadata.project.id, name: metadata.project.name },
    targetURL: metadata.targetURL,
    profile: metadata.profile,
    suite: metadata.suite,
    allowWrites: metadata.allowWrites,
    startedAt: metadata.startedAt,
    versions: { node: metadata.versions.node, playwright: metadata.versions.playwright },
    selection: { filtered: metadata.selection.filtered },
    finishedAt: new Date(result.startTime.getTime() + duration(result.duration)).toISOString(),
    durationMs: duration(result.duration),
    status: result.status,
    counts,
    globalErrorCount,
    reports: { html: 'html/index.html', json: 'results.json', junit: 'junit.xml' },
    tests: entries,
  };
}
