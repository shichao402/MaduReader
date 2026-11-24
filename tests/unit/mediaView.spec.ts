import { describe, expect, it } from 'vitest'
import {
  canUpscaleMedia,
  decorateViewableMedia,
  fitTransform,
  mediaPayloadFromEventTarget,
  panBy,
  prepareSvgMarkup,
  relativeScalePercent,
  wheelZoomDelta,
  zoomAtPoint,
  zoomBy,
  MAX_VIEW_SCALE,
  MIN_VIEW_SCALE,
} from '../../src/lib/mediaView'

const SAMPLE = `
  <svg id="flow" class="mermaid-svg" viewBox="0 0 120 40"><rect id="box" fill="url(#paint)"/></svg>
  <figure class="plantuml-diagram"><img alt="PlantUML diagram" src="https://example.com/diagram.svg"></figure>
  <p><img alt="封面" src="data:image/svg+xml;base64,abc"></p>
  <span class="katex"><svg class="katex-svg"></svg></span>
`

describe('decorateViewableMedia', () => {
  it('给流程图、PlantUML 和普通图片加上全屏入口，跳过公式', () => {
    const doc = new DOMParser().parseFromString(decorateViewableMedia(SAMPLE), 'text/html')
    const frames = doc.querySelectorAll('.media-frame')
    expect(frames).toHaveLength(3)
    expect(doc.querySelectorAll('.media-expand')).toHaveLength(3)
    expect(doc.querySelector('[data-media-kind="mermaid"] svg.mermaid-svg')).toBeTruthy()
    expect(doc.querySelector('figure.plantuml-diagram.media-frame > .media-expand')).toBeTruthy()
    expect(doc.querySelector('[data-media-kind="image"] img')?.getAttribute('alt')).toBe('封面')
    expect(doc.querySelector('.katex .media-frame')).toBeNull()
    expect(doc.querySelectorAll('[data-media-kind="plantuml"] .media-frame')).toHaveLength(0)
  })

  it('重复装饰不会叠两层按钮', () => {
    const once = decorateViewableMedia(SAMPLE)
    const twice = decorateViewableMedia(once)
    const doc = new DOMParser().parseFromString(twice, 'text/html')
    expect(doc.querySelectorAll('.media-expand')).toHaveLength(3)
  })
})

describe('mediaPayloadFromEventTarget', () => {
  it('从全屏按钮、图本身读取对应内容', () => {
    const doc = new DOMParser().parseFromString(decorateViewableMedia(SAMPLE), 'text/html')
    const mermaidBtn = doc.querySelector('[data-media-kind="mermaid"] .media-expand')
    const plant = doc.querySelector('[data-media-kind="plantuml"] img')
    const image = doc.querySelector('[data-media-kind="image"] img')

    expect(mediaPayloadFromEventTarget(mermaidBtn)?.kind).toBe('svg')
    expect(mediaPayloadFromEventTarget(mermaidBtn)?.svg).toContain('<svg')
    expect(mediaPayloadFromEventTarget(plant)).toMatchObject({
      kind: 'image',
      label: 'PlantUML',
      src: 'https://example.com/diagram.svg',
    })
    expect(mediaPayloadFromEventTarget(image)).toMatchObject({
      kind: 'image',
      label: '封面',
    })
    expect(mediaPayloadFromEventTarget(doc.body)).toBeNull()
  })

  it('PlantUML 无扩展名的 SVG 地址仍允许自动放大', () => {
    const html = '<figure class="plantuml-diagram"><img src="https://example.com/plantuml/svg/encoded"></figure>'
    const doc = new DOMParser().parseFromString(decorateViewableMedia(html), 'text/html')
    const payload = mediaPayloadFromEventTarget(doc.querySelector('img'))!
    expect(payload.allowUpscale).toBe(true)
    expect(canUpscaleMedia(payload)).toBe(true)
  })
})

