export const staffRoles = ['admin', 'hr', 'manager', 'interviewer', 'it'];
const envNames = {
  admin: 'ADMIN', hr: 'HR', manager: 'MANAGER', interviewer: 'INTERVIEWER',
  it: 'IT',
};

export function roleCredentials(role, env = process.env) {
  const name = envNames[role];
  if (!name) throw new Error('Unknown configured staff role. Provide explicit credentials for synthetic actors.');
  // The existing administrator variables remain the default for compatibility.
  if (role === 'admin' && env.HF_ADMIN_EMAIL === undefined && env.HF_ADMIN_PASSWORD === undefined) {
    return { email: env.HF_EMAIL ?? '', password: env.HF_PASSWORD ?? '' };
  }
  return { email: env[`HF_${name}_EMAIL`] ?? '', password: env[`HF_${name}_PASSWORD`] ?? '' };
}

export function hasRoleCredentials(roles, env = process.env) {
  return roles.every(role => {
    const { email, password } = roleCredentials(role, env);
    return Boolean(email && password);
  });
}

export function redactRoleValue(value, secrets = new Set()) {
  const clean = (v, key = '') => {
    if (/token|password|authorization|secret|fileUrl/i.test(key)) return '[REDACTED]';
    if (Array.isArray(v)) return v.map(item => clean(item));
    if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, clean(x, k)]));
    if (typeof v !== 'string') return v;
    for (const secret of secrets) if (secret) v = v.replaceAll(secret, '[REDACTED]');
    return v.replace(/(\/portal\/(?:offers?|onboardings?|prescreen|interviews?)\/)[^/?\s"']+/g, '$1[REDACTED]');
  };
  return clean(value);
}
