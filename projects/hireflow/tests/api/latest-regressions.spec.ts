import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test, writesEnabled } from '../../fixtures/test.js';
import { RoleSession, hasRoleCredentials } from '../../helpers/role-session.js';
test.describe('latest interview regressions on disposable fixtures', () => {
    test.skip(!writesEnabled || !hasRoleCredentials(['admin', 'hr']) || process.env.HF_MOCK_SERVICES !== '1', 'Requires disposable local writes, administrator/HR credentials and HF_MOCK_SERVICES=1.');
    test.beforeEach(async ({ writeGuard }) => { void writeGuard; });
    test.setTimeout(60000);
    let session: RoleSession;
    const stamp = randomUUID().replaceAll('-', '').slice(0, 12), prefix = 'QA-LATEST-' + stamp;
    let fixture = false, jobs: any[] = [], apps: any[] = [], people: any[] = [], scoped: any;
    const at = (day: number, h = 2) => { const d = new Date(); d.setUTCDate(d.getUTCDate() + day); d.setUTCHours(h, 0, 0, 0); return d.toISOString(); };
    const req = (who: string | null, method: string, path: string, body?: unknown) => session.request(who, method, path, body);
    const api = (who: string | null, method: string, path: string, body?: unknown, status = 200) => session.call(who, method, path, body, status);
    const post = (who: string | null, path: string, body: unknown = {}, status = 201) => api(who, 'POST', path, body, status);
    const get = (who: string | null, path: string) => api(who, 'GET', path);
    const login = (who: string, email: string, password: string) => session.login(who, email, password);
    async function app(job = jobs[1]) { const c = await post('hr', '/candidates', { name: prefix + '-' + randomUUID() }); return post('hr', '/applications', { candidateId: c.id, jobId: job.id }); }
    const interview = (application: any, ids = [people[0].id], extra = {}) => post('hr', '/interviews', { applicationId: application.id, round: 1, interviewerIds: ids, ...extra });
    const slots = (who: string, day: number, start: number, end: number) => post(who, '/interviewer-slots', { startAt: at(day, start), endAt: at(day, end) });
    const link = (i: any) => post('hr', `/interviews/${i.id}/self-schedule-link`);
    const view = (token: string) => get(null, `/portal/interviews/${token}`);
    const pick = (token: string, body: unknown) => post(null, `/portal/interviews/${token}/pick`, body);
    const findInterview = async (a: any, id: string) => (await get('hr', '/interviews?applicationId=' + a.id)).find((x: any) => x.id === id);
    // A failed independent case restarts this worker and recreates fresh fixtures.
    // Known product failures must remain failures, not skips or expected passes.
    test.beforeAll(async ({ playwright, baseURL }) => {
        session = new RoleSession(playwright, baseURL!);
        await session.login('admin');
        await session.login('hr');
        for (let i = 0; i < 2; i++) {
            const d = await post('admin', '/departments', { name: prefix + '-dept-' + i });
            jobs.push(await post('hr', '/jobs', { title: prefix + '-job-' + i, departmentId: d.id }));
        }
        const role = await post('admin', '/roles', { code: 'QA_LATEST_' + stamp.toUpperCase(), name: prefix + '-scoped', dataScope: 'DEPARTMENT', permissions: ['job:read', 'candidate:read', 'interview:schedule', 'evaluation:read'] });
        scoped = await post('admin', '/users', { email: `qa-latest-scoped-${stamp}@example.test`, name: prefix + '-scope', departmentId: jobs[0].departmentId, roleCodes: [role.code] });
        await login('scoped', scoped.user.email, scoped.initialPassword);
        for (let i = 0; i < 2; i++) {
            const u = await post('admin', '/users', { email: `qa-latest-interviewer-${stamp}-${i}@example.test`, name: prefix + '-interviewer-' + i, roleCodes: ['INTERVIEWER'] });
            await login('p' + i, u.user.email, u.initialPassword);
            people.push({ ...u.user, actor: 'p' + i });
        }
        people.sort((a, b) => a.id.localeCompare(b.id));
        apps = [await app(jobs[0]), await app(jobs[1])];
        fixture = true;
    });
    test.afterAll(async () => { await session?.dispose(); });
    test('L01 isolated fixture setup', async () => { assert(fixture); assert.equal(jobs.length, 2); assert.equal(apps.length, 2); });
    test('L02 scope read and own-department positive control', async () => {
        await get('scoped', '/jobs/' + jobs[0].id);
        await api('scoped', 'GET', '/jobs/' + jobs[1].id, undefined, 403);
        const own = await post('scoped', '/interviews', { applicationId: apps[0].id, round: 1, interviewerIds: [people[0].id] });
        assert(own.id);
    });
    test('L03 foreign interview create denied without mutation', async () => {
        const a = await app();
        const before = await get('hr', '/interviews?applicationId=' + a.id);
        const r = await req('scoped', 'POST', '/interviews', { applicationId: a.id, round: 1, interviewerIds: [people[0].id] });
        const after = await get('hr', '/interviews?applicationId=' + a.id);
        const detail = { status: r.status, beforeCount: before.length, afterCount: after.length };
        assert(r.status === 403 && after.length === before.length, JSON.stringify(detail));
    });
    test('L04 foreign interview schedule denied without mutation', async () => {
        const a = await app(), i = await interview(a), r = await req('scoped', 'POST', `/interviews/${i.id}/schedule`, { scheduledAt: at(120) }), after = await findInterview(a, i.id);
        const detail = { status: r.status, scheduledAt: after.scheduledAt };
        assert(r.status === 403 && !after.scheduledAt, JSON.stringify(detail));
    });
    test('L05 foreign interview cancel denied without mutation', async () => {
        const a = await app(), i = await interview(a), r = await req('scoped', 'POST', `/interviews/${i.id}/cancel`, {}), after = await findInterview(a, i.id);
        const detail = { status: r.status, interviewStatus: after.status };
        assert(r.status === 403 && after.status === 'SCHEDULED', JSON.stringify(detail));
    });
    test('L06 foreign self-schedule link denied', async () => {
        const a = await app(), i = await interview(a), r = await req('scoped', 'POST', `/interviews/${i.id}/self-schedule-link`, {});
        assert(r.status === 403 && !r.data?.token, JSON.stringify({ status: r.status, returnedPortalCredential: Boolean(r.data?.token) }));
    });
    test('L07 select second joint intersection with startAt', async () => {
        const main = await slots(people[0].actor, 121, 2, 6);
        await slots(people[1].actor, 121, 2, 3);
        const second = await slots(people[1].actor, 121, 4, 5);
        const a = await app(), i = await interview(a, people.map(p => p.id)), l = await link(i), v = await view(l.token);
        const windows = v.slots.filter((s: any) => s.id === main.id);
        assert.equal(windows.length, 2);
        assert.deepEqual(windows.map((s: any) => s.startAt).sort(), [at(121, 2), at(121, 4)]);
        const selected = await pick(l.token, { slotId: main.id, startAt: at(121, 4) });
        assert.equal(selected.scheduledAt, at(121, 4));
        const mine = await get(people[1].actor, '/interviewer-slots/mine');
        assert.equal(mine.find((s: any) => s.id === second.id).bookedBy, i.id);
        assert.equal(mine.find((s: any) => s.startAt === at(121, 2)).bookedBy, null);
    });
    test('L08 forged intersection start rejected then valid selection succeeds', async () => {
        const s = await slots(people[0].actor, 122, 2, 4), i = await interview(await app()), l = await link(i);
        await post(null, `/portal/interviews/${l.token}/pick`, { slotId: s.id, startAt: at(122, 3) }, 409);
        assert.equal((await view(l.token)).scheduledAt, null);
        assert.equal((await pick(l.token, { slotId: s.id, startAt: at(122, 2) })).scheduledAt, at(122, 2));
    });
    test('L09 portal pick DTO rejects missing numeric and malformed values', async () => {
        const i = await interview(await app()), l = await link(i);
        for (const body of [{}, { slotId: 42 }, { slotId: {} }, { slotId: 'x', startAt: 'not-date' }])
            await post(null, `/portal/interviews/${l.token}/pick`, body, 400);
    });
    test('L10 simultaneous scheduled creation has one winner', async () => {
        const a = await app(), b = await app();
        const r = await Promise.all([a, b].map((x: any) => req('hr', 'POST', '/interviews', { applicationId: x.id, round: 1, interviewerIds: [people[0].id], scheduledAt: at(123), durationMins: 60 })));
        assert.deepEqual(r.map((x: any) => x.status).sort(), [201, 409]);
    });
    test('L11 failed reschedule preserves original schedule and booking', async () => {
        const s = await slots(people[0].actor, 124, 2, 3), a = await app(), i = await interview(a, [people[0].id], { scheduledAt: at(124) });
        await interview(await app(), [people[0].id], { scheduledAt: at(125) });
        await post('hr', `/interviews/${i.id}/schedule`, { scheduledAt: at(125) }, 409);
        assert.equal((await findInterview(a, i.id)).scheduledAt, at(124));
        assert.equal((await get(people[0].actor, '/interviewer-slots/mine')).find((x: any) => x.id === s.id).bookedBy, i.id);
    });
    test('L12 portal must not advertise overlap with direct booking', async () => {
        const s = await slots(people[0].actor, 126, 2, 4);
        await interview(await app(), [people[0].id], { scheduledAt: at(126, 1), durationMins: 90 });
        const i = await interview(await app()), l = await link(i), v = await view(l.token);
        const advertised = v.slots.some((x: any) => x.id === s.id && x.startAt === at(126, 2));
        const r = await req(null, 'POST', `/portal/interviews/${l.token}/pick`, { slotId: s.id, startAt: at(126, 2) });
        assert.equal(r.status, 409);
        assert(!advertised, 'Portal advertises 02:00 despite an existing 01:00–02:30 interview; the advertised choice returns 409');
    });
    test('L13 rejected application closes portal and disallows pick', async () => {
        const s = await slots(people[0].actor, 127, 2, 3), a = await app(), i = await interview(a), l = await link(i);
        await post('hr', `/applications/${a.id}/reject`, { reason: '其他' });
        const v = await view(l.token);
        assert.equal(v.closed, true);
        assert.equal(v.slots.length, 0);
        await post(null, `/portal/interviews/${l.token}/pick`, { slotId: s.id }, 400);
    });
    test('L14 duplicate interviewer IDs rejected without creating interview', async () => {
        const a = await app();
        await post('hr', '/interviews', { applicationId: a.id, round: 1, interviewerIds: [people[0].id, people[0].id] }, 400);
        assert.equal((await get('hr', '/interviews?applicationId=' + a.id)).length, 0);
    });
});
