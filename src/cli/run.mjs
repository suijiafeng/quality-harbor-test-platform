import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { validateBaseURL, assertWriteTarget } from '../core/target.mjs';

const args = process.argv.slice(2);
const help = `Usage: npm test -- <application-url> [--profile=auto|hireflow|generic] [--smoke] [--allow-writes] [Playwright options]\nExample: npm test -- http://localhost:5173\nDefault: auto-detected read-only checks; optional HF_EMAIL / HF_PASSWORD enable authenticated checks.\n--allow-writes is ONLY for a disposable local database and requires HF_TEST_ENV=disposable.\nThe target application must already be running and reachable from this machine.\nNo cloning, launching or modifying application source code is performed.`;
if (args.includes('--help') || args.includes('-h')) { console.log(help); process.exit(0); }
try {
  const raw = args.find(a => /^https?:\/\//.test(a)) || process.env.TARGET_URL;
  if (!raw) throw new Error(help);
  const baseURL = validateBaseURL(raw);
  const profileArg = args.find(a => a.startsWith('--profile='));
  let profile = profileArg?.split('=')[1] || 'auto';
  if (!['auto', 'hireflow', 'generic'].includes(profile)) throw new Error('Unknown profile; choose auto, hireflow or generic.');
  const allowWrites = args.includes('--allow-writes');
  const smoke = args.includes('--smoke');
  if (smoke && allowWrites) throw new Error('--smoke does not permit write tests.');
  if (allowWrites) assertWriteTarget(baseURL, process.env.HF_TEST_ENV === 'disposable');
  if (allowWrites && (!process.env.HF_EMAIL || !process.env.HF_PASSWORD)) throw new Error('Write tests need HF_EMAIL and HF_PASSWORD for a dedicated administrator test account.');
  if (Boolean(process.env.HF_EMAIL) !== Boolean(process.env.HF_PASSWORD)) throw new Error('Provide both HF_EMAIL and HF_PASSWORD or neither.');
  if (profile === 'auto') {
    try {
      const response = await fetch(`${baseURL}/api/health`, { redirect: 'manual', signal: AbortSignal.timeout(5000) });
      const body = response.ok ? await response.json() : null;
      profile = body?.service === 'hireflow-api' && body?.status === 'ok' ? 'hireflow' : 'generic';
    } catch { profile = 'generic'; }
  }
  console.log(`Target: ${baseURL} | profile: ${profile} | business writes: ${allowWrites ? 'ENABLED for disposable local DB' : 'blocked'}`);
  const passThrough = args.filter(a => a !== raw && a !== profileArg && a !== '--allow-writes' && a !== '--smoke');
  if (smoke) passThrough.push('--grep=G0|A01|A02|A03|U01|U02|U03|U04|U05');
  const runner = fileURLToPath(new URL('../../node_modules/@playwright/test/cli.js', import.meta.url));
  const root = fileURLToPath(new URL('../../', import.meta.url));
  const p = spawn(process.execPath, [runner, 'test', ...passThrough], { cwd: root, stdio: 'inherit', env: { ...process.env, TARGET_URL: baseURL, TEST_PROFILE: profile, HF_ALLOW_WRITES: allowWrites ? '1' : '0' } });
  p.on('error', err => { console.error(err.message); process.exitCode = 1; });
  p.on('exit', code => { process.exitCode = code ?? 1; });
} catch (error) { console.error(error.message); process.exitCode = 1; }
