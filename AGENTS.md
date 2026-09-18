# MDReader 开发约定（面向 AI Agent）

## 项目

基于 Tauri 2.x + Vue 3 + Vite 的 Markdown 阅读器。单元测试用 Vitest（`npm test`）。

## E2E 测试（强制）

本项目不使用 Playwright 等脚本 e2e 框架。**每次 UI 改动后，Agent 必须亲自执行自我验证闭环**：启动 dev server → 浏览器操作关键状态 → 截图 → 目视判定 → 修复重跑 → 恢复现场。完整流程与检查清单见 [e2e/README.md](e2e/README.md)。未走该闭环的 UI 改动不得直接交付。

## 端口规则（强制）

- 所有端口一律不使用框架默认值（Vite 5173/1420、Web 常用 3000/8080 等），因为用户同时开发多个项目，禁止端口冲突。
- 本项目 dev server 专用端口：**17973**（3 处同步：`vite.config.ts`、`src-tauri/tauri.conf.json`、`e2e/README.md`）。
- 新增任何服务前先确认端口未被占用，并选用非默认端口。
