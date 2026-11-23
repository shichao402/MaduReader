# 目录同步与图表展示验收

日期：2026-11-23。环境：Windows，React 19 / Tauri 2 / Vite，浏览器窗口 1320×920、1000×700、1100×760。

## 实现口径

- 真实工作目录使用 plugin-fs 的递归 `watchImmediate`；开启 Rust `watch` feature 和 `fs:allow-watch`、`fs:allow-unwatch`，仍复用用户选中路径的递归授权，不增加全盘 scope。
- 事件仅标记需要对账：300ms 防抖、最长 2 秒等待、串行整树扫描；扫描期间变化补扫，工作目录代次隔离。
- 路径相同的目录保留当前展开状态；刷新不重载正文、不切换活动标签。打开的源文件移动或删除后保留快照，并显示缺失提示。
- 根读取失败保留旧树并显示错误；失败子目录保留已知子树，不把读取错误当成文件删除。只展示 Markdown 和包含 Markdown 后代的目录。
- 前台每 60 秒对账并重建监听，以防运行错误或根替换导致句柄静默失效；启动失败时前台每 10 秒轮询和重试。后台暂停，恢复窗口时重建并补扫。
- 图形预览完整等比例适配并居中，适配基准为 100%；百分比相对该基准，点击比例重新适配。小矢量图可放大，普通小位图不主动放大，超大图允许低于旧绝对 0.2 下限。
- 自动模式随窗口变化重新适配；用户缩放或拖动后保留 transform，点击比例才恢复自动模式。
- 正文只对 PlantUML、Mermaid 铺满可用宽度。折叠容器视觉高度上限为 `min(正文滚动可视高度 × 0.7, 600px)`，换算正文 transform zoom 后的布局尺寸；不是把整张图缩小到上限中。
- 超高图保留顶部、底部主题渐隐及展开按钮；原位展开完整高度，宽度和比例不变。折叠按钮不触发全屏，全屏始终使用完整原始载荷。
- 尺寸观察通知合并到下一动画帧，公开刷新保持同步；取消迟到帧并避免等值 DOM 重写，消除观察器递送中的尺寸反馈循环。

## 验证方法

人工浏览器交互、截图、目视判定、修复后重测，没有新增 Playwright 等 E2E 脚本框架。

为保护正式版配置与会话，使用 `.tmp/logs/native-fixture` 独立目录和内存配置。开发服务器使用项目专用端口 17973；隔离桥绑定 `127.0.0.1:17974`，不改产品端口配置。

目录事件来自临时 Rust 程序的真实 Windows `notify 8.2.0` 递归监听，启用与 plugin-fs 一致的 `serde`、`serialization-compat-6`。桥接真实 plugin-fs JavaScript Channel、App、store 和目录同步控制器。桥只模拟 IPC 传输，不是安装后的 Tauri IPC 与权限实机验收。

## 已验证状态

