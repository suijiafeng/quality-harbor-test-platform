import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { FullConfig, FullResult, Reporter, Suite } from '@playwright/test/reporter';
import { buildRunSummary } from '../core/run-summary.mjs';
import type { RunMetadata } from '../core/run-summary.mjs';

export default class RunSummaryReporter implements Reporter {
  private readonly runDir = process.env.QH_RUN_DIR;
  private rootDir = process.cwd();
  private suite?: Suite;
  private globalErrorCount = 0;

  printsToStdio() {
    return false;
  }

  onBegin(config: FullConfig, suite: Suite) {
    this.rootDir = config.configFile ? path.dirname(config.configFile) : config.rootDir;
    this.suite = suite;
  }

  onError() {
    this.globalErrorCount += 1;
  }

  async onEnd(result: FullResult) {
    // Direct `playwright test` runs have no QualityHarbor run directory.
    if (!this.runDir) return;
    try {
      const metadata: RunMetadata = JSON.parse(await readFile(path.join(this.runDir, 'run.json'), 'utf8'));
      const summary = buildRunSummary({
        metadata,
        tests: this.suite?.allTests() ?? [],
        result,
        rootDir: this.rootDir,
        globalErrorCount: this.globalErrorCount,
      });
      await writeFile(path.join(this.runDir, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
    } catch {
      // Never surface a raw filesystem error or metadata value. The CLI checks
      // summary.json and records a runner-error fallback if it is missing.
      console.error('QualityHarbor could not write the run summary.');
    }
  }
}
