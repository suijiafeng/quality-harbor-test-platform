import { test, expect, writesEnabled, unique } from '../support/fixtures.js';

test.describe('explicitly enabled disposable-local workflows', () => {
  test.skip(!writesEnabled, 'Writes are off. Requires --allow-writes, HF_TEST_ENV=disposable and a loopback URL.');
  test.beforeEach(async ({ writeGuard }) => { void writeGuard; });
  test('W01 candidate create, search, duplicate protection, update and delete', async ({ admin }) => {
    const name = unique('candidate');
    const email = `${name.toLowerCase()}@example.test`;
    const created = await admin.post('/api/candidates', { data: { name, email, tags: ['Playwright'], source: 'isolated automated test' } });
    expect(created.status()).toBe(201);
    const candidate = await created.json();
    try {
      const list = await admin.get('/api/candidates', { params: { keyword: name } });
      expect((await list.json()).items.map((c: { id: string }) => c.id)).toContain(candidate.id);
      const duplicate = await admin.post('/api/candidates', { data: { name: unique('duplicate'), email } });
      expect(duplicate.status()).toBe(409);
      const updated = await admin.patch(`/api/candidates/${candidate.id}`, { data: { name: `${name}-updated` } });
      expect(updated.status()).toBe(200);
      expect(await updated.json()).toMatchObject({ id: candidate.id, name: `${name}-updated` });
    } finally {
      expect((await admin.delete(`/api/candidates/${candidate.id}`)).status()).toBe(200);
    }
    expect((await admin.get(`/api/candidates/${candidate.id}`)).status()).toBe(404);
  });
  test('W02 job create, default stages, update and delete', async ({ admin }) => {
    const departments = await admin.get('/api/departments');
    expect(departments.status()).toBe(200);
    const department = (await departments.json())[0];
    expect(department?.id, 'Seed at least one test department').toBeTruthy();
    const title = unique('job');
    const created = await admin.post('/api/jobs', { data: { title, departmentId: department.id, headcount: 2 } });
    expect(created.status()).toBe(201);
    const job = await created.json();
    try {
      expect(job).toMatchObject({ title, headcount: 2, status: 'OPEN' });
      expect(job.stages.map((s: { name: string }) => s.name)).toEqual(['简历初筛', '一面', '二面', 'Offer', '待入职', '已入职']);
      const updated = await admin.patch(`/api/jobs/${job.id}`, { data: { status: 'CLOSED' } });
      expect(updated.status()).toBe(200);
      expect(await updated.json()).toMatchObject({ status: 'CLOSED' });
    } finally { expect((await admin.delete(`/api/jobs/${job.id}`)).status()).toBe(200); }
    expect((await admin.get(`/api/jobs/${job.id}`)).status()).toBe(404);
  });
  test('W03 recruitment pipeline guards and rejection/reactivation lifecycle', async ({ admin }, testInfo) => {
    // Application records intentionally have no delete endpoint. This workflow belongs only in a disposable database.
    const departmentResponse = await admin.get('/api/departments');
    expect(departmentResponse.status()).toBe(200);
    const departments = await departmentResponse.json();
    const createdJob = await admin.post('/api/jobs', { data: { title: unique('pipeline'), departmentId: departments[0].id } });
    expect(createdJob.status()).toBe(201);
    const job = await createdJob.json();
    const createdCandidate = await admin.post('/api/candidates', { data: { name: unique('pipeline-person'), tags: ['TypeScript'] } });
    expect(createdCandidate.status()).toBe(201);
    const candidate = await createdCandidate.json();
    await testInfo.attach('created-test-ids', { body: JSON.stringify({ jobId: job.id, candidateId: candidate.id }), contentType: 'application/json' });
    const initial = await admin.post('/api/applications', { data: { jobId: job.id, candidateId: candidate.id } });
    expect(initial.status()).toBe(201);
    const application = await initial.json();
    expect(application.stageId).toBe(job.stages[0].id);
    const duplicate = await admin.post('/api/applications', { data: { jobId: job.id, candidateId: candidate.id } });
    expect(duplicate.status()).toBe(409);
    const moved = await admin.patch(`/api/applications/${application.id}/stage`, { data: { stageId: job.stages[1].id, expectedVersion: application.version } });
    expect(moved.status()).toBe(200);
    const current = await moved.json();
    expect(current.version).toBe(application.version + 1);
    const stale = await admin.patch(`/api/applications/${application.id}/stage`, { data: { stageId: job.stages[2].id, expectedVersion: application.version } });
    expect(stale.status()).toBe(409);
    const noReason = await admin.patch(`/api/applications/${application.id}/stage`, { data: { stageId: job.stages[0].id } });
    expect(noReason.status()).toBe(400);
    const back = await admin.patch(`/api/applications/${application.id}/stage`, { data: { stageId: job.stages[0].id, reason: '自动化回归验证' } });
    expect(back.status()).toBe(200);
    for (const name of ['待入职', '已入职']) {
      const response = await admin.patch(`/api/applications/${application.id}/stage`, { data: { stageId: job.stages.find((s: { name: string }) => s.name === name).id } });
      expect(response.status()).toBe(400);
    }
    const rejected = await admin.post(`/api/applications/${application.id}/reject`, { data: { reason: '其他', note: 'isolated regression fixture' } });
    expect(rejected.status()).toBe(201);
    expect(await rejected.json()).toMatchObject({ status: 'REJECTED' });
    const rejectedMove = await admin.patch(`/api/applications/${application.id}/stage`, { data: { stageId: job.stages[1].id } });
    expect(rejectedMove.status()).toBe(400);
    const closedBoard = await admin.get(`/api/jobs/${job.id}/board`);
    expect(closedBoard.status()).toBe(200);
    const board = await closedBoard.json();
    expect(board.closedCount).toBe(1);
    expect(board.columns.flatMap((c: { applications: unknown[] }) => c.applications)).toHaveLength(0);
    const revived = await admin.post('/api/applications', { data: { jobId: job.id, candidateId: candidate.id } });
    expect(revived.status()).toBe(201);
    expect(await revived.json()).toMatchObject({ id: application.id, status: 'ACTIVE', revived: true });
    const linkedDelete = await admin.delete(`/api/jobs/${job.id}`);
    expect(linkedDelete.status()).toBe(400);
  });
});
