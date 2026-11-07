import assert from 'node:assert/strict';
import { randomInt, randomUUID } from 'node:crypto';
import { test, expect, writesEnabled } from '../../fixtures/test.js';
import { RoleSession, staffRoles, roleCredentials, hasRoleCredentials } from '../../helpers/role-session.js';
type RoleConfig = {
  code: string;
  scope: string;
  count: number;
  home: string;
};
const roleConfig: Record<string, RoleConfig> = {
  admin: { code: 'ADMIN', scope: 'ALL', count: 23, home: '/dashboard' },
  hr: { code: 'HR', scope: 'ALL', count: 20, home: '/dashboard' },
  manager: { code: 'HIRING_MANAGER', scope: 'DEPARTMENT', count: 9, home: '/dashboard' },
  interviewer: { code: 'INTERVIEWER', scope: 'ASSIGNED', count: 3, home: '/candidates' },
  it: { code: 'IT_SUPPORT', scope: 'ASSIGNED', count: 1, home: '/onboarding' },
};
test.describe('Independent staff role regression', () => {
  test.use({ allowAuthentication: hasRoleCredentials(staffRoles) });
  test.skip(!writesEnabled || !hasRoleCredentials(staffRoles) || process.env.HF_MOCK_SERVICES !== '1', 'Requires disposable loopback writes, all dedicated role credentials and HF_MOCK_SERVICES=1.');
  test.beforeEach(async ({ writeGuard }) => {
    void writeGuard;
  });
  for (const role of staffRoles) {
    test(`${role}: permissions, isolation, persistence and UI`, async ({ playwright, baseURL, page }) => {
      test.setTimeout(180000);
      const api = new RoleSession(playwright, baseURL!);
      const sessions = api.sessions;
      const base = new URL(baseURL!).origin;
      const origin = base;
      const stamp = randomUUID().replaceAll('-', '');
      const prefix = `QA-IND-${role}-${stamp}`;
      const config = roleConfig[role];
      const routes = [['/dashboard', '数据大盘'], ['/insights', '数据洞察'], ['/jobs', '职位管理'], ['/candidates', '候选人'], ['/pipeline', '招聘看板'], ['/interviews', '面试管理'], ['/offers', '录用管理'], ['/onboarding', '入职管理'], ['/helpdesk', '入职问答'], ['/settings', '系统设置']];
      const visible = role === 'admin' ? routes : role === 'hr' || role === 'manager' ? routes.filter(x => x[0] !== '/settings') : role === 'interviewer' ? routes.filter(x => ['/candidates', '/interviews', '/helpdesk'].includes(x[0])) : routes.filter(x => ['/onboarding', '/helpdesk'].includes(x[0]));
      const allowed = new Set(visible.map(x => x[0]));
      let profile: any;
      const mutation: Record<string, any> = {};
      const f: {
        jobs: any[];
        candidates: any[];
        apps: any[];
        interviews: any[];
        offers: any[];
        resume?: any;
        onboarding?: any;
      } = { jobs: [], candidates: [], apps: [], interviews: [], offers: [] };
      const list = (value: any): any[] => Array.isArray(value) ? value : value.items || value.data || [];
      const future = new Date(Date.now() + 90 * 86400000).toISOString().slice(0, 10);
      const get = (actor: string, path: string, expected = 200) => api.call(actor, 'GET', path, undefined, expected);
      const post = (actor: string, path: string, body: unknown = {}, expected = 201) => api.call(actor, 'POST', path, body, expected);
      const patch = (actor: string, path: string, body: unknown, expected = 200) => api.call(actor, 'PATCH', path, body, expected);
      const login = (actor: string) => api.login(actor);
      async function uiSession() {
        const credentials = roleCredentials(role);
        await page.setViewportSize({ width: 1440, height: 1000 });
        page.setDefaultTimeout(15000);
        await page.goto(base + '/login');
        await page.getByRole('textbox', { name: /^邮箱/ }).fill(credentials.email);
        await page.getByLabel(/^密码/).fill(credentials.password);
        await page.getByRole('button', { name: /^登\s*录$/ }).click();
        await expect(page).toHaveURL(url => url.origin === origin && url.pathname === config.home);
      }
      // API writes are guarded by RoleSession; the shared browser fixture stays read-only.
      try {
        await test.step('I01 role login, exact permission count and scope', async () => {
          await login(role);
          profile = await get(role, '/auth/profile');
          assert.equal(profile.permissions.length, config.count);
          assert(profile.roles.some((r: any) => r.code === config.code && r.dataScope === config.scope));
          return { permissionCount: profile.permissions.length, roles: profile.roles.map((r: any) => ({ code: r.code, dataScope: r.dataScope })) };
        });
        await test.step('I02 independent synthetic fixtures', async () => {
          for (const w of ['admin', 'hr', 'manager', 'interviewer'])
            await login(w);
          const own = sessions.manager.user.department.id, foreign = (await post('admin', '/departments', { name: prefix + '-foreign' })).id;
          for (let i = 0; i < 2; i++) {
            const j = await post('hr', '/jobs', { title: prefix + '-job-' + i, departmentId: i ? foreign : own, hiringManagerId: i ? undefined : sessions.manager.user.id, headcount: 5 });
            f.jobs.push(j);
            const c = await post('hr', '/candidates', { name: prefix + '-person-' + i, email: `qa-ind-${role}-${stamp}-${i}@example.test`, phone: String(randomInt(13000000000, 14000000000)), tags: ['QA-IND', 'React'] });
            f.candidates.push(c);
            f.apps.push(await post('hr', '/applications', { candidateId: c.id, jobId: j.id }));
            f.interviews.push(await post('hr', '/interviews', { applicationId: f.apps[i].id, round: 1, interviewerIds: [sessions[i ? 'manager' : 'interviewer'].user.id] }));
            f.offers.push(await post('hr', '/offers', { applicationId: f.apps[i].id, salaryBase: 32100, bonusMonths: 2, startDate: future }));
          }
          f.resume = await post('hr', `/candidates/${f.candidates[0].id}/resumes`, { rawText: `Synthetic resume React TypeScript engineer email ${f.candidates[0].email} phone ${f.candidates[0].phone}` });
          if (role === 'it') {
            await post('admin', `/offers/${f.offers[0].id}/approve`);
            await post('hr', `/offers/${f.offers[0].id}/send`);
            await post('hr', `/offers/${f.offers[0].id}/respond`, { decision: 'ACCEPTED' });
            f.onboarding = list(await get('hr', '/onboardings')).find((o: any) => o.applicationId === f.apps[0].id);
            assert(f.onboarding);
          }
          return { jobIds: f.jobs.map((j: any) => j.id), candidateIds: f.candidates.map((c: any) => c.id), helperSessions: 'Only fixture creation and post-action verification use other roles' };
        });
        await test.step('I03 role-specific readable API matrix', async () => {
          const paths = role === 'it' ? ['/onboardings', '/helpdesk/docs', '/notifications'] : role === 'interviewer' ? ['/candidates', '/interviews', '/helpdesk/docs', '/notifications'] : ['/jobs', '/candidates', '/interviews', '/offers', '/onboardings', '/analytics/overview', '/analytics/insights', '/helpdesk/docs', '/notifications'];
          if (role === 'admin')
            paths.push('/users', '/roles', '/permissions', '/activities/recent');
          for (const p of paths)
            await get(role, p);
          return { paths };
        });
        await test.step('I04 forbidden API reads or admin cross-department access', async () => {
          if (role === 'admin') {
            for (const j of f.jobs)
              await get(role, '/jobs/' + j.id);
            return { allDepartmentsReadable: true };
          }
          const paths = role === 'hr' || role === 'manager' ? ['/roles', '/permissions', '/activities/recent'] : role === 'interviewer' ? ['/jobs', '/offers', '/users', '/roles', '/analytics/overview'] : ['/jobs', '/candidates', '/interviews', '/offers', '/users', '/roles', '/analytics/overview'];
          for (const p of paths)
            await get(role, p, 403);
          return { deniedPaths: paths };
        });
        await test.step('I05 candidate contact and assigned/department visibility', async () => {
          if (role === 'it') {
            for (const c of f.candidates)
              await get(role, '/candidates/' + c.id, 403);
            const o = await get(role, '/onboardings/' + f.onboarding.id);
            assert.equal(o.application.candidate.email, null);
            assert.equal(o.application.candidate.phone, null);
            assert(!('portalToken' in o));
            return { contactFieldsHidden: true };
          }
          const own = await get(role, '/candidates/' + f.candidates[0].id), raw = JSON.stringify(own);
          if (role === 'interviewer') {
            assert(!raw.includes(f.candidates[0].email));
            assert(!raw.includes(f.candidates[0].phone));
            assert.equal(own.phone, f.candidates[0].phone.slice(0, 3) + '***' + f.candidates[0].phone.slice(-4));
            assert.equal(own.email, f.candidates[0].email.slice(0, 2) + '***@' + f.candidates[0].email.split('@')[1]);
            assert(raw.includes('***'));
          }
          else {
            assert.equal(own.email, f.candidates[0].email);
          }
          await get(role, '/candidates/' + f.candidates[1].id, ['manager', 'interviewer'].includes(role) ? 403 : 200);
          return { contactMode: role === 'interviewer' ? 'masked' : 'full', foreignAccessible: ['admin', 'hr'].includes(role) };
        });
        await test.step('I06 list scope excludes foreign or unassigned fixtures', async () => {
          if (role === 'it') {
            const rows = list(await get(role, '/onboardings'));
            assert(rows.some((x: any) => x.id === f.onboarding.id));
            assert(rows.every((x: any) => !x.portalToken && x.application.candidate.email === null));
            return { syntheticOnboardingVisible: true };
          }
          const rows = list(await get(role, '/candidates?keyword=' + encodeURIComponent(prefix)));
          assert(rows.some((x: any) => x.id === f.candidates[0].id));
          assert.equal(rows.some((x: any) => x.id === f.candidates[1].id), ['admin', 'hr'].includes(role));
          const ints = list(await get(role, '/interviews'));
          assert(ints.some((x: any) => x.id === f.interviews[0].id));
          assert.equal(ints.some((x: any) => x.id === f.interviews[1].id), ['admin', 'hr'].includes(role));
        });
        await test.step('I07 role-specific forbidden write guard', async () => {
          if (role === 'admin') {
            await patch(role, `/users/${sessions.admin.user.id}/status`, { status: 'DISABLED' }, 403);
            await patch(role, `/users/${sessions.admin.user.id}/roles`, { roleCodes: ['HR'] }, 403);
            return { selfLockoutPrevented: true };
          }
          await post(role, '/users', { email: `blocked-${stamp}@example.test`, name: prefix + '-blocked', roleCodes: ['ADMIN'] }, 403);
          await post(role, '/roles', { code: 'BLOCKED_' + stamp.toUpperCase(), name: 'Blocked' }, 403);
          if (role === 'hr')
            await post(role, `/offers/${f.offers[0].id}/approve`, {}, 403);
          else {
            await post(role, '/jobs', { title: prefix + '-blocked-job', departmentId: f.jobs[0].departmentId }, 403);
            await post(role, '/candidates', { name: prefix + '-blocked-person' }, 403);
          }
        });
        await test.step('I08 real allowed role action', async () => {
          if (role === 'hr') {
            mutation.candidate = await post(role, '/candidates', { name: prefix + '-created', email: `created-${stamp}@example.test` });
            await patch(role, '/candidates/' + mutation.candidate.id, { name: prefix + '-updated' });
          }
          if (role === 'admin') {
            mutation.department = await post(role, '/departments', { name: prefix + '-admin-created' });
            await patch(role, '/departments/' + mutation.department.id, { name: prefix + '-admin-updated' });
          }
          if (role === 'manager') {
            mutation.offer = await post(role, `/offers/${f.offers[0].id}/approve`, { note: prefix + ' synthetic approval' });
            assert.equal(mutation.offer.approvalStatus, 'APPROVED');
          }
          if (role === 'interviewer') {
            mutation.evaluation = await post(role, `/interviews/${f.interviews[0].id}/evaluations`, { scorecard: [{ dimension: '技术能力', score: 4 }], conclusion: 'YES', comments: prefix + ' synthetic reviewed evaluation' });
            assert(mutation.evaluation.id);
          }
          if (role === 'it') {
            mutation.item = f.onboarding.checklist.find((x: any) => x.owner === 'IT');
            assert(mutation.item);
            const o = await patch(role, `/onboardings/${f.onboarding.id}/checklist/${mutation.item.key}`, { done: true });
            assert.equal(o.checklist.find((x: any) => x.key === mutation.item.key).done, true);
          }
        });
        await test.step('I09 allowed action persisted when reread', async () => {
          if (role === 'hr')
            assert.equal((await get(role, '/candidates/' + mutation.candidate.id)).name, prefix + '-updated');
          if (role === 'admin')
            assert(list(await get(role, '/departments')).some((d: any) => d.id === mutation.department.id && d.name === prefix + '-admin-updated'));
          if (role === 'manager')
            assert.equal(list(await get(role, '/offers')).find((o: any) => o.id === f.offers[0].id).approvalStatus, 'APPROVED');
          if (role === 'interviewer') {
            const row = list(await get(role, '/interviews')).find((i: any) => i.id === f.interviews[0].id);
            assert(row.evaluations.some((e: any) => e.id === mutation.evaluation.id));
            assert.equal(row.status, 'COMPLETED');
          }
          if (role === 'it')
            assert.equal((await get(role, '/onboardings/' + f.onboarding.id)).checklist.find((i: any) => i.key === mutation.item.key).done, true);
        });
        await test.step('I10 opposite scope or ownership action blocked', async () => {
          if (role === 'manager') {
            await post(role, `/offers/${f.offers[1].id}/approve`, {}, 403);
            await patch(role, `/applications/${f.apps[1].id}/stage`, { stageId: f.jobs[1].stages[1].id }, 403);
          }
          if (role === 'interviewer')
            await post(role, `/interviews/${f.interviews[1].id}/evaluations`, { scorecard: [{ dimension: '技术能力', score: 4 }], conclusion: 'YES', comments: 'Synthetic forbidden evaluation' }, 403);
          if (role === 'it') {
            const hrItem = f.onboarding.checklist.find((x: any) => x.owner === 'HR');
            assert(hrItem);
            await patch(role, `/onboardings/${f.onboarding.id}/checklist/${hrItem.key}`, { done: true }, 403);
            assert.equal((await get('hr', '/onboardings/' + f.onboarding.id)).checklist.find((x: any) => x.key === hrItem.key).done, false);
            await post(role, `/onboardings/${f.onboarding.id}/documents`, { type: 'ID_CARD', rawText: 'Synthetic test' }, 403);
          }
          if (role === 'hr') {
            await post(role, '/departments', { name: prefix + '-forbidden' }, 403);
            await patch(role, `/users/${sessions.hr.user.id}/roles`, { roleCodes: ['ADMIN'] }, 403);
          }
          if (role === 'admin') {
            const roles = await get(role, '/roles');
            await patch(role, `/roles/${roles.find((r: any) => r.code === 'ADMIN').id}/permissions`, { codes: [] }, 403);
            await post(role, '/users', { email: `portal-${stamp}@example.test`, name: prefix + '-portal', roleCodes: ['CANDIDATE'] }, 400);
          }
        });
        await test.step('I11 browser login lands on role home and exact menu', async () => {
          await uiSession();
          for (const [path, label] of routes) {
            const item = page.getByRole('menuitem', { name: new RegExp(label + '$') });
            if (allowed.has(path))
              await expect(item).toBeVisible();
            else
              await expect(item).toHaveCount(0);
          }
          return { home: config.home, visibleRoutes: [...allowed] };
        });
        await test.step('I12 each permitted UI route renders without page errors', async () => {
          assert(page, 'UI login prerequisite missing');
          const errors: string[] = [];
          const handler = (e: any) => errors.push(String(api.redact(e.message)));
          page.on('pageerror', handler);
          try {
            for (const [path, label] of visible) {
              await page.goto(base + path);
              await expect(page).toHaveURL((url: any) => url.origin === origin && url.pathname === path);
              await expect(page.getByRole('menuitem', { name: new RegExp(label + '$') })).toBeVisible();
              await page.waitForTimeout(500);
              const body = await page.locator('body').innerText();
              assert(body.length > 70);
              assert(!/Unexpected Application Error|Internal Server Error|无权访问/.test(body), path + ' failed render');
            }
            assert.deepEqual(errors, []);
          }
          finally {
            page.off('pageerror', handler);
          }
        });
        await test.step('I13 forbidden route UI and hidden privileged controls', async () => {
          assert(page, 'UI login prerequisite missing');
          if (role === 'admin') {
            await page.goto(base + '/settings');
            await expect(page.getByText('角色与权限', { exact: true }).first()).toBeVisible();
            await page.getByRole('button', { name: /新建角色$/ }).click();
            await expect(page.getByRole('dialog')).toBeVisible();
            await page.getByRole('dialog').getByRole('button', { name: /^取\s*消$/ }).click();
            await expect(page.getByRole('dialog')).toHaveCount(0);
          }
          else {
            for (const path of role === 'interviewer' ? ['/jobs', '/offers', '/settings'] : role === 'it' ? ['/candidates', '/jobs', '/settings'] : ['/settings']) {
              await page.goto(base + path);
              await expect(page.getByText('无权访问', { exact: true })).toBeVisible();
            }
            if (role === 'manager') {
              await page.goto(base + '/jobs');
              await expect(page.getByRole('button', { name: /新建职位$/ })).toHaveCount(0);
            }
            if (role === 'interviewer') {
              await page.goto(base + '/candidates');
              await expect(page.getByRole('button', { name: /新增候选人$/ })).toHaveCount(0);
            }
          }
        });
        await test.step('I14 mobile home is usable and not horizontally overflowing', async () => {
          assert(page);
          await page.setViewportSize({ width: 390, height: 844 });
          await page.goto(base + config.home);
          await page.waitForTimeout(700);
          await expect(page.getByText('无权访问', { exact: true })).toHaveCount(0);
          const dims = await page.evaluate(() => ({ width: innerWidth, scroll: document.documentElement.scrollWidth, chars: document.body.innerText.length }));
          assert(dims.chars > 70);
          assert(dims.scroll <= dims.width + 2, JSON.stringify(dims));
          await page.setViewportSize({ width: 1440, height: 1000 });
          return dims;
        });
        await test.step('I15 UI candidate or onboarding shows synthetic fixture', async () => {
          assert(page);
          if (role === 'it') {
            await page.goto(base + '/onboarding');
            await expect(page.getByText(f.candidates[0].name, { exact: true }).first()).toBeVisible();
          }
          else {
            await page.goto(base + '/candidates');
            await page.getByPlaceholder('搜索姓名、邮箱、电话、技能').fill(prefix + '-person');
            await expect(page.getByText(f.candidates[0].name, { exact: true }).first()).toBeVisible();
            if (['manager', 'interviewer'].includes(role))
              await expect(page.getByText(f.candidates[1].name, { exact: true })).toHaveCount(0);
            else
              await expect(page.getByText(f.candidates[1].name, { exact: true }).first()).toBeVisible();
          }
        });
        await test.step('I16 explicit logout and back cannot restore protected UI', async () => {
          assert(page);
          await page.goto(base + config.home);
          await page.locator('.header-user').hover();
          await page.getByText('退出登录', { exact: true }).click();
          await expect(page).toHaveURL(url => url.origin === origin && url.pathname === '/login');
          await page.goBack();
          await expect(page).toHaveURL(url => url.origin === origin && url.pathname === '/login');
          assert(await page.evaluate(() => !JSON.parse(localStorage.getItem('hireflow-auth') || '{}').state?.token));
          await page.goto(base + config.home);
          await expect(page).toHaveURL(url => url.origin === origin && url.pathname === '/login');
        });
      }
      finally {
        await api.dispose();
      }
    });
  }
});
