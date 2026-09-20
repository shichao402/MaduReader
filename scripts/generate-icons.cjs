/**
 * Ma读 Logo 批量图标生成脚本
 * 源文件: logo_designs/ma-logo-standard.svg (potrace 临摹的标准原版)
 * 设计约定:
 *   - 应用图标: 圆角方形底 + 居中主体。大尺寸(>=64)留 4% 外边距、主体占 60%；
 *     小尺寸满幅、主体占 68%（保证小尺寸下主体可辨识）。
 *   - 应用图标固化浅色系（白底圆角 + 深蓝图形 + 细描边），不随主题变化。
 *   - 托盘图标透明底，分 light（深蓝图形，配浅色主题）与 dark（白色图形，配深色主题），
 *     运行时由 Rust 命令 set_tray_theme 按应用主题切换。
 * 产出: icons/light  浅色系应用图标 + 浅色托盘
 *       icons/dark   深色托盘
 *       src-tauri/icons  打包用图标 (ico/icns/png/svg/托盘对图)
 * 用法: npm run icons
 */
const fs = require('fs');
const path = require('path');
const { Resvg } = require('@resvg/resvg-js');
const _pngToIcoMod = require('png-to-ico');
const pngToIco = _pngToIcoMod.default ?? _pngToIcoMod;

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'icons');
const TAURI_ICONS = path.join(ROOT, 'src-tauri/icons');
const STD_SVG = path.join(ROOT, 'logo_designs/ma-logo-standard.svg');
const BBOX_JSON = path.join(ROOT, 'logo_designs/_glyph_bbox.json');

const stdSvg = fs.readFileSync(STD_SVG, 'utf8');
const dPath = / d="([^"]+)"/.exec(stdSvg)[1];
const bbox = JSON.parse(fs.readFileSync(BBOX_JSON, 'utf8'));

const C = {
  lightBg: '#FFFFFF',
  lightGlyph: '#16406F',
  lightBorder: '#D9E2EC',
  darkGlyph: '#FFFFFF'
};

/* 各场景构图参数：pad/radius 相对画布，glyph 为主体占画布比例 */
const PROFILES = {
  appLarge: { pad: 0.04, radius: 0.22, glyph: 0.60, border: true },
  appSmall: { pad: 0.00, radius: 0.18, glyph: 0.68, border: true },
  tray:     { pad: 0.00, radius: 0.00, glyph: 0.84, border: false }
};

/** 构建单枚 SVG 源（应用图标恒为浅色系；style 仅对托盘生效） */
function buildSvg({ size, style = 'light', profile, transparent = false }) {
  const p = PROFILES[profile];
  const glyphFill = profile === 'tray' && style === 'dark' ? C.darkGlyph : C.lightGlyph;
  const pad = size * p.pad;
  const side = size - pad * 2;
  const r = side * p.radius;
  const strokeW = p.border ? Math.max(1, size * 0.01) : 0;
  let bg = '';
  if (!transparent) {
    const stroke = p.border
      ? ` stroke="${C.lightBorder}" stroke-width="${strokeW}"`
      : '';
    bg = `<rect x="${pad}" y="${pad}" width="${side}" height="${side}" rx="${r}" fill="${C.lightBg}"${stroke}/>`;
  }
  const s = (size * p.glyph) / (bbox.x1 - bbox.x0);
  const tx = size / 2 - ((bbox.x0 + bbox.x1) / 2) * s;
  const ty = size / 2 - ((bbox.y0 + bbox.y1) / 2) * s;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}">${bg}` +
    `<g transform="translate(${tx} ${ty}) scale(${s})">` +
    `<path fill-rule="evenodd" fill="${glyphFill}" d="${dPath}"/></g></svg>`;
}

/** 渲染为 PNG Buffer（带缓存） */
const cache = new Map();
function renderPng(opts) {
  const key = JSON.stringify(opts);
  if (cache.has(key)) return cache.get(key);
  const svg = buildSvg(opts);
  const png = new Resvg(svg, { fitTo: { mode: 'width', value: opts.size } }).render().asPng();
  cache.set(key, png);
  return png;
}

const manifest = [];
function add(rel, buf) {
  const abs = path.join(OUT, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, buf);
  manifest.push(rel);
}

