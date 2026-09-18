/**
 * Ma读 Logo 批量图标生成脚本
 * 源文件: logo_designs/ma-logo-standard.svg (potrace 临摹的标准原版)
 * 产出:   icons/dark  深色风格（深蓝渐变底 + 白色图形）
 *         icons/light 浅色风格（白底 + 深蓝图形）
 * 覆盖:   Windows(ico/tiles) macOS(icns/png) Web(favicon/manifest/maskable) 托盘(透明底)
 * 用法:   npm run icons
 */
const fs = require('fs');
const path = require('path');
const { Resvg } = require('@resvg/resvg-js');
const _pngToIcoMod = require('png-to-ico');
const pngToIco = _pngToIcoMod.default ?? _pngToIcoMod;

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'icons');
const STD_SVG = path.join(ROOT, 'logo_designs/ma-logo-standard.svg');
const BBOX_JSON = path.join(ROOT, 'logo_designs/_glyph_bbox.json');

const stdSvg = fs.readFileSync(STD_SVG, 'utf8');
const dPath = / d="([^"]+)"/.exec(stdSvg)[1];
const bbox = JSON.parse(fs.readFileSync(BBOX_JSON, 'utf8'));

const C = {
  darkBgTop: '#1E5292',
  darkBgBottom: '#153C6C',
  darkGlyph: '#FFFFFF',
  lightBg: '#FFFFFF',
  lightGlyph: '#16406F'
};

/** 图形在画布中的占比 */
const SCALE_TILE = 0.62;   // 带底色的应用图标（留边呼吸感）
const SCALE_MASKABLE = 0.68; // PWA maskable（圆形裁切安全区）
const SCALE_TRAY = 0.84;   // 托盘（小尺寸尽量占满）

