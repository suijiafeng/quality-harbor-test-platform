# QualityHarbor v0.1 架构

## 目标与边界

独立测试项目只接收一个已启动应用的 URL。业务项目由其原有方式运行；QualityHarbor 不导入业务源码、不修改业务仓库、不启动或重置业务服务。

## 组成

- `scripts/run.mjs`：URL 校验、自动识别适配器、基础冒烟入口、显式写入开关、调用 Playwright。
- `playwright.config.ts`：项目分组、单 worker 执行、超时、HTML/JSON/JUnit 报告。
- `scripts/safety.mjs`：地址与一次性本地写入约束。
- `scripts/request-policy.mjs`：同源、方法、认证例外、重定向防护、错误信息脱敏。
- `projects/generic/`：跨项目通用冒烟检查。
- `projects/hireflow/`：第一个真实应用适配器，包括 API、浏览器与可选隔离业务流程。
- `tests/safety.test.mjs`：测试工具自己的安全回归，不连接业务项目。

执行关系：输入 URL → 识别适配器 → 选择用例 → HTTP/API 与浏览器黑盒测试 → 原生 Playwright 报告。

## 复用成熟能力

浏览器驱动、API 请求、等待/断言、并发、失败截图、报告由 Playwright 提供。v0.1 不重复开发测试引擎、报告网站、低代码录制器或任务调度平台。

## 后续接入项目

先定义该项目的入口、公开页面、鉴权方式及最小业务断言，再在本测试仓库增加 `projects/<项目>/`，注册项目识别和 Playwright 分组。未知项目只能得到通用冒烟结果，不能被视为完整业务验收。

## 当前限制

只支持应用根 URL 与同源 API；HTTP 跳转、外域 CDN/SSO、WebSocket 默认阻断。认证账号通过进程环境注入。仅实现 HireFlow 的部分业务规则，没有通用业务语义推断、录制/回放管理、平台 Web UI 或多租户服务。
