import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateBaseURL, assertWriteTarget } from '../core/target.mjs';
import { parseOptions } from '../core/cli-options.mjs';
import { loadProjectConfig, selectProject, validateProfile } from '../core/project-config.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const args = process.argv.slice(2);
const help = `Usage: npm test -- <application-url> [--profile=auto|hireflow|generic] [--smoke] [--allow-writes] [Playwright filters]
       npm test -- --target=<project-id> [--config=<json-file>]
       npm test -- --list-targets [--config=<json-file>]
Example: npm test -- http://localhost:5173
URL and --profile override the selected project's settings. --smoke narrows its suite.
Default: auto-detected read-only checks; optional HF_EMAIL / HF_PASSWORD enable HireFlow authenticated checks.
--allow-writes is ONLY for a disposable local database and requires HF_TEST_ENV=disposable.
Each execution keeps its own reports/runs/<project>/<run-id>/ directory. --list only discovers tests.
The target application must already be running and reachable from this machine.
No cloning, launching or modifying application source code is performed.`;
if (args.includes('--help') || args.includes('-h')) { console.log(help); process.exit(0); }

async function launch(passThrough, env) {
  const runner = fileURLToPath(new URL('../../node_modules/@playwright/test/cli.js', import.meta.url));
  const child = spawn(process.execPath, [runner, 'test', ...passThrough], { cwd: root, stdio: 'inherit', env });
  let signal;
  const onInterrupt = () => { signal = 'SIGINT'; child.kill('SIGINT'); };
  const onTerminate = () => { signal = 'SIGTERM'; child.kill('SIGTERM'); };
  process.on('SIGINT', onInterrupt);
  process.on('SIGTERM', onTerminate);
  try {
    return await new Promise(resolveExit => {
      child.once('error', () => resolveExit(1));
      child.once('close', (code, childSignal) => {
        const stop = signal ?? childSignal;
        resolveExit(stop === 'SIGINT' ? 130 : stop === 'SIGTERM' ? 143 : code ?? 1);
      });
    });
  } finally {
    process.off('SIGINT', onInterrupt);
    process.off('SIGTERM', onTerminate);
  }
}