describe('canUpscaleMedia', () => {
  it('识别内联 SVG、SVG 文件和 data URL，不自动放大普通位图', () => {
    expect(canUpscaleMedia({ kind: 'svg', svg: '<svg/>', label: '图' })).toBe(true)
    expect(canUpscaleMedia({ kind: 'image', src: 'diagram.SVG?version=2#view', label: '图' })).toBe(true)
    expect(canUpscaleMedia({ kind: 'image', src: 'data:image/svg+xml;base64,abc', label: '图' })).toBe(true)
    expect(canUpscaleMedia({ kind: 'image', src: 'data:image/svg+xml;charset=utf-8,%3Csvg', label: '图' })).toBe(true)
    expect(canUpscaleMedia({ kind: 'image', src: 'photo.png?name=diagram.svg', label: '图片' })).toBe(false)
    expect(canUpscaleMedia({ kind: 'image', src: 'data:image/png;base64,abc', label: '图片' })).toBe(false)
  })
})

describe('prepareSvgMarkup', () => {
  it('按 viewBox 取尺寸，并改写内部 id 避免和正文冲突', () => {
    const prepared = prepareSvgMarkup(
      '<svg viewBox="0 0 200 80"><defs><linearGradient id="g1"/></defs><rect fill="url(#g1)"/></svg>',
    )
    expect(prepared.width).toBe(200)
    expect(prepared.height).toBe(80)
    expect(prepared.markup).not.toContain('id="g1"')
    expect(prepared.markup).toContain('url(#')
    expect(prepared.markup).not.toContain('url(#g1)')
    expect(new DOMParser().parseFromString(prepared.markup, 'text/html').querySelector('svg')!.style.display).toBe('block')
  })

  it('真实 Mermaid 多行 HTML 标签的 outerHTML 仍使用 viewBox，不退回 800×600', () => {
    const prepared = prepareSvgMarkup('<svg xmlns="http://www.w3.org/2000/svg" width="100%" style="max-width:1095px" viewBox="4 4 1095 628"><foreignObject width="200" height="80"><div xmlns="http://www.w3.org/1999/xhtml"><p>ChessController<br>StateMachine<br>ChessState</p></div></foreignObject></svg>')
    expect(prepared.width).toBe(1095)
    expect(prepared.height).toBe(628)
    const doc = new DOMParser().parseFromString(prepared.markup, 'text/html')
    const svg = doc.querySelector('svg')!
    expect(svg.getAttribute('width')).toBe('1095')
    expect(svg.getAttribute('height')).toBe('628')
    expect(svg.querySelectorAll('foreignObject br')).toHaveLength(2)
    expect(svg.querySelector('foreignObject')?.textContent).toContain('ChessController')
    expect(svg.style.getPropertyValue('max-width')).toBe('none')
    expect(svg.style.getPropertyPriority('width')).toBe('important')
  })

  it('正文留下的 important 尺寸限制不能压缩全屏图形', () => {
    const prepared = prepareSvgMarkup('<svg viewBox="0 0 1200 700" style="width:100%!important;height:auto!important;max-width:300px!important;max-height:200px!important"/>')
    const svg = new DOMParser().parseFromString(prepared.markup, 'text/html').querySelector('svg')!
    expect(svg.style.width).toBe('1200px')
    expect(svg.style.height).toBe('700px')
    expect(svg.style.maxWidth).toBe('none')
    expect(svg.style.maxHeight).toBe('none')
  })
})

