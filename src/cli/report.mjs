import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { findHTMLReport } from '../core/report-path.mjs';

const args = process.argv.slice(2);
if (args.includes('--help') || args.includes('-h')) {
  console.log('Usage: npm run report [-- <saved-run-directory>]\nOpens the latest completed run by default. Earlier reports are retained under reports/runs/.');
} else {
  try {
    if (args.length > 1 || args[0]?.startsWith('-')) throw new Error('Provide at most one saved run directory.');
    const root = fileURLToPath(new URL('../../', import.meta.url));
    const report = await findHTMLReport(root, args[0]);
    const runner = fileURLToPath(new URL('../../node_modules/@playwright/test/cli.js', import.meta.url));
    const child = spawn(process.execPath, [runner, 'show-report', report, '--host=127.0.0.1'], { cwd: root, stdio: 'inherit' });
    const interrupt = () => child.kill('SIGINT');
    const terminate = () => child.kill('SIGTERM');
    process.on('SIGINT', interrupt);
    process.on('SIGTERM', terminate);
    child.on('error', () => { console.error('Unable to start the report viewer.'); process.exitCode = 1; });
    child.on('close', (code, signal) => {
      process.off('SIGINT', interrupt);
      process.off('SIGTERM', terminate);
      process.exitCode = code ?? (signal === 'SIGINT' ? 130 : signal === 'SIGTERM' ? 143 : 1);
    });
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
