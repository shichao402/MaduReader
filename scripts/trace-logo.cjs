const fs = require('fs');
const { PNG } = require('pngjs');
const potrace = require('potrace');

const SRC = 'logo_designs/v3_logo_04_pageflip_dot.png';
const BBOX = JSON.parse(fs.readFileSync('logo_designs/_bbox.json', 'utf8'));
const OUT_SVG = 'logo_designs/ma-logo-standard.svg';
const THRESH = 190;
const SCALE = 2;

const src = PNG.sync.read(fs.readFileSync(SRC));
const cw = BBOX.maxx - BBOX.minx + 1;
const ch = BBOX.maxy - BBOX.miny + 1;

// 1) 阈值提取白色图形掩码（蓝色底区域内部）
let mask = new Uint8Array(cw * ch);
for (let y = 0; y < ch; y++) {
  for (let x = 0; x < cw; x++) {
    const si = ((BBOX.miny + y) * src.width + (BBOX.minx + x)) * 4;
    const lum = 0.299 * src.data[si] + 0.587 * src.data[si + 1] + 0.114 * src.data[si + 2];
    mask[y * cw + x] = lum >= THRESH ? 1 : 0;
  }
}

// 2) 泛洪剔除与画布边缘连通的白色背景（圆角方外区域），只留图形本体
const stack = [];
for (let x = 0; x < cw; x++) { stack.push(x, 0, x, ch - 1); }
for (let y = 0; y < ch; y++) { stack.push(0, y, cw - 1, y); }
while (stack.length) {
  const y = stack.pop(), x = stack.pop();
  if (x < 0 || y < 0 || x >= cw || y >= ch || !mask[y * cw + x]) continue;
  mask[y * cw + x] = 0;
  stack.push(x + 1, y, x - 1, y, x, y + 1, x, y - 1);
}

// 3) 图形外接框（用于后续居中排版）
let gx0 = cw, gy0 = ch, gx1 = -1, gy1 = -1;
for (let y = 0; y < ch; y++) {
  for (let x = 0; x < cw; x++) {
    if (!mask[y * cw + x]) continue;
    if (x < gx0) gx0 = x;
    if (x > gx1) gx1 = x;
    if (y < gy0) gy0 = y;
    if (y > gy1) gy1 = y;
  }
}
console.log('glyph bbox in square:', gx0, gy0, gx1, gy1);

// 4) 放大 2 倍（双线性）输出灰度掩码：图形为黑、背景为白，供 potrace 描摹
const W = cw * SCALE, H = ch * SCALE;
const img = new PNG({ width: W, height: H });
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    const fx = x / SCALE, fy = y / SCALE;
    const x0 = Math.floor(fx), y0 = Math.floor(fy);
    const x1 = Math.min(x0 + 1, cw - 1), y1 = Math.min(y0 + 1, ch - 1);
    const dx = fx - x0, dy = fy - y0;
    const v = mask[y0 * cw + x0] * (1 - dx) * (1 - dy) +
      mask[y0 * cw + x1] * dx * (1 - dy) +
      mask[y1 * cw + x0] * (1 - dx) * dy +
      mask[y1 * cw + x1] * dx * dy;
    const g = Math.round(255 * (1 - v));
    const di = (y * W + x) * 4;
    img.data[di] = g; img.data[di + 1] = g; img.data[di + 2] = g; img.data[di + 3] = 255;
  }
}
fs.writeFileSync('logo_designs/_glyph_mask.png', PNG.sync.write(img));

// 5) potrace 矢量化，产出内容-only 标准 SVG
potrace.trace(fs.readFileSync('logo_designs/_glyph_mask.png'), {
  threshold: 128,
  turdSize: 10,
  optTolerance: 0.4,
  turnPolicy: potrace.TURNPOLICY_MINORITY
}, (err, svg) => {
  if (err) throw err;
  const d = /d="([^"]+)"/.exec(svg)[1];
  const out = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}">
  <title>Ma读 Logo 标准原版（临摹自 v3_logo_04_pageflip_dot）</title>
  <g fill="#FFFFFF"><path fill-rule="evenodd" d="${d}"/></g>
</svg>
`;
  fs.writeFileSync(OUT_SVG, out);
  fs.writeFileSync('logo_designs/_glyph_bbox.json', JSON.stringify({
    w: W, h: H,
    x0: gx0 * SCALE, y0: gy0 * SCALE,
    x1: (gx1 + 1) * SCALE, y1: (gy1 + 1) * SCALE
  }));
  console.log('saved:', OUT_SVG, '| viewBox:', `0 0 ${W} ${H}`, '| path chars:', d.length);
});