- 监听启动后真实新增深层 `.md` / `.markdown`、原本空目录内的首个 Markdown、25 个批量文件；无需点击刷新即可进入目录树。
- 真实删除、文件重命名、跨目录移动；`docs/deep` 展开保持，活动文档 ID 和 198 字符内容快照保持不变，源移动时 `sourceMissing=true`。
- A → B → A 切换后只保留一个当前目录原生监听，旧监听释放；更严格的迟到扫描与 A → B → A 竞态由单元测试覆盖。
- 用产品同名 `madu:hide-before-close` / `focus` 诊断事件验证监听释放和恢复；不是操作真实托盘或系统休眠。
- 在隔离桥注入根 `read_dir` 失败，错误提示、旧目录和正文快照均保留；撤销注入后创建真实文件触发通知，错误自动消失。不修改本机目录权限。
- 浅色和深色目录提示、正文、渐隐与按钮无明显布局或对比度异常。
- 真实 Mermaid 横图正文宽 800px，高约 69px；窄长图保持 800px 宽，原高约 7848px，折叠容器高 600px，展开后显示完整高度且未打开 lightbox。
- SVG 图片窄长图正文原高 12000px，折叠容器高 600px；普通位图加载后仍为 64×64px，正文与全屏都不被强制放大。
- 小矢量图全屏自动放大；10000×1000 超大图适配比例 0.1224，视觉尺寸 1224×122.4px，相对基准仍显示 100%。
- 窄长 Mermaid 全屏显示完整 19 步，1320×920 → 1000×700 时绝对 scale 从 0.46784 变为 0.334345，仍为 100%；用户放大到 120% 后再 resize，transform 完全保持。
- 点击百分比重新居中适配，Esc 关闭返回正文；展开和明确收起的入口独立于全屏。
- 真实 PlantUML 默认渲染服务返回图形，正文铺宽/折叠、全屏完整适配，KaTeX 公式正常。修复尺寸反馈循环后重测真实图、resize、Mermaid 和正文 110% 缩放，记录的 `pageErrors` 为空。
- 110% 正文缩放时，视觉折叠高约 494.9px，符合当时正文滚动区 707px × 0.7，而非把 zoom 再乘进视觉上限。

## 回归结果

- `npm test`：31 个测试文件，892 项通过。
- `npm run build`：类型检查和 Vite 生产构建通过。
- 在 `src-tauri` 目录执行 `cargo test --locked --offline`：14 项 Rust 测试通过；根目录运行会缺少仓内镜像配置，不应混淆为产品测试失败。
- `git diff --check`：通过；另检查新增未跟踪源码和测试的行尾空白。
- 既有 Vite chunk / 静态动态混合导入提示、Vitest 配置弃用提示未作为本轮功能扩范围修改。

## 证据与限制

截图位于被忽略的本地临时目录，清理后不会长期随仓库存在：

- [目录外部变更与缺失提示，深色](../.tmp/screenshots/directory-mutations-dark.png)
- [长图折叠，浅色](../.tmp/screenshots/inline-tall-collapsed-light.png)
- [长图展开，浅色](../.tmp/screenshots/inline-tall-expanded-light.png)
- [小矢量图全屏，深色](../.tmp/screenshots/lightbox-small-vector-dark.png)
- [普通位图全屏](../.tmp/screenshots/lightbox-bitmap-dark.png)
- [超大图完整适配](../.tmp/screenshots/lightbox-huge-dark.png)
- [真实 PlantUML 修复后](../.tmp/screenshots/real-plantuml-resize-fixed-dark.png)
- [真实 PlantUML 全屏](../.tmp/screenshots/real-plantuml-lightbox-fixed-dark.png)
- [根读取失败保护](../.tmp/screenshots/directory-read-error-light.png)

状态 JSON 与日志位于 `.tmp/logs/`。关键文件：`directory-after-mutations.json`、`directory-read-error.json`、`directory-read-recovered.json`、`directory-workspace-switch.json`、`inline-expanded.json`、`lightbox-auto-resize.json`、`lightbox-user-after-resize.json`、`lightbox-huge.json`、`real-plantuml-resize-fixed.json`、`inline-zoom-fixed.json`、`final-tests.log`、`final-build.log`、`final-rust-tests.log`。

未宣称完成 macOS 实机、安装后 Tauri IPC/权限、UNC 网络卷、真实托盘、休眠恢复的运行验收。跨平台后端选择和相关边界以代码、依赖及单元测试核对。根目录整体重命名在本机夹具中被其他文件系统句柄拒绝，未绕过占用或修改权限；其读取失败 UI 通过隔离桥故障注入验证，静默失效与无 focus 的周期恢复由单元测试覆盖。

浏览器坐标拖拽接口返回语法错误，未将其计为拖拽实测通过；鼠标锚点、拖动、pointer cleanup 与用户模式 resize 的细节由单元测试覆盖。没有修改正式版配置、安装或会话；未提交、推送、发布 Stable。
