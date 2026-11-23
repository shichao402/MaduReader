# 打开请求协议验收

日期：2026-11-23。环境：Windows，React 19 / Tauri 2 / Vite，真实 WebView2。

## 实现口径

- 外部打开请求由常驻 Rust 进程持有，使用内存 FIFO 队列；每个请求有递增 `requestId`，包含来源和全部路径。
- 前端先监听通知，再注册页面，按照既有规则恢复会话，报告就绪后主动领取队列。事件仅提示存在请求，不承载唯一业务数据。
- 领取不删除请求。业务执行结果被后端接受确认后才出队；成功与明确失败均需要确认，单个失败不阻塞后续请求。
- 页面重载或卸载废弃旧 `pageId` 执行租约，不清除未确认请求；旧页面的完成确认不会删除新页面正在处理的请求。
- 同一页面串行消费。执行完成但确认传输失败时缓存结果，用户重试仅补确认，不重复执行文件打开；不增加无限重试或业务延时。
- 窗口页面分为 Loading、Ready、Unloaded。Ready 唤醒只显示聚焦，Loading 不重复导航，Unloaded 才加载。关闭卸载任务绑定代次，后续唤醒取消旧任务。
- `app_ready` 仅报告首帧显示，1 秒兜底仅显示窗口，均不代表请求完成。保留关窗后 500ms 落盘窗口和导航空白页释放 DOM/JS 的托盘性能方案。
- 参数、拖放、文件/目录对话框、侧栏和命令面板使用同一 [openPaths.ts](../src/lib/openPaths.ts) 打开业务。侧栏和命令面板保留现有工作目录，复用已打开正文快照。
- 参数支持多个位置路径，按调用方 cwd 解析相对路径，支持 `--` 分隔。未知开关和空路径明确失败，不筛掉不存在文件。
- 日志保留原始 argv/cwd，以及 requestId、pageId、来源、每个路径结果和最终成功/失败状态。错误横幅显示业务失败；传输失败保留请求并提供重试。
- 队列仅驻留内存，不承诺进程崩溃后的请求恢复。没有新增数据库或复杂消息基础设施。

核心后端：[open_protocol.rs](../src-tauri/src/open_protocol.rs)、[resident.rs](../src-tauri/src/resident.rs)。核心前端：[openRequestReceiver.ts](../src/lib/openRequestReceiver.ts)、[OpenErrorBanner.tsx](../src/components/OpenErrorBanner.tsx)。

## 验证方法与隔离

使用真实 Windows 测试 exe、真实 single-instance 回调、Rust 队列和 Windows 文件系统；人工单步 CDP 操作、截图和目视检查，不使用 Playwright 等脚本 E2E 框架。

开发服务器保持专用端口 17973，原生调试端口为 17975，启动前检查端口空闲。测试配置和所有辅助脚本位于被忽略的本地 `.tmp`，没有修改产品 Vite、Tauri 配置、依赖或版本。

通过仅在构建进程内设置 `TAURI_CONFIG` 使用独立身份 `com.shichao402.madureader.openprotocoltest`，复制测试 exe 到 `.tmp/logs/madu-open-protocol-test.exe`，没有安装或替换正式版。

实际独立 WebView 缓存位于 `%LOCALAPPDATA%/com.shichao402.madureader.openprotocoltest/EBWebView`，并非全部落在工作区。测试日志和控制台副本位于 `.tmp/logs/`。

测试页面仅拦截指定 IPC 的配置/会话读写，转存独立 localStorage，保护正式版配置和会话。Rust `closeToTray` 仍只读现有产品配置，实施前核实开启，没有修改其值。

故障注入明确限定于 ACK 响应失败、暂停文件读取和初始化延迟。对话框仅注入选择结果，点击实际产品按钮；拖放采用目标为 main WebView 的原生事件注入，不宣称完成手工系统对话框或手工系统拖拽验收。业务队列、确认、文件授权和读取保持真实。

## 请求与生命周期结果

| 状态 | 方法与结果 | 证据 |
| --- | --- | --- |
| 冷启动与页面重载 | 冷启动请求 1 在初次夹具失败后仍保留；新页面 pageId=3 领取并实际打开 initial.md，确认成功 | `open-protocol-cold-state.json`、`open-protocol-initial.png` |
| 已就绪页面多路径 | 真实二次启动 second.md、third.markdown；同一请求 2 包含两条绝对路径，pageId 仍为 3，未重载，全部打开 | `open-protocol-multiple-state.json`、`open-protocol-multiple.png` |
| 卸载后加载中连续请求 | 真实 close 后确认 about:blank；注入初始化慢加载后连续二次启动目录、两个文件，只有一次 Navigate，后续 Wait，请求 3/4/5 按 FIFO 完成 | `open-protocol-unloaded-state.json`、`open-protocol-burst-state.json`、原生日志 |
| 处理中重载 | 暂停请求 6 的文件读取，Page.reload 后 pageId=9 重新领取同一请求，实际打开 hold.md 并确认成功 | `open-protocol-inflight-state.json`、`open-protocol-redelivered-state.json`、`open-protocol-redelivered.png` |
| ACK 传输失败 | 文件已打开但请求 7 未确认，出现保留/重试提示；点击真实重试按钮，重新领取同一请求并补确认，未增加重复标签 | `open-protocol-ack-failed-state.json`、`open-protocol-ack-retried-state.json`、`open-protocol-retry.png` |
| 不存在文件 | 真实传入未创建的 not-found.md；路径不存在错误可见，不创建错误标签，原正文保留，请求 8 被确认且日志 status=failed | `open-protocol-error-state.json`、`open-protocol-error-light.png`、`open-protocol-error-dark.png` |
| 目录对话框入口 | 点击真实目录按钮，注入 deep 的选择结果；实际读取 README.MARKDOWN 并切换工作目录 | `open-protocol-dialog-state.json` |
| 取消旧关闭任务 | 真实 close 后立即二次启动；Ready 页面只 Show，旧关闭 ticket 记录 obsolete，500ms 后没有卸载 | `open-protocol-close-cancelled-state.json`、原生日志 |
| 拖放入口 | 注入真实 WebView 拖放事件，经产品监听和共用服务打开 third.markdown | `open-protocol-noargs-restored-state.json` 中后续恢复状态 |
| 无参数卸载唤醒 | 真实 close、卸载、无参数二次启动；pageId=13、hasRequests=false，恢复 5 个旧标签和原活动 third.markdown，不重复冷启动文件 | `open-protocol-noargs-restored-state.json` |
| 未知启动开关 | 真实传入 --open initial.md；完整 argv 留痕，请求 10 明确失败并确认，不调用文件服务，旧正文和 5 个标签保留 | `open-protocol-unknown-args-state.json`、`open-protocol-unknown-args.png` |