/** 构建 ICNS（icp4/icp5/ic07/ic08/ic09/ic10） */
function buildIcns(pngBySize) {
  const types = [['icp4', 16], ['icp5', 32], ['ic07', 128], ['ic08', 256], ['ic09', 512], ['ic10', 1024]];
  const chunks = [];
  for (const [type, size] of types) {
    const png = pngBySize.get(size);
    if (!png) continue;
    const head = Buffer.alloc(8);
    head.write(type, 0, 'ascii');
    head.writeUInt32BE(png.length + 8, 4);
    chunks.push(head, png);
  }
  const total = chunks.reduce((a, b) => a + b.length, 0) + 8;
  const head = Buffer.alloc(8);
  head.write('icns', 0, 'ascii');
  head.writeUInt32BE(total, 4);
  return Buffer.concat([head, ...chunks]);
}

function appProfile(size) {
  return size < 64 ? 'appSmall' : 'appLarge';
}

async function main() {
  /* ---------- 浅色系应用图标（固化，不随主题） ---------- */
  const icoSizes = [16, 24, 32, 48, 64, 128, 256];
  const icoPngs = icoSizes.map(s => renderPng({ size: s, profile: appProfile(s) }));
  add('light/windows/icon.ico', await pngToIco(icoPngs));

  for (const [size, name] of [
    [32, 'icon-32.png'], [128, 'icon-128.png'], [256, 'icon-128@2x.png'], [512, 'icon-512.png']
  ]) {
    add(`light/${name}`, renderPng({ size, profile: appProfile(size) }));
  }
  add('light/icon.svg', Buffer.from(buildSvg({ size: 1400, profile: 'appLarge' })));

  const icnsSources = [16, 32, 128, 256, 512, 1024]
    .map(s => [s, renderPng({ size: s, profile: appProfile(s) })]);
  add('light/macos/icon.icns', buildIcns(new Map(icnsSources)));

  /* ---------- 托盘图标（透明底，深浅两套，运行时按主题切换） ---------- */
  for (const style of ['light', 'dark']) {
    for (const s of [16, 20, 24, 32, 48]) {
      add(`${style}/tray/tray-${s}.png`,
        renderPng({ size: s, style, profile: 'tray', transparent: true }));
    }
    add(`${style}/tray/tray.svg`,
      Buffer.from(buildSvg({ size: 1400, style, profile: 'tray', transparent: true })));
  }

  /* ---------- 同步打包图标到 src-tauri/icons ---------- */
  fs.mkdirSync(TAURI_ICONS, { recursive: true });
  const syncMap = [
    ['light/windows/icon.ico', 'icon.ico'],
    ['light/macos/icon.icns', 'icon.icns'],
    ['light/icon-32.png', '32x32.png'],
    ['light/icon-128.png', '128x128.png'],
    ['light/icon-128@2x.png', '128x128@2x.png'],
    ['light/icon-512.png', 'icon.png'],
    ['light/icon.svg', 'icon.svg'],
    ['light/tray/tray-32.png', 'tray-light.png'],
    ['dark/tray/tray-32.png', 'tray-dark.png']
  ];
  for (const [src, dst] of syncMap) {
    fs.copyFileSync(path.join(OUT, src), path.join(TAURI_ICONS, dst));
    manifest.push(`src-tauri/icons/${dst} (copy)`);
  }

  /* ---------- 说明文档 ---------- */
  add('README.md', Buffer.from(`# Ma读 图标资源（自动生成）

由 [generate-icons.cjs](../scripts/generate-icons.cjs) 从标准原版
[ma-logo-standard.svg](../logo_designs/ma-logo-standard.svg) 批量生成，请勿手改，
改动请改源后执行 \`npm run icons\`。

## 设计约定
- 应用图标固化浅色系（白底圆角 + 深蓝图形 + 细描边），不随主题变化
- 大尺寸(>=64px)留 4% 边距、主体占 60%；小尺寸满幅、主体占 68%
- 托盘图标透明底：light（深蓝图形，浅色主题）/ dark（白色图形，深色主题），
  运行时由 Rust 命令 \`set_tray_theme\` 按应用主题切换

## 目录
- light/windows/icon.ico  16~256 七档
- light/icon-32/128/128@2x/512.png + icon.svg
- light/macos/icon.icns   16~1024 六档
- light/tray/ 与 dark/tray/  透明底托盘 16/20/24/32/48 + tray.svg

## 同步
脚本会把 ico/icns/png/svg 及 tray-light.png、tray-dark.png 复制到
\`src-tauri/icons/\`：打包用（tauri.conf bundle.icon）+ Rust 托盘 include_bytes 嵌入。
`));

  console.log(`✔ 生成 ${manifest.length} 个文件`);
  for (const rel of manifest) console.log('  ', rel);
}

main().catch(e => { console.error(e); process.exit(1); });