describe('view transform', () => {
  it('滚轮缩放保持光标下的内容点不动', () => {
    const start = { scale: 1, x: 20, y: 40 }
    const cursorX = 120
    const cursorY = 80
    const beforeX = (cursorX - start.x) / start.scale
    const beforeY = (cursorY - start.y) / start.scale
    const next = zoomAtPoint(start, cursorX, cursorY, -100)
    expect(next.scale).toBeGreaterThan(start.scale)
    expect((cursorX - next.x) / next.scale).toBeCloseTo(beforeX)
    expect((cursorY - next.y) / next.scale).toBeCloseTo(beforeY)
  })

  it('可以放大到远超 800%', () => {
    let t = { scale: 8, x: 0, y: 0 }
    for (let i = 0; i < 10; i++) t = zoomBy(t, 1.2, 10, 10)
    expect(t.scale).toBeGreaterThan(40)
    expect(MAX_VIEW_SCALE).toBeGreaterThanOrEqual(100)
  })

  it('缩放到边界后不再变化', () => {
    const maxed = zoomBy({ scale: MAX_VIEW_SCALE, x: 0, y: 0 }, 2, 10, 10)
    const mined = zoomBy({ scale: MIN_VIEW_SCALE, x: 0, y: 0 }, 0.5, 10, 10)
    expect(maxed.scale).toBe(MAX_VIEW_SCALE)
    expect(mined.scale).toBe(MIN_VIEW_SCALE)
  })

  it('大图缩小适应窗口，普通小位图保持原始尺寸并居中', () => {
    const large = fitTransform(800, 600, 1600, 1200)
    expect(large.scale).toBeLessThan(1)
    expect(large.x).toBeCloseTo((800 - 1600 * large.scale) / 2)
    const small = fitTransform(800, 600, 200, 100)
    expect(small.scale).toBe(1)
    expect(small.x).toBeCloseTo(300)
    expect(small.y).toBeCloseTo(250)
    expect(relativeScalePercent(small.scale, small.scale)).toBe(100)
  })

  it('小矢量图等比例放大到可用区域并居中，不拉伸也不裁切', () => {
    const small = fitTransform(800, 600, 200, 100, 48, true)
    expect(small.scale).toBeCloseTo(3.52)
    expect(200 * small.scale).toBeCloseTo(800 - 96)
    expect(100 * small.scale).toBeLessThanOrEqual(600 - 96)
    expect(small.x).toBeCloseTo(48)
    expect(small.y).toBeCloseTo((600 - 100 * small.scale) / 2)
    expect(relativeScalePercent(small.scale, small.scale)).toBe(100)
  })

  it.each([[100000, 200000], [200000, 100000], [1000000000, 2000000000]])(
    '超大图 %d × %d 可以缩到 MIN_VIEW_SCALE 以下，完整适配',
    (w, h) => {
      const fit = fitTransform(800, 600, w, h, 48, true)
      expect(fit.scale).toBeGreaterThan(0)
      expect(fit.scale).toBeLessThan(MIN_VIEW_SCALE)
      expect(w * fit.scale).toBeLessThanOrEqual(800 - 96)
      expect(h * fit.scale).toBeLessThanOrEqual(600 - 96)
      expect(fit.x).toBeCloseTo((800 - w * fit.scale) / 2)
      expect(fit.y).toBeCloseTo((600 - h * fit.scale) / 2)
    },
  )

  it.each([[200, 100], [100000, 200000]])(
    '50%%/200%% 相对 %d × %d 的适配基准，重适配回到居中的 100%%',
    (w, h) => {
      const fit = fitTransform(800, 600, w, h, 48, true)
      const half = zoomBy(fit, 0.5, 400, 300, fit.scale)
      const double = zoomBy(half, 4, 400, 300, fit.scale)
      expect(half.scale).toBeCloseTo(fit.scale * 0.5, 10)
      expect(double.scale).toBeCloseTo(fit.scale * 2, 10)
      expect(relativeScalePercent(half.scale, fit.scale)).toBe(50)
      expect(relativeScalePercent(double.scale, fit.scale)).toBe(200)
      const dragged = panBy(double, 80, -30)
      expect(dragged.x).not.toBe(fit.x)
      const reset = fitTransform(800, 600, w, h, 48, true)
      expect(reset).toEqual(fit)
      expect(relativeScalePercent(reset.scale, reset.scale)).toBe(100)
    },
  )

  it('巨大图在适配基准以下继续缩放不会突然跳回旧下限，光标锚点仍不动', () => {
    const fit = fitTransform(800, 600, 100000, 200000, 48, true)
    const next = zoomAtPoint(fit, 160, 220, 100, fit.scale)
    expect(next.scale).toBeLessThan(fit.scale)
    expect((160 - next.x) / next.scale).toBeCloseTo((160 - fit.x) / fit.scale)
    expect((220 - next.y) / next.scale).toBeCloseTo((220 - fit.y) / fit.scale)
    const min = zoomBy(fit, 0.01, 160, 220, fit.scale)
    expect(min.scale).toBeCloseTo(fit.scale * MIN_VIEW_SCALE, 10)
    expect(zoomBy(min, 0.5, 160, 220, fit.scale)).toBe(min)
  })

  it('按行滚动的滚轮换算成像素步进', () => {
    expect(wheelZoomDelta(1, 1)).toBe(100)
    expect(wheelZoomDelta(40, 0)).toBe(40)
  })
})
