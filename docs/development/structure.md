# 目录与扩展约定

## 目录职责

```text
quality-harbor-test-platform/
├── .github/workflows/       CI 工作流
├── src/
│   ├── cli/                URL/项目命令行入口、运行调度与报告查看
│   ├── core/               配置校验、网络策略、运行摘要和报告路径
│   ├── reporters/          简洁运行摘要 reporter
│   └── fixtures/test.ts     与业务无关的安全 Playwright fixtures
├── projects/
│   ├── generic/tests/ui/    通用页面冒烟
│   └── hireflow/
│       ├── fixtures/       账号、管理员 API 与写入保护装配
│       ├── helpers/        登录和测试数据辅助函数
│       └── tests/
│           ├── api/        公开、已登录与隔离写入 API 测试
│           └── ui/         公开与已登录浏览器测试
├── tests/
│   ├── unit/               平台策略的纯单元测试
│   └── integration/        本地 HTTP 防护、CLI 与用例发现测试
├── docs/
│   ├── architecture/       架构与依赖边界
│   ├── development/        目录、扩展和开发约定
│   ├── guides/             运行指南与安全规则
│   ├── validation/         验证记录与已知问题
│   └── roadmap.md          后续计划
├── playwright.config.ts    Playwright 标准配置入口
├── tsconfig.json           TypeScript 检查范围
├── qualityharbor.example.json 多项目配置示例
├── package.json            安装及运行命令
└── reports/                本地生成报告，不提交
```

根目录只保留项目说明、依赖清单、标准工具配置和环境变量示例。历史验收产物在被忽略的 `validation/` 中，和受版本管理的 `docs/validation/` 验证说明不同。

## 依赖方向

- `src/core/` 不依赖业务适配器；`src/fixtures/` 只组合共享安全能力。
- `projects/generic/` 直接使用共享 fixture，不导入 HireFlow，也不读取其账号环境变量。
- `projects/<项目>/fixtures/` 可以扩展共享 fixture，装配项目认证、角色与保护规则。
- `helpers/` 保存可复用登录步骤、数据工厂等，不放独立测试用例；完整业务流程留在 `tests/`。
- 业务测试仅访问目标 URL，不导入、安装依赖到或修改业务源码仓库。
- `tests/` 验证平台自身；`projects/*/tests/` 验证外部业务应用，两者不混用。

## 新增业务适配器

1. 在 `projects/<项目名>/` 下按需建立 `tests/api/`、`tests/ui/`、`fixtures/`、`helpers/`，不建立空占位目录。
2. 用例命名为 `<场景>.spec.ts`，API/UI 类型由目录区分；同一文件内的用例名称应明确表达预期行为。
3. 在 `playwright.config.ts` 注册项目分组和 `testMatch`，在 `src/cli/run.mjs` 注册 profile 与可靠的识别信号。
4. 从 `src/fixtures/test.ts` 扩展，按实际认证协议补充受限网络策略及测试。不要为适配业务关闭同源或写入保护。
5. 在 `tests/integration/runner.test.mjs` 增加用例发现与 profile 测试，并更新运行指南的覆盖范围。

没有专门适配器的应用只运行通用冒烟，不能视为完整业务验收。

## 本地校验

```bash
npm run test:unit
npm run test:integration
npm run typecheck
npm run check
```

`check` 汇总以上三项，不需要业务服务、测试账号或浏览器安装。集成测试只创建临时本地 HTTP 服务，CLI 验证配置、用例发现、运行隔离、失败/跳过/中断和并发结果。真实执行在临时平台副本与本地 HTTP fixture 上进行，不影响用户的历史报告。`npm run test:safety` 保留为原有安全回归命令。

业务测试命令不变。`npm run test:api` 和 `npm run test:ui` 选择 HireFlow 对应分组；`npm run test:smoke` 保持原有基础用例范围。完整用法见 [运行指南](../guides/running-tests.md)。