完成确认返回 true 只表示后端接受结果，不等于业务成功；业务结论以 outcomes/error 和日志 status 为准。

所有表内截图已目视检查。暗色主题使用实际 `setTheme('dark')` 后核对 DOM `tauri dark` 和计算颜色，再拍照；未把仅改变 settings 状态的亮色截图冒充暗色验收。

## 补充界面回归与限制

工作区不存在验收说明中旧的 docs/README.md、docs/advanced.md，因此创建临时代表性 Markdown 文档，通过真实文件按钮打开，注入选择结果，不修改正式文档。

- 标题、表格、JavaScript 代码高亮、KaTeX、真实 Mermaid 和远程 PlantUML 图形均渲染。静态 HTTP SVG 图片解码成功，naturalWidth=300；Mermaid 实际宽 800px。
- 实际打开查找框、聚焦后通过原生文本输入 needle 并按 Enter，出现 2 处高亮和 `1 / 2` 匹配计数。
- 通过实际幻灯片按钮切换并点击下一页，第二页内容和 `2 / 2` 控件正常，暗色文字与背景清晰。
- 通过实际缩放按钮检查 200% / 50%，transform 分别为 scale(2) / scale(0.5)，工具栏结构正常。200% 保留既有大字号横向滚动行为，不将其宣称为新自适应排版。
- 补充检查中，相对本地 SVG 经既有 `asset.localhost` 路径转换出现加载失败，不能把 complete=true 当作解码成功。该路径未由本轮改动实现，未扩范围修改；后续用明确的 HTTP 图片仅验证渲染回归，不能代替本地 asset 协议验收。
- 测试 SVG 本身使用默认黑色文字，暗色下图片内容对比度不佳属于测试资源内容；未宣称任意图片都会随主题改色。错误横幅、正文、图表和幻灯片的主题验证独立。
- macOS Finder/LaunchServices 的 RunEvent::Opened 已进入共用队列，但没有 macOS 构建或实机验收，也没有宣称 Dock Reopen 完成。
- 未完成正式安装后文件关联、真实系统拖拽、系统文件选择对话框、UNC 网络卷、实际目录权限拒绝及进程崩溃恢复验收。

补充截图：[查找与渲染](../.tmp/screenshots/open-protocol-find.png)、[暗色真实图形](../.tmp/screenshots/open-protocol-ui-diagrams-dark.png)、[暗色幻灯片](../.tmp/screenshots/open-protocol-ui-slide-dark.png)、[200% 缩放](../.tmp/screenshots/open-protocol-zoom-max.png)、[50% 缩放](../.tmp/screenshots/open-protocol-zoom-min.png)。

本地图片失败截图：[本地相对图片检查](../.tmp/screenshots/open-protocol-ui-smoke-light.png)。这张不作为图片成功证据。

## 自动测试与恢复现场

- 新增前端定向测试：39/39 通过，包含 21 项打开服务、15 项协议接收器、3 项错误横幅。
- 全量前端：34 个文件、931/931 通过。ACK 重试不重复执行、丢 ACK 响应不重放、恢复中到达请求和取消初始化等由单元测试覆盖。
- Rust：28/28 通过，其中新增协议 14 项。收尾在清除 `TAURI_CONFIG` 的普通环境再次执行 `cargo test --locked --offline --manifest-path D:/workspace/MaduReader/src-tauri/Cargo.toml`，通过。
- `npm run build`：TypeScript 检查和 Vite 生产构建通过；既有 chunk 和混合导入警告未扩范围处理。
- `npx tsc --noEmit` 与 `git diff --check` 通过。
- 主题恢复 light、缩放恢复 100%、错误提示关闭，随后仅按测试 exe 路径和独立 WebView 身份结束测试进程，停止本轮 Vite 服务。17973/17975 均无监听，两个运行包装任务均已结束。
- 构建用 `TAURI_CONFIG` 未残留。没有修改正式安装、产品配置/会话、Git 凭据或发布配置；没有提交、推送、发 tag、发布 Stable 或安装新版本。

主要证据：[前端回归日志](../.tmp/logs/open-protocol-vitest.log)、[原生控制台](../.tmp/logs/open-protocol-native-console.log)、[现场恢复](../.tmp/logs/open-protocol-final-restored-state.json)、[进程与端口清理](../.tmp/logs/open-protocol-cleanup.json)。状态 JSON 和截图均是忽略目录内的本地证据，清理 `.tmp` 后不会随仓库保留。
