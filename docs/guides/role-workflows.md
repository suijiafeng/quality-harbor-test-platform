# 多角色与面试回归

这三组用例从实际 HireFlow 回归场景整理为原生 Playwright 测试。仍只连接传入 URL，不克隆、启动、修改业务项目，也不读取其种子账号。不会自动配置 mock 或重置数据库。

## 安全前置条件

1. 使用全新、可丢弃的本地数据库和 loopback URL，禁止生产转发。
2. 设置 `HF_TEST_ENV=disposable`，执行时显式加 `--allow-writes`。
3. 确认业务服务的邮件、AI/OCR、存储和电子签署使用隔离 mock，再设置 `HF_MOCK_SERVICES=1`。此开关是操作者确认，不是供应商隔离检测。
4. 通过私有 shell/CI 环境注入 `HF_EMAIL`、`HF_PASSWORD`（管理员，原有 CLI 写入前置条件），以及下列角色账号：
   - `HF_ADMIN_EMAIL` / `HF_ADMIN_PASSWORD`：可选管理员覆盖；未配置时使用原有管理员变量。只填一项不会混用另一组密码。
   - `HF_HR_EMAIL` / `HF_HR_PASSWORD`
   - `HF_MANAGER_EMAIL` / `HF_MANAGER_PASSWORD`
   - `HF_INTERVIEWER_EMAIL` / `HF_INTERVIEWER_PASSWORD`
   - `HF_IT_EMAIL` / `HF_IT_PASSWORD`

这些账号应分别对应 ADMIN、HR、HIRING_MANAGER、INTERVIEWER、IT_SUPPORT。经理需分配部门，初始角色权限与当前默认定义一致。账号不符合预期时测试应失败，不能降低权限断言来适配。跨部门经理和自定义角色由测试在隔离数据库中创建，不需额外固定账号。

每个流程使用随机 `QA-` 前缀。流程会创建角色、用户、部门、候选人、应聘、面试、Offer 和入职记录，且可能修改指定测试管理员的自锁定保护路径；禁止使用个人/生产管理员。缺少删除 API 的记录会保留，失败也可能留下数据。完成后由操作者按本地测试环境的方式销毁数据库，不要把这些用例对准长期共用的测试数据。

## 执行

先按业务项目自己的流程启动上述隔离服务，再在本仓库执行：

```bash
npm test -- http://localhost:5173 --profile=hireflow --allow-writes individual-roles.spec.ts
npm test -- http://localhost:5173 --profile=hireflow --allow-writes cross-role-workflow.spec.ts
npm test -- http://localhost:5173 --profile=hireflow --allow-writes latest-regressions.spec.ts
npm run report
```

面试回归只需要管理员和 HR 账号，其余两组需要五个角色。缺少角色、mock 确认或写入授权时新增用例会明确跳过。`npm run check` 仍只验证平台，不运行业务服务。

## 报告口径

- 独立角色：5 个测试，每个包含 I01–I16 共 16 个步骤。分别检查身份权限、允许/拒绝访问、联系信息脱敏、部门/分配隔离、允许写入及读回、菜单、所有允许路由、禁止路由、移动首页、数据可见性、退出和历史回退。
- 跨角色闭环：1 个测试，包含 34 个 API 步骤，保留原始 X01–X37 编号。X14/X19/X31 为临时验证中的浏览器步骤，未迁入 API 项目，不计入此处覆盖。流程中的 mock 签署不代表真实法律签署或供应商验收。
- 面试回归：L01–L14 共 14 个独立测试。L01 确认隔离夹具，其他检查跨部门写入保护、共同可用时间段、输入验证、并发冲突、失败回滚、占用时间展示、关闭门户和重复面试官。

角色和闭环测试遇到失败立即停止剩余步骤，不把未运行步骤算作通过；面试独立用例失败后 Playwright 会重启 worker，并重建随机夹具继续其他检查。不要将“5 个角色通过”混称为“80 条独立测试通过”。完整平台共发现 53 个顶层测试，其中新增 20 个。

已知业务缺陷保持失败断言，详见 [问题记录](../validation/known-issues.md)。报告只写入被忽略的本地 `reports/`；不要提交截图、生成数据、凭据或会话。API 错误消息隐藏认证内容，但原生报告/失败截图仍需人工审查后再分享。
