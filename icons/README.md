# Ma读 图标资源（自动生成）

由 [generate-icons.cjs](../scripts/generate-icons.cjs) 从标准原版
[ma-logo-standard.svg](../logo_designs/ma-logo-standard.svg) 批量生成，请勿手改，
改动请改源后执行 `npm run icons`。

## 设计约定
- 应用图标固化浅色系（白底圆角 + 深蓝图形 + 细描边），不随主题变化
- 大尺寸(>=64px)留 4% 边距、主体占 60%；小尺寸满幅、主体占 68%
- 托盘图标带圆角底色：light（白底深蓝图形，浅色主题）/ dark（深蓝底白图形，深色主题），
  运行时由 Rust 命令 `set_tray_theme` 按应用主题切换

## 目录
- light/windows/icon.ico  16~256 七档
- light/icon-32/128/128@2x/512.png + icon.svg
- light/macos/icon.icns   16~1024 六档
- light/tray/ 与 dark/tray/  透明底托盘 16/20/24/32/48 + tray.svg

## 同步
脚本会把 ico/icns/png/svg 及 tray-light.png、tray-dark.png 复制到
`src-tauri/icons/`：打包用（tauri.conf bundle.icon）+ Rust 托盘 include_bytes 嵌入。