/** 构建单枚 SVG 源 */
function buildSvg({ size, style, transparent = false, glyphScale = SCALE_TILE }) {
  const glyphFill = style === 'dark' ? C.darkGlyph : C.lightGlyph;
  const s = (size * glyphScale) / (bbox.x1 - bbox.x0);
  const tx = size / 2 - ((bbox.x0 + bbox.x1) / 2) * s;
  const ty = size / 2 - ((bbox.y0 + bbox.y1) / 2) * s;
  let defs = '', bg = '';
  if (!transparent) {
    if (style === 'dark') {
      defs = `<defs><linearGradient id="g${size}" x1="0" y1="0" x2="0" y2="1">` +
        `<stop offset="0" stop-color="${C.darkBgTop}"/><stop offset="1" stop-color="${C.darkBgBottom}"/>` +
        `</linearGradient></defs>`;
      bg = `<rect width="${size}" height="${size}" fill="url(#g${size})"/>`;
    } else {
      bg = `<rect width="${size}" height="${size}" fill="${C.lightBg}"/>`;
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}">${defs}${bg}` +
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

async function main() {
  for (const style of ['dark', 'light']) {
    /* ---------- Windows ---------- */
    const icoSizes = [16, 24, 32, 48, 64, 128, 256];
    const icoPngs = icoSizes.map(s =>
      renderPng({ size: s, style, transparent: false, glyphScale: SCALE_TILE }));
    add(`${style}/windows/icon.ico`, await pngToIco(icoPngs));

    for (const s of [16, 24, 32, 48, 256]) {
      add(`${style}/windows/tiles/Square44x44Logo.targetsize-${s}.png`,
        renderPng({ size: s, style, transparent: false, glyphScale: SCALE_TILE }));
      add(`${style}/windows/tiles/Square44x44Logo.targetsize-${s}_altform-unplated.png`,
        renderPng({ size: s, style, transparent: true, glyphScale: SCALE_TRAY }));
    }
    add(`${style}/windows/tiles/Square150x150Logo.png`,
      renderPng({ size: 150, style, transparent: false, glyphScale: SCALE_TILE }));
    add(`${style}/windows/tiles/Square310x310Logo.png`,
      renderPng({ size: 310, style, transparent: false, glyphScale: SCALE_TILE }));
    add(`${style}/windows/tiles/StoreLogo.png`,
      renderPng({ size: 50, style, transparent: false, glyphScale: SCALE_TILE }));

    /* ---------- macOS ---------- */
    const macFiles = [
      [16, 'icon_16x16.png'], [32, 'icon_16x16@2x.png'],
      [32, 'icon_32x32.png'], [64, 'icon_32x32@2x.png'],
      [128, 'icon_128x128.png'], [256, 'icon_128x128@2x.png'],
      [256, 'icon_256x256.png'], [512, 'icon_256x256@2x.png'],
      [512, 'icon_512x512.png'], [1024, 'icon_512x512@2x.png']
    ];
    for (const [size, name] of macFiles) {
      add(`${style}/macos/${name}`,
        renderPng({ size, style, transparent: false, glyphScale: SCALE_TILE }));
    }
    const icnsSources = [16, 32, 128, 256, 512, 1024]
      .map(s => [s, renderPng({ size: s, style, transparent: false, glyphScale: SCALE_TILE })]);
    add(`${style}/macos/icon.icns`, buildIcns(new Map(icnsSources)));

    /* ---------- Web ---------- */
    for (const s of [16, 32, 48]) {
      add(`${style}/web/favicon-${s}.png`,
        renderPng({ size: s, style, transparent: false, glyphScale: SCALE_TILE }));
    }
    add(`${style}/web/apple-touch-icon.png`,
      renderPng({ size: 180, style, transparent: false, glyphScale: SCALE_TILE }));
    for (const s of [192, 512]) {
      add(`${style}/web/maskable-${s}.png`,
        renderPng({ size: s, style, transparent: false, glyphScale: SCALE_MASKABLE }));
    }
    add(`${style}/web/site.webmanifest`, Buffer.from(JSON.stringify({
      name: 'Ma读', short_name: 'Ma读',
      icons: [
        { src: 'maskable-192.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
        { src: 'maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }
      ],
      theme_color: style === 'dark' ? C.darkBgTop : C.lightGlyph,
      background_color: style === 'dark' ? C.darkBgBottom : C.lightBg,
      display: 'standalone'
    }, null, 2)));

    /* ---------- 托盘 ---------- */
    for (const s of [16, 20, 24, 32, 48]) {
      add(`${style}/tray/tray-${s}.png`,
        renderPng({ size: s, style, transparent: true, glyphScale: SCALE_TRAY }));
    }

    /* ---------- SVG 源 ---------- */
    add(`${style}/icon.svg`, Buffer.from(buildSvg({ size: 1400, style, transparent: false, glyphScale: SCALE_TILE })));
    add(`${style}/tray/tray.svg`, Buffer.from(buildSvg({ size: 1400, style, transparent: true, glyphScale: SCALE_TRAY })));
  }

  /* ---------- 说明文档 ---------- */
  add('README.md', Buffer.from(`# Ma读 图标资源（自动生成）

由 [generate-icons.cjs](../scripts/generate-icons.cjs) 从标准原版
[ma-logo-standard.svg](../logo_designs/ma-logo-standard.svg) 批量生成，请勿手改，
改动请改源 SVG 后重新执行 \`npm run icons\`。

## 目录结构
- \`dark/\` 深色风格：深蓝渐变底 (#1E5292 → #153C6C) + 白色图形
- \`light/\` 浅色风格：白底 + 深蓝图形 (#16406F)

每个风格目录下：
- \`windows/icon.ico\` 含 16/24/32/48/64/128/256 七档
- \`windows/tiles/\` UWP 磁贴（含 altform-unplated 透明版）
- \`macos/icon.icns\` 含 16~1024 六档 + 全套 icon_*x*.png（含 @2x）
- \`web/\` favicon-16/32/48、apple-touch-icon-180、maskable-192/512、site.webmanifest
- \`tray/\` 透明底托盘图标 16/20/24/32/48（dark 风格=白图形配深色标题栏，light 风格=蓝图形配浅色标题栏）
- \`icon.svg\` / \`tray/tray.svg\` 矢量源

## Tauri 接入
把 \`dark/windows/icon.ico\` 覆盖到 \`src-tauri/icons/icon.ico\`，
\`dark/macos/icon.icns\` 覆盖到 \`src-tauri/icons/icon.icns\`，
托盘用 \`dark/tray/tray-32.png\`（深色主题）或 \`light/tray/tray-32.png\`（浅色主题）。
`));

  console.log(`✔ 生成 ${manifest.length} 个文件`);
  for (const rel of manifest) console.log('  ', rel);
}

main().catch(e => { console.error(e); process.exit(1); });
