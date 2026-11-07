import { test } from 'node:test';
import assert from 'node:assert/strict';
import { roleCredentials, hasRoleCredentials, redactRoleValue, staffRoles } from '../../projects/hireflow/helpers/role-credentials.mjs';

test('role credentials are explicit with a compatible administrator fallback', () => {
  const env = { HF_EMAIL: 'admin@example.test', HF_PASSWORD: 'synthetic-password', HF_HR_EMAIL: 'hr@example.test', HF_HR_PASSWORD: 'synthetic-hr' };
  assert.deepEqual(roleCredentials('admin', env), { email: env.HF_EMAIL, password: env.HF_PASSWORD });
  assert.equal(hasRoleCredentials(['admin', 'hr'], env), true);
  assert.equal(hasRoleCredentials(staffRoles, env), false);
  assert.equal(roleCredentials('admin', { ...env, HF_ADMIN_EMAIL: 'other@example.test' }).password, '');
  assert.throws(() => roleCredentials('unknown', env), /Unknown configured staff role/);
});

test('role diagnostics redact nested secrets, known values and portal credentials', () => {
  const clean = redactRoleValue({ accessToken: 'one', child: { initialPassword: 'two' }, detail: 'known-secret /portal/onboardings/opaque-value/documents' }, new Set(['known-secret']));
  assert.deepEqual(clean, { accessToken: '[REDACTED]', child: { initialPassword: '[REDACTED]' }, detail: '[REDACTED] /portal/onboardings/[REDACTED]/documents' });
});
