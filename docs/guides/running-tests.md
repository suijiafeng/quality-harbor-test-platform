# 执行测试

本指南说明 URL 测试、账号、隔离写入、覆盖范围和报告。项目结构见 [目录与扩展约定](../development/structure.md)。

## 首次安装

需要 Node.js 22.18+（推荐 Node.js 24）。

```bash
npm ci
npx playwright install chromium --only-shell
```

Linux CI 首次安装浏览器及系统依赖可用 `npx playwright install --with-deps chromium --only-shell`。

## 直接测试一个地址

先按业务项目自己的方式启动服务，再在**这个独立测试项目**里运行：

```bash
npm test -- http://localhost:5173
npm run report
```

也可以测试已经部署的、你有权测试的应用：

```bash
npm test -- https://your-test-app.example
```

- 自动探测 `/api/health`；明确返回 HireFlow 标识时运行 HireFlow 用例，否则仅运行 3 条通用检查，并明确打印 `profile: generic`。
- `generic` 的通过不表示业务流程、API 或权限正确。已知目标是 HireFlow 时可强制 `--profile=hireflow`，防止 API 健康异常导致退回通用检查。
- 请输入应用根地址，不能是 GitHub 仓库链接、某个页面路径、含 token 的 URL。
- 测试进程必须能访问该地址。`localhost` 是**运行测试的那台机器**，不是其他电脑或 GitHub 托管 runner。
- HireFlow 的页面与 `/api` 需通过这个地址同源访问，与你现有 Vite/Nginx 代理一致。
- 没有测试账号时，默认跑 23 条无业务写入检查；7 条账号相关用例、3 条写入用例标记为跳过。

其他常用命令：

```bash
npm test -- http://localhost:5173 --profile=hireflow
npm test -- http://localhost:5173 --profile=generic
npm run test:smoke -- http://localhost:5173
npm run test:api -- http://localhost:5173 --profile=hireflow
npm run test:ui -- http://localhost:5173 --profile=hireflow
npm test -- http://localhost:5173 --profile=hireflow --list
npm run check
```

`npm run check` 只验证测试项目自身的安全规则与 TypeScript，不代表被测应用通过。

## 保存多个项目

将根目录 `qualityharbor.example.json` 复制为 `qualityharbor.config.json`，修改项目地址：

```json
{
  "version": 1,
  "defaultProject": "web-local",
  "projects": {
    "web-local": {
      "name": "本地站点",
      "url": "http://localhost:3000",
      "profile": "generic",
      "suite": "smoke"
    },
    "hireflow-local": {
      "name": "HireFlow",
      "url": "http://localhost:5173",
      "profile": "hireflow",
      "suite": "all"
    }
  }
}
```

```bash
npm test -- --list-targets
npm test -- --target=web-local
npm test -- --target=hireflow-local --project=hireflow-api
npm test -- --config=./qualityharbor.config.json
npm test -- http://localhost:8080 --target=web-local --profile=generic
```

- `--target` 选择配置中的项目，`--project` 仍是 Playwright 用例分组，两者不同。
- `--target` 默认读取测试仓库根目录的 `qualityharbor.config.json`；显式 `--config` 路径相对于调用命令时的工作目录。指定配置但未指定项目时使用 `defaultProject`，未设置默认值则报错，不猜测目标。
- URL 优先级为命令行 URL > 所选项目 URL > `TARGET_URL`。`--profile` 覆盖项目设置；未配置时为 `auto`。直接 URL、未传配置选项时，不会自动加载本地配置。
- `suite` 为 `all` 或 `smoke`，默认 `all`；`--smoke` 可缩小范围。smoke 已有固定筛选，不能叠加 `--grep`，但可使用 `--project` 或测试文件筛选。需要自定义 `--grep` 时使用 all 范围。
- 项目 ID 只允许小写字母、数字、连字符和下划线，长度 1–64。配置严格拒绝未知字段、账号密码、写入开关和含认证信息的 URL。账号仍从私有环境变量注入，配置不能启用业务写入。
- `--list-targets` 只列配置，不访问目标；`--list` 不执行用例、不生成运行记录，但 `auto` 仍请求一次 `/api/health` 来识别适配器。要完全离线发现用例，请显式指定 `--profile=generic` 或 `--profile=hireflow`。

本地默认配置被 Git 忽略；其他命名的配置文件需自行确认是否适合提交。不要使用配置保存任何凭据。此版本每条命令测试一个项目，可顺序执行或并发启动不同命令。

## 可选：已登录的只读检查

只给 URL 可以检查公开页面、登录入口、未登录拦截等。要进入登录后的业务页面，需要专用测试账号。不要使用个人账号或生产管理员账号。

在终端或 CI 私有环境变量中设置 `HF_EMAIL` 与 `HF_PASSWORD`，然后使用同一条命令：

```bash
npm test -- http://localhost:5173 --profile=hireflow
```

此批用例目前要求该测试账号具有管理员权限，能读职位、候选人并打开新建职位弹窗。不会提交业务创建表单。登录会真实提交认证请求；它不是完全不与服务器交互的静态扫描。

不要把真实密码写入命令历史、仓库或报告。项目不会读取 `.env`，`.env.example` 仅列出可用环境变量；通过 shell/CI 环境注入。

## 可选：隔离本地业务流程

