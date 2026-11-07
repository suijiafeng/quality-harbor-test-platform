# 架构与边界

QualityHarbor 只接收一个已启动应用的 URL。业务项目由其原有方式运行；测试平台不导入业务源码、不修改业务仓库、不启动或重置业务服务。

## 执行链路

输入 URL → 校验地址与写入条件 → 识别适配器 → 选择 API/UI 用例 → HTTP 与浏览器黑盒测试 → Playwright 报告。

## 分层

- `src/cli/run.mjs`：参数解析、profile 识别、冒烟筛选和 Playwright 调度；从任意工作目录调用时，都在测试项目根目录执行。
- `src/core/target.mjs`：应用根地址校验与一次性本地写入约束。
- `src/core/request-policy.mjs`：同源、请求方法、受限认证例外、重定向防护与错误脱敏。
- `src/fixtures/test.ts`：可复用的 API/浏览器请求保护，不依赖任何业务适配器。
- `projects/`：通用冒烟和业务适配器。HireFlow 的账号与管理员会话只在其自身 fixture/helper 中装配。
- `tests/`：平台自身回归，与对外部业务运行的测试分开。
- `playwright.config.ts`：标准配置入口，统一分组、超时、单 worker、截图与 HTML/JSON/JUnit 报告。

目录职责与新增项目步骤见 [目录与扩展约定](../development/structure.md)。

## 复用与限制

浏览器驱动、API 请求、等待/断言、失败截图、报告由 Playwright 提供。不重复开发测试引擎、报告网站、低代码录制器或任务调度平台。

当前只支持应用根 URL 与同源 API；HTTP 跳转、外域 CDN/SSO、WebSocket 默认阻断。仅实现 HireFlow 的部分业务规则，没有通用业务语义推断、录制/回放管理、平台 Web UI 或多租户服务。
