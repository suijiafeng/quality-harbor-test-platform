const valueOptions = new Set(['--config', '--target', '--profile']);
// Preserve required Playwright option values, including URL-shaped grep expressions.
const playwrightValues = new Set(['--browser', '-c', '--grep', '-g', '--global-timeout', '--grep-invert', '--workers', '-j', '--max-failures', '--output', '--project', '--repeat-each', '--reporter', '--retries', '--shard', '--test-list', '--test-list-invert', '--timeout', '--trace', '--tsconfig', '--ui-host', '--ui-port', '--update-source-method']);
const flags = new Set(['--smoke', '--allow-writes', '--list-targets']);

export function parseOptions(args) {
  const result = { passThrough: [], values: {}, flags: new Set(), url: undefined };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const equal = arg.indexOf('=');
    const option = equal === -1 ? arg : arg.slice(0, equal);
    if (valueOptions.has(option)) {
      if (Object.hasOwn(result.values, option)) throw new Error(`${option} may only be provided once.`);
      const value = equal === -1 ? args[++i] : arg.slice(equal + 1);
      if (!value || value.startsWith('-')) throw new Error(`${option} requires a value.`);
      result.values[option] = value;
    } else if (flags.has(option)) {
      if (equal !== -1) throw new Error(`${option} does not accept a value.`);
      result.flags.add(option);
    } else if (equal === -1 && playwrightValues.has(option)) {
      result.passThrough.push(arg);
      if (args[i + 1] !== undefined && !args[i + 1].startsWith('-')) result.passThrough.push(args[++i]);
    } else if (/^https?:\/\//i.test(arg)) {
      if (result.url) throw new Error('Provide only one application URL per run.');
      result.url = arg;
    } else result.passThrough.push(arg);
  }
  return result;
}
