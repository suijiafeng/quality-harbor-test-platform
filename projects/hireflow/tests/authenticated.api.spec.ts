import { test, expect, hasCredentials, credentials, login } from '../support/fixtures.js';
test.describe('authenticated read-only checks', () => {
  test.skip(!hasCredentials, 'Set HF_EMAIL and HF_PASSWORD for a dedicated test account.');
  test('A04 login and current profile identify the same user', async ({ request, admin }) => {
    const auth = await login(request);
    const response = await admin.get('/api/auth/profile');
    expect(response.status()).toBe(200);
    expect(await response.json()).toMatchObject({ id: auth.user.id, email: credentials.email });
  });
  for (const resource of ['jobs', 'candidates']) {
    test(`A05 ${resource} pagination and empty keyword filtering`, async ({ admin }) => {
      const response = await admin.get(`/api/${resource}?page=1&pageSize=2`);
      expect(response.status()).toBe(200);
      const list = await response.json();
      expect(list).toMatchObject({ page: 1, pageSize: 2, total: expect.any(Number), items: expect.any(Array) });
      expect(list.items.length).toBeLessThanOrEqual(2);
      const empty = await admin.get(`/api/${resource}`, { params: { keyword: 'qa-no-match-81ab7d51-1de8-42f2' } });
      expect(empty.status()).toBe(200);
      expect(await empty.json()).toMatchObject({ total: 0, items: [] });
    });
  }
  test('A06 invalid pagination fails validation', async ({ admin }) => {
    const response = await admin.get('/api/candidates?page=0&pageSize=0');
    expect(response.status()).toBe(400);
  });
});
