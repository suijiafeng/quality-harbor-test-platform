import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test, writesEnabled } from '../../fixtures/test.js';
import { RoleSession, hasRoleCredentials, staffRoles } from '../../helpers/role-session.js';

// This single ordered API test deliberately retains its linked fixtures in the disposable
// database: the application, offer and onboarding have no safe general cleanup endpoint.
// UI-only checkpoints X14, X19 and X31 belong in the browser project, not this suite.
// HF_MOCK_SERVICES=1 is an operator acknowledgement that OCR, signing, storage and
// email are mocks. A loopback URL alone is not proof that integrations are isolated.
test.describe('disposable cross-role recruitment handoffs', () => {
  test.skip(!writesEnabled, 'Requires write opt-in, HF_TEST_ENV=disposable and a loopback URL.');
  test.skip(!hasRoleCredentials(staffRoles), 'Provide all five dedicated staff-role credentials.');
  test.skip(process.env.HF_MOCK_SERVICES !== '1', 'Acknowledge mock OCR, signing, storage and email with HF_MOCK_SERVICES=1.');
  test.beforeEach(async ({ writeGuard }) => {
    void writeGuard;
  });
  test('X01–X37 cross-role API lifecycle (34 checkpoints)', async ({ playwright, baseURL }) => {
    test.setTimeout(180000);
    const session = new RoleSession(playwright, baseURL!);
    const actors = session.sessions;
    const state: Record<string, any> = {};
    const run = randomUUID().replaceAll('-', '').slice(0, 12);
    const prefix = `QA-CROSS-${run}`;
    const phone = '000' + String(Date.now()).slice(-8);
    // Deliberately invalid zero-filled mock identifiers; never use real identity or card data.
    // The OCR mock only checks digit count. The suffix also checks identifier masking.
    const mockIdSuffix = '0011';
    const mockId = '0'.repeat(14) + mockIdSuffix;
    const mockBankCard = '0'.repeat(19);
    const login = (actor: string, email?: string, password?: string) => session.login(actor, email, password);
    const get = (actor: string, path: string, expected = 200) => session.call(actor, 'GET', path, undefined, expected);
    const post = (actor: string, path: string, body: unknown = {}, expected = 201) => session.call(actor, 'POST', path, body, expected);
    const patch = (actor: string, path: string, body: unknown, expected = 200) => session.call(actor, 'PATCH', path, body, expected);
    const ownApp = async (actor = 'hr') => (await get(actor, '/candidates/' + state.candidateId)).applications.find((a: any) => a.id === state.applicationId);
    const offers = (actor: string) => get(actor, '/offers');
    const onboarding = (actor: string) => get(actor, '/onboardings/' + state.onboardingId);
    const evalBody = { scorecard: [{ dimension: '技术能力', score: 4 }], conclusion: 'YES', comments: 'QA-CROSS human-reviewed synthetic evaluation' };
    try {
      await test.step('X01 Staff identities authenticate', async () => {
        for (const a of staffRoles)
          await login(a);
        state.departmentId = actors.manager.user.department.id;
        const foreignDepartment = await post('admin', '/departments', { name: prefix + ' isolated department' });
        const foreignManager = await post('admin', '/users', {
          email: `qa-cross-foreign-manager-${run}@example.test`,
          name: prefix + ' foreign manager',
          departmentId: foreignDepartment.id,
          roleCodes: ['HIRING_MANAGER'],
        });
        await login('foreignManager', foreignManager.user.email, foreignManager.initialPassword);
        state.auth = true;
        assert.notEqual(actors.foreignManager.user.department.id, state.departmentId);
      });
      await test.step('X02 Admin provisions custom reader and unassigned interviewer', async () => {
        const role = await post('admin', '/roles', { code: 'QA_CROSS_' + run.toUpperCase(), name: prefix + ' reader', dataScope: 'DEPARTMENT', permissions: ['job:read'] });
        state.roleId = role.id;
        const u = await post('admin', '/users', { email: `qa-cross-reader-${run}@example.test`, name: prefix + ' reader', departmentId: state.departmentId, roleCodes: [role.code] });
        await login('customReader', u.user.email, u.initialPassword);
        state.readerId = u.user.id;
        const i = await post('admin', '/users', { email: `qa-cross-unassigned-${run}@example.test`, name: prefix + ' unassigned', departmentId: state.departmentId, roleCodes: ['INTERVIEWER'] });
        await login('unassigned', i.user.email, i.initialPassword);
        state.unassignedId = i.user.id;
      });
      await test.step('X03 HR creates job, candidate and application', async () => {
        const j = await post('hr', '/jobs', { title: prefix + ' Engineer', departmentId: state.departmentId, hiringManagerId: actors.manager.user.id, headcount: 1 });
        state.jobId = j.id;
        await patch('hr', '/jobs/' + j.id, { status: 'OPEN' });
        const c = await post('hr', '/candidates', { name: prefix + ' Candidate', email: `qa-cross-${run}@example.test`, phone, source: 'QA-CROSS' });
        state.candidateId = c.id;
        state.candidateName = c.name;
        const a = await post('hr', '/applications', { jobId: j.id, candidateId: c.id });
        state.applicationId = a.id;
        state.stages = j.stages.map((s: any) => ({ id: s.id, name: s.name }));
      });
      await test.step('X04 Manager sees exact HR-created job and application', async () => {
        assert.equal((await get('manager', '/jobs/' + state.jobId)).id, state.jobId);
        assert.equal((await ownApp('manager')).id, state.applicationId);
        await get('foreignManager', '/jobs/' + state.jobId, 403);
        await get('foreignManager', '/candidates/' + state.candidateId, 403);
      });
      await test.step('X05 Read-only custom role cannot change HR job', async () => {
        assert.equal((await get('customReader', '/jobs/' + state.jobId)).id, state.jobId);
        await patch('customReader', '/jobs/' + state.jobId, { title: prefix + ' forbidden' }, 403);
        assert.equal((await get('hr', '/jobs/' + state.jobId)).title, prefix + ' Engineer');
      });
      await test.step('X06 Admin revocation affects existing reader session immediately', async () => {
        await patch('admin', '/roles/' + state.roleId + '/permissions', { codes: [] });
        await get('customReader', '/jobs/' + state.jobId, 403);
        await patch('admin', '/roles/' + state.roleId + '/permissions', { codes: ['job:read'] });
        await get('customReader', '/jobs/' + state.jobId);
      });
      await test.step('X07 HR issues prescreen link for same application', async () => {
        state.prescreenToken = (await post('hr', '/applications/' + state.applicationId + '/prescreen-link')).token;
        const p = await get('candidate', '/portal/prescreen/' + state.prescreenToken);
        assert.ok(JSON.stringify(p).includes(state.candidateName));
      });
      await test.step('X08 Candidate submits prescreen and HR sees persisted response', async () => {
        await post('candidate', '/portal/prescreen/' + state.prescreenToken, { expectedSalary: 25000, availableDate: new Date(Date.now() + 7 * 86400000).toISOString(), travelOk: true, note: 'QA-CROSS candidate handoff' });
        assert.ok(JSON.stringify(await ownApp()).includes('QA-CROSS candidate handoff'));
      });
      await test.step('X09 HR assigns same application to interviewer and manager', async () => {
        const i = await post('hr', '/interviews', { applicationId: state.applicationId, round: 1, interviewerIds: [actors.interviewer.user.id, actors.manager.user.id] });
        state.interviewId = i.id;
        assert.ok((await get('interviewer', '/interviews?applicationId=' + state.applicationId)).some((x: any) => x.id === i.id));
      });
      await test.step('X10 Unassigned interviewer sees no interview and cannot submit evaluation', async () => {
        assert.equal((await get('unassigned', '/interviews?applicationId=' + state.applicationId)).length, 0);
        await post('unassigned', '/interviews/' + state.interviewId + '/evaluations', evalBody, 403);
        await post('unassigned', '/interviews/' + state.interviewId + '/evaluation-draft', { notes: 'QA-CROSS unassigned evaluation notes' }, 403);
        assert.equal((await get('hr', '/interviews?applicationId=' + state.applicationId)).find((x: any) => x.id === state.interviewId).evaluations.length, 0);
      });
      await test.step('X11 Assigned interviewer submits and manager sees same evaluation', async () => {
        const e = await post('interviewer', '/interviews/' + state.interviewId + '/evaluations', evalBody);
        state.evaluationId = e.id;
        const i = (await get('manager', '/interviews?applicationId=' + state.applicationId)).find((x: any) => x.id === state.interviewId);
        assert.ok(i.evaluations.some((x: any) => x.id === e.id));
        assert.equal(i.status, 'COMPLETED');
      });
      await test.step('X12 Assigned manager adds evaluation and HR sees both authors', async () => {
        await post('manager', '/interviews/' + state.interviewId + '/evaluations', { ...evalBody, comments: 'QA-CROSS manager reviewed' });
        const i = (await get('hr', '/interviews?applicationId=' + state.applicationId)).find((x: any) => x.id === state.interviewId);
        assert.equal(i.evaluations.length, 2);
        assert.deepEqual(new Set(i.evaluations.map((e: any) => e.interviewer.id)), new Set([actors.interviewer.user.id, actors.manager.user.id]));
        const n = await get('hr', '/notifications');
        assert.ok(JSON.stringify(n).includes(state.candidateName));
      });
      await test.step('X13 Interviewer candidate view masks contact data', async () => {
        const c = await get('interviewer', '/candidates/' + state.candidateId);
        assert.equal(c.id, state.candidateId);
        assert.notEqual(c.email, `qa-cross-${run}@example.test`);
        assert.notEqual(c.phone, phone);
        await get('unassigned', '/candidates/' + state.candidateId, 403);
      });
      await test.step('X15 HR creates pending Offer from same evaluated application', async () => {
        const o = await post('hr', '/offers', { applicationId: state.applicationId, salaryBase: 25000, bonusMonths: 2, grade: 'P5', startDate: new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10), note: 'QA-CROSS reviewed package' });
        state.offerId = o.id;
        assert.equal(o.approvalStatus, 'PENDING');
        assert.equal((await offers('manager')).find((x: any) => x.id === o.id).applicationId, state.applicationId);
      });
      await test.step('X16 HR and out-of-department manager cannot approve pending Offer', async () => {
        await post('hr', '/offers/' + state.offerId + '/approve', {}, 403);
        await post('foreignManager', '/offers/' + state.offerId + '/approve', {}, 403);
        assert.equal((await offers('hr')).find((x: any) => x.id === state.offerId).approvalStatus, 'PENDING');
      });
      await test.step('X17 Same-department manager approves and HR sees decision', async () => {
        await post('manager', '/offers/' + state.offerId + '/approve', { note: 'QA-CROSS manager approval' });
        assert.equal((await offers('hr')).find((x: any) => x.id === state.offerId).approvalStatus, 'APPROVED');
        state.approved = true;
      });
      await test.step('X18 Manager cannot send; HR sends candidate portal link', async () => {
        await post('manager', '/offers/' + state.offerId + '/send', {}, 403);
        await post('hr', '/offers/' + state.offerId + '/send');
        state.offerToken = (await post('hr', '/offers/' + state.offerId + '/portal-link')).token;
        const o = await get('candidate', '/portal/offers/' + state.offerToken);
        assert.equal(o.candidateName, state.candidateName);
        assert.equal(o.salary.base, 25000);
      });
      await test.step('X20 Candidate accepts and hands off to onboarding portal', async () => {
        const r = await post('candidate', '/portal/offers/' + state.offerToken + '/respond', { decision: 'ACCEPTED' });
        assert.equal(r.decision, 'ACCEPTED');
        assert.ok(r.onboardingPortalToken);
        state.onboardingToken = r.onboardingPortalToken;
        state.accepted = true;
      });
      await test.step('X21 HR manager and IT see one onboarding for same application', async () => {
        const ons = await get('hr', '/onboardings');
        const matching = ons.filter((o: any) => o.applicationId === state.applicationId);
        assert.equal(matching.length, 1);
        state.onboardingId = matching[0].id;
        assert.equal((await onboarding('manager')).id, state.onboardingId);
        assert.equal((await onboarding('it')).id, state.onboardingId);
        assert.equal((await get('hr', '/jobs/' + state.jobId)).status, 'PAUSED');
        assert.equal((await offers('hr')).find((x: any) => x.id === state.offerId).decision, 'ACCEPTED');
      });
      await test.step('X22 Repeated candidate acceptance cannot duplicate onboarding', async () => {
        await post('candidate', '/portal/offers/' + state.offerToken + '/respond', { decision: 'ACCEPTED' }, 400);
        assert.equal((await get('hr', '/onboardings')).filter((x: any) => x.applicationId === state.applicationId).length, 1);
      });
      await test.step('X23 IT and interviewer cannot obtain candidate portal credentials', async () => {
        await post('it', '/onboardings/' + state.onboardingId + '/portal-link', {}, 403);
        await post('interviewer', '/onboardings/' + state.onboardingId + '/portal-link', {}, 403);
        await get('interviewer', '/onboardings/' + state.onboardingId, 403);
        await post('it', '/onboardings/' + state.onboardingId + '/contract', {}, 403);
      });
      await test.step('X24 Candidate submits three mock documents and HR sees completion', async () => {
        for (const [type, rawText] of [['ID_CARD', `姓名：测试人 身份证号码 ${mockId} 地址：测试路一号甲栋`], ['BANK_CARD', `姓名：测试人 测试银行 ${mockBankCard}`], ['DIPLOMA', '姓名：测试人 测试大学 本科 专业：计算机 2020年毕业']])
          await post('candidate', '/portal/onboardings/' + state.onboardingToken + '/documents', { type, rawText });
        const o = await onboarding('hr');
        assert.equal(o.documents.length, 3);
        assert.ok(o.documents.every((d: any) => d.ocrProvider === 'mock-ocr' && !d.needsReview));
        assert.equal(o.progress.done, 3);
        state.documentsReady = true;
      });
      await test.step('X25 IT sees redacted documents; manager sees masked identifier', async () => {
        const it = await onboarding('it');
        assert.equal(it.application.candidate.email, null);
        assert.equal(it.application.candidate.phone, null);
        assert.ok(it.documents.every((d: any) => d.redacted && Object.keys(d.fields).length === 0 && !d.fileKey && !d.fileUrl));
        const m = await onboarding('manager');
        assert.match(m.documents.find((d: any) => d.type === 'ID_CARD').fields.idNumber, new RegExp(`^\\*+${mockIdSuffix}$`));
        assert.ok(!('portalToken' in it));
      });
      await test.step('X26 IT cannot change HR checklist task and manager cannot change IT task', async () => {
        const before = await onboarding('hr');
        state.hrKey = before.checklist.find((i: any) => i.owner === 'HR').key;
        state.itKey = before.checklist.find((i: any) => i.owner === 'IT').key;
        await patch('it', '/onboardings/' + state.onboardingId + '/checklist/' + state.hrKey, { done: true }, 403);
        await patch('manager', '/onboardings/' + state.onboardingId + '/checklist/' + state.itKey, { done: true }, 403);
        const after = await onboarding('hr');
        assert.deepEqual(after.checklist, before.checklist);
      });
      await test.step('X27 IT completes own tasks and HR sees handoff', async () => {
        for (const item of (await onboarding('it')).checklist.filter((i: any) => i.owner === 'IT'))
          await patch('it', '/onboardings/' + state.onboardingId + '/checklist/' + item.key, { done: true });
        assert.ok((await onboarding('hr')).checklist.filter((i: any) => i.owner === 'IT').every((i: any) => i.done));
        state.itReady = true;
      });
      await test.step('X28 HR generates contract using accepted Offer package', async () => {
        const o = await post('hr', '/onboardings/' + state.onboardingId + '/contract');
        state.contractId = o.contract.id;
        assert.equal(o.contract.signStatus, 'DRAFT');
        assert.equal(o.contract.variables.salaryBase, 25000);
        const it = await onboarding('it');
        assert.equal(it.contract.variables.salaryBase, undefined);
        assert.equal(it.contract.variables.salaryMasked, true);
      });
      await test.step('X29 Candidate cannot sign before HR sends draft', async () => {
        await post('candidate', '/portal/onboardings/' + state.onboardingToken + '/contract/sign', {}, 400);
        assert.equal((await onboarding('hr')).contract.signStatus, 'DRAFT');
      });
      await test.step('X30 IT cannot send contract; HR sends mock signing request', async () => {
        await post('it', '/contracts/' + state.contractId + '/send', {}, 403);
        const o = await post('hr', '/contracts/' + state.contractId + '/send');
        assert.equal(o.contract.signStatus, 'SENT');
        state.contractSent = true;
      });
      await test.step('X32 Candidate mock signature becomes HR evidence and done checklist', async () => {
        await post('candidate', '/portal/onboardings/' + state.onboardingToken + '/contract/sign');
        const o = await onboarding('hr');
        assert.equal(o.contract.signStatus, 'SIGNED');
        assert.match(o.contract.evidenceNo, /^EVID-MOCK-/);
        assert.ok(o.checklist.find((i: any) => i.key === 'nh_contract').done);
        state.signed = true;
      });
      await test.step('X33 HR completes own tasks after IT and candidate handoff', async () => {
        for (const item of (await onboarding('hr')).checklist.filter((i: any) => i.owner === 'HR' && !i.done))
          await patch('hr', '/onboardings/' + state.onboardingId + '/checklist/' + item.key, { done: true });
        state.hrReady = true;
      });
      await test.step('X34 All actors see completed onboarding and application HIRED', async () => {
        for (const actor of ['hr', 'manager', 'it']) {
          const o = await onboarding(actor);
          assert.equal(o.status, 'COMPLETED');
          assert.equal(o.progress.done, o.progress.total);
        }
        const p = await get('candidate', '/portal/onboardings/' + state.onboardingToken);
        assert.equal(p.status, 'COMPLETED');
        assert.equal((await ownApp()).status, 'HIRED');
        state.completed = true;
      });
      await test.step('X35 Completed onboarding rejects IT rollback and candidate document change', async () => {
        await patch('it', '/onboardings/' + state.onboardingId + '/checklist/' + state.itKey, { done: false }, 400);
        await post('candidate', '/portal/onboardings/' + state.onboardingToken + '/documents', { type: 'DIPLOMA', rawText: '测试大学 本科' }, 400);
        assert.equal((await onboarding('hr')).status, 'COMPLETED');
      });
      await test.step('X36 Portal scope cannot use Offer token as onboarding credential', async () => {
        await get('candidate', '/portal/onboardings/' + state.offerToken, 404);
        await get('candidate', '/portal/offers/' + state.onboardingToken, 404);
        await get('candidate', '/onboardings/' + state.onboardingId, 401);
      });
      await test.step('X37 HR and manager retain same candidate and evaluation history after hire', async () => {
        for (const a of ['hr', 'manager']) {
          assert.equal((await ownApp(a)).status, 'HIRED');
          const i = (await get(a, '/interviews?applicationId=' + state.applicationId)).find((x: any) => x.id === state.interviewId);
          assert.ok(i.evaluations.some((e: any) => e.id === state.evaluationId));
          assert.equal(i.evaluations.length, 2);
        }
        const o = (await offers('hr')).find((x: any) => x.id === state.offerId);
        assert.equal(o.applicationId, state.applicationId);
        assert.equal(o.decision, 'ACCEPTED');
      });
    }
    finally {
      await session.dispose();
    }
  });
});
