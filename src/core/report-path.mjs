import { readFile, access } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';

export async function findHTMLReport(root, supplied) {
  let report;
  if (supplied) {
    const path = resolve(supplied);
    report = path.endsWith(`${sep}html`) ? path : join(path, 'html');
  } else {
    let pointer;
    try { pointer = await readFile(join(root, 'reports', 'latest.json'), 'utf8'); }
    catch (error) {
      if (error.code !== 'ENOENT') throw new Error('Cannot read the latest run pointer.');
    }
    if (pointer) {
      let latest;
      try { latest = JSON.parse(pointer); } catch { throw new Error('The latest run pointer is invalid. Pass a saved run directory explicitly.'); }
      if (latest.schemaVersion !== 1 || typeof latest.reportDir !== 'string' || isAbsolute(latest.reportDir)) throw new Error('The latest run pointer is invalid.');
      const runs = join(root, 'reports', 'runs');
      const run = resolve(root, 'reports', latest.reportDir);
      const inside = relative(runs, run);
      if (!inside || inside === '..' || inside.startsWith(`..${sep}`) || isAbsolute(inside)) throw new Error('The latest run pointer must stay within reports/runs.');
      report = join(run, 'html');
    } else report = join(root, 'reports', 'html');
  }
  try { await access(join(report, 'index.html')); }
  catch { throw new Error('This run has no HTML report. Check its summary.json, or pass an earlier run directory to npm run report -- <run-directory>.'); }
  return report;
}