try {
  const options = parseOptions(args);
  const configPath = options.values['--config'];
  const targetId = options.values['--target'];
  let project;
  if (configPath || targetId || options.flags.has('--list-targets')) {
    const config = await loadProjectConfig(configPath ? resolve(configPath) : join(root, 'qualityharbor.config.json'));
    if (options.flags.has('--list-targets')) {
      for (const item of Object.values(config.projects)) console.log(`${item.id}${item.id === config.defaultProject ? ' (default)' : ''} | ${item.name} | ${item.url} | ${item.profile} | ${item.suite}`);
      process.exit(0);
    }
    project = selectProject(config, targetId);
  }
  const raw = options.url ?? project?.url ?? process.env.TARGET_URL;
  if (!raw) throw new Error(help);
  const baseURL = validateBaseURL(raw);
  let profile = validateProfile(options.values['--profile'] ?? project?.profile ?? 'auto');
  const allowWrites = options.flags.has('--allow-writes');
  const smoke = options.flags.has('--smoke') || project?.suite === 'smoke';
  if (smoke && allowWrites) throw new Error('--smoke does not permit write tests.');
  if (allowWrites) assertWriteTarget(baseURL, process.env.HF_TEST_ENV === 'disposable');
  const listOnly = options.passThrough.includes('--list');
  if (smoke && options.passThrough.some(arg => arg.split('=')[0] === '--grep' || /^-g(?:[^-]|$)/.test(arg))) throw new Error('The smoke suite already selects its checks. Use --project or file filters, or use the all suite with --grep.');
  // Runner-owned output and interactive modes cannot bypass per-run result tracking.
  for (const arg of options.passThrough) {
    const flag = arg.split('=')[0];
    if ((/^-[^-]/.test(arg) && !['-g', '-j', '-x', '-u'].includes(arg)) || (!listOnly && ['--reporter', '--output'].includes(flag)) || ['--tsconfig', '--last-failed', '--trace', '--ui', '--ui-host', '--ui-port'].includes(flag)) {
      throw new Error(`${flag} is not supported by the tracked runner. Use --list for discovery and npm run report for the saved HTML report.`);
    }
  }
  if (profile === 'auto') {
    try {
      const response = await fetch(`${baseURL}/api/health`, { redirect: 'manual', signal: AbortSignal.timeout(5000) });
      const body = response.ok ? await response.json() : null;
      profile = body?.service === 'hireflow-api' && body?.status === 'ok' ? 'hireflow' : 'generic';
    } catch { profile = 'generic'; }
  }
  if (allowWrites && profile !== 'hireflow') throw new Error('Write tests require the hireflow profile; generic checks are always read-only.');
  if (profile === 'hireflow' && Boolean(process.env.HF_EMAIL) !== Boolean(process.env.HF_PASSWORD)) throw new Error('Provide both HF_EMAIL and HF_PASSWORD or neither.');
  if (allowWrites && (!process.env.HF_EMAIL || !process.env.HF_PASSWORD)) throw new Error('Write tests need HF_EMAIL and HF_PASSWORD for a dedicated administrator test account.');
  console.log(`Target: ${baseURL} | project: ${project?.id ?? 'direct'} | profile: ${profile} | business writes: ${allowWrites ? 'ENABLED for disposable local DB' : 'blocked'}`);
  const passThrough = [...options.passThrough];
  if (smoke) passThrough.push('--grep=G0|A01|A02|A03|U01|U02|U03|U04|U05');
  const env = { ...process.env, TARGET_URL: baseURL, TEST_PROFILE: profile, HF_ALLOW_WRITES: allowWrites ? '1' : '0', QH_RUN_DIR: '' };
  // Reporter output paths must not be redirected by an inherited CI environment.
  for (const key of Object.keys(env)) if (/^PLAYWRIGHT_(HTML|JSON|JUNIT)_/.test(key)) delete env[key];
  if (listOnly) {
    if (!passThrough.some(arg => arg === '--reporter' || arg.startsWith('--reporter='))) passThrough.push('--reporter=list');
    process.exitCode = await launch(passThrough, env);
  } else {
    const startedAt = new Date().toISOString();
    const runId = `${startedAt.replace(/[-:.]/g, '')}-${randomUUID().slice(0, 8)}`;
    const runDir = join(root, 'reports', 'runs', project?.id ?? 'direct', runId);
    const playwright = JSON.parse(await readFile(join(root, 'node_modules', '@playwright', 'test', 'package.json'), 'utf8'));
    const metadata = {
      schemaVersion: 1, runId, project: { id: project?.id ?? 'direct', name: project?.name ?? 'Direct URL' },
      targetURL: baseURL, profile, suite: smoke ? 'smoke' : 'all', allowWrites, startedAt,
      versions: { node: process.version, playwright: playwright.version },
      // Avoid storing arbitrary CLI values or environment variables in the summary.
      selection: { filtered: options.passThrough.length > 0 },
    };
    await mkdir(runDir, { recursive: true });
    await writeFile(join(runDir, 'run.json'), JSON.stringify(metadata, null, 2) + '\n');
    console.log(`Reports: ${relative(root, runDir)}`);
    const code = await launch(passThrough, { ...env, QH_RUN_DIR: runDir });
    let summary;
    try { summary = JSON.parse(await readFile(join(runDir, 'summary.json'), 'utf8')); }
    catch {
      summary = { ...metadata, finishedAt: new Date().toISOString(), status: code === 130 || code === 143 ? 'interrupted' : 'runner-error', exitCode: code, message: 'The runner ended without a complete test summary. Inspect this run before interpreting test coverage.' };
      await writeFile(join(runDir, 'summary.json'), JSON.stringify(summary, null, 2) + '\n');
    }
    // Only this small pointer changes. Earlier run files are never replaced.
    const latest = { schemaVersion: 1, runId, project: metadata.project, status: summary.status, reportDir: relative(join(root, 'reports'), runDir).split('\\').join('/') };
    const latestTemp = join(root, 'reports', `.latest-${runId}.tmp`);
    await writeFile(latestTemp, JSON.stringify(latest, null, 2) + '\n');
    await rename(latestTemp, join(root, 'reports', 'latest.json'));
    console.log(`Summary: ${relative(root, join(runDir, 'summary.json'))} | status: ${summary.status}`);
    process.exitCode = code || (summary.status === 'runner-error' ? 1 : 0);
  }
} catch (error) { console.error(error.message); process.exitCode = 1; }
