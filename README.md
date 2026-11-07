# QualityHarbor Test Platform

基于 Playwright 的独立自动化测试项目。传入已启动应用的 URL，即可运行通用冒烟或 HireFlow API/UI 回归；不拉取、启动或修改业务项目。

## 快速开始

需要 Node.js 22.18+（推荐 24）。

```bash
npm ci
npx playwright install chromium --only-shell
npm test -- http://localhost:5173
npm run report
```

将示例地址换成测试进程可访问的应用根地址。自动识别 HireFlow，其他应用运行通用冒烟；通用结果不代表业务功能验收。已知为 HireFlow 时可显式指定：

```bash
npm test -- http://localhost:5173 --profile=hireflow
npm run test:smoke -- http://localhost:5173
npm run check
```

`npm run check` 验证测试平台自身，不连接业务应用。报告输出到 `reports/`。

## 目录

```text
src/         运行入口、共享安全策略与 Playwright fixtures
projects/    各项目的 API/UI 用例、fixtures 与辅助函数
tests/      平台自身的单元和集成测试
docs/       使用、安全、架构和验收文档
```

## 安全边界

- 默认只读。账号检查使用专用测试账号；业务写入仅支持显式启用的一次性本地环境。
- 不提交密码、token、测试数据或生成报告。报告分享前需检查敏感信息。
- 默认仅允许同源请求，阻断 HTTP 重定向和 WebSocket；外部 CDN/SSO 需要额外适配。

## 文档

- [执行测试与覆盖范围](docs/guides/running-tests.md)
- [目录与扩展约定](docs/development/structure.md)
- [安全边界](docs/guides/security.md)
- [验证记录与已知问题](docs/validation/README.md)
- [全部文档](docs/README.md)
