import { test, expect } from '../support/fixtures.js';
test('A01 API health contract', async ({ request }) => {
  const response = await request.get('/api/health');
  expect(response.status()).toBe(200);
  const health = await response.json();
  expect(health).toMatchObject({ status: 'ok', service: 'hireflow-api' });
  expect(Number.isNaN(Date.parse(health.time))).toBe(false);
});
for (const path of ['auth/profile', 'jobs', 'candidates', 'departments']) {
  test(`A02 anonymous access is rejected: ${path}`, async ({ request }) => {
    const response = await request.get(`/api/${path}`);
    expect(response.status()).toBe(401);
  });
}
for (const portal of ['offers', 'onboardings', 'interviews', 'prescreen']) {
  test(`A03 nonexistent ${portal} token returns 404, not private data`, async ({ request }) => {
    const response = await request.get(`/api/portal/${portal}/qa-invalid-token-do-not-use`);
    expect(response.status()).toBe(404);
    const data = await response.json();
    expect(data).toMatchObject({ statusCode: 404 });
    expect(data).not.toHaveProperty('candidate');
  });
}
