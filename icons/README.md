# Ma读 图标资源（自动生成）

由 [generate-icons.cjs](../scripts/generate-icons.cjs) 从标准原版
[ma-logo-standard.svg](../logo_designs/ma-logo-standard.svg) 批量生成，请勿手改，
改动请改源 SVG 后重新执行 `npm run icons`。

## 目录结构
- `dark/` 深色风格：深蓝渐变底 (#1E5292 → #153C6C) + 白色图形
- `light/` 浅色风格：白底 + 深蓝图形 (#16406F)

每个风格目录下：
- `windows/icon.ico` 含 16/24/32/48/64/128/256 七档
- `windows/tiles/` UWP 磁贴（含 altform-unplated 透明版）
- `macos/icon.icns` 含 16~1024 六档 + 全套 icon_*x*.png（含 @2x）
- `web/` favicon-16/32/48、apple-touch-icon-180、maskable-192/512、site.webmanifest
- `tray/` 透明底托盘图标 16/20/24/32/48（dark 风格=白图形配深色标题栏，light 风格=蓝图形配浅色标题栏）
- `icon.svg` / `tray/tray.svg` 矢量源

## Tauri 接入
把 `dark/windows/icon.ico` 覆盖到 `src-tauri/icons/icon.ico`，
`dark/macos/icon.icns` 覆盖到 `src-tauri/icons/icon.icns`，
托盘用 `dark/tray/tray-32.png`（深色主题）或 `light/tray/tray-32.png`（浅色主题）。