默认**关闭**候选人/职位写入测试。仅当目标是一个可丢弃的本地测试实例、使用独立测试数据库时：

1. 设置专用管理员 `HF_EMAIL`、`HF_PASSWORD`。
2. 设置 `HF_TEST_ENV=disposable`，确认数据库可丢弃。
3. 显式加 `--allow-writes`：

```bash
npm test -- http://localhost:5173 --profile=hireflow --allow-writes
```

写入目标仅允许 `localhost`、`127.0.0.1`、`[::1]`，远程目标被拒绝。这只是第二道防护：**本机反向代理或端口转发到生产数据库仍然不安全，不要这样运行**。

数据使用随机 `QA-` 前缀。普通候选人/职位 CRUD 用例清理自己创建的记录；招聘流水线没有删除应聘记录的 API，因此保留测试候选人、职位、应聘与审计记录。遇到回归失败也可能残留数据，所以必须使用一次性数据库。测试项目不会自动重置任何数据库。

## 覆盖范围

| 级别 | 条数 | 内容 |
| --- | ---: | --- |
| 通用 | 3 | 入口 HTTP、标题、未捕获 JavaScript 异常 |
| HireFlow 无账号 API | 9 | 健康契约、4 类未登录接口、4 类无效门户 token |
| HireFlow 无账号 UI | 11 | 登录控件、前端校验、4 条鉴权回跳、4 类门户错误、移动端宽度 |
| 有账号 API | 4 | 登录/当前用户一致性、职位与候选人分页及检索、分页参数验证 |
| 有账号 UI | 3 | 登录回跳与刷新、取消新建职位、退出与返回历史 |
| 显式本地写入 API | 3 | 候选人 CRUD/去重；职位 CRUD/默认阶段；应聘重复防护、乐观锁、回退原因、终段限制、淘汰/再激活 |
| **共计** | **33** | 一条流程用例包含多个断言 |

当前不覆盖真实 AI、文件上传/S3、真实邮件、完整面试排期、Offer 审批、电子签署、入职闭环、多角色行级数据范围、压力测试和像素级视觉比较。AI 在本次本地验证中使用被测项目自带 mock 模式。

## 输出与运行摘要

每次真实执行创建 `reports/runs/<项目 ID>/<运行 ID>/`；直接输入 URL 时项目 ID 为 `direct`。重复执行、失败或并发运行不会覆盖旧目录。

- `run.json`：项目、规范化 URL、适配器、范围、写入开关、开始时间、Node/Playwright 版本。不会保存账号环境变量或任意命令行参数。
- `summary.json`：整体状态、通过/失败/跳过/flaky/未执行数量，以及用例分组、名称、相对文件位置、结果和耗时。`selection.filtered=true` 表示使用过额外 Playwright 参数，复现筛选时需保留原命令。
- `html/index.html`、`junit.xml`、`results.json`：Playwright 原生报告。
- `artifacts/`：失败截图等诊断材料。
- `reports/latest.json`：最近完成运行的指针；并发时按完成顺序更新，只替换指针、不替换旧报告。

```bash
npm run report
npm run report -- reports/runs/hireflow-local/<运行ID>
```

默认打开最近完成的 HTML 报告；也可传旧运行目录。启动错误可能没有 HTML，此时查看该次 `summary.json`，不会静默打开更早的成功报告。旧版 `reports/html` 在没有新运行指针时仍可查看。

整体状态使用 Playwright 的 `passed` / `failed` / `timedout` / `interrupted`；进程未产出完整摘要时记录 `runner-error`，不会误报为通过。无结果、被前置失败阻断的用例计入 `notRun`，有意跳过计入 `skipped`；预期失败与重试成功按 Playwright 的 expected/flaky 规则保留。`globalErrorCount` 只记录运行器级错误数量，不把所有失败自动归因为业务缺陷。没有用例执行或存在跳过，不能视为全部业务验收通过。

保留 `--project`、测试文件、`--grep`（all 范围）、`--retries` 等筛选/执行选项。为保持报告与安全策略，入口不接受替换 Playwright 配置的 `-c`/`--tsconfig`、组合短参数、自定义 `--reporter`/`--output`、trace 或交互 UI 覆盖。新目录没有上次失败缓存，因此暂不支持 `--last-failed`；请根据摘要中的文件/用例定位后筛选重跑。`--list` 允许选择列表 reporter。

报告可能包含页面数据和 URL，只分享给有权查看的人。所有测试禁用 trace，以减少认证信息录制；但原生 Playwright 失败上下文仍可能包含表单值，分享报告前必须检查，不要使用个人或生产账号。摘要不复制错误正文、控制台输出、附件或环境变量，但不是原生报告的脱敏替代品。历史报告保留本地，当前不自动删除。

## 保守网络边界

浏览器请求仅允许同源，禁用 WebSocket 和 HTTP 30x 跳转（请传最终直达 URL）；默认阻断业务写请求，启用账号时只例外放行准确的登录接口。API 请求不跟随跳转，避免凭据或写入被重放到其他服务。

因此依赖外部 CDN、跨域 SSO、WebSocket 的应用可能失败，当前版本需要额外适配，不能把所有此类失败都判断为应用缺陷。SPA 客户端路由跳转不受影响。GET 请求是否具有副作用取决于目标实现，工具无法替任意应用保证 GET 绝无写入。
