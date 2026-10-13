import { describe, expect, it } from 'vitest'
import {
  decorateViewableMedia,
  fitTransform,
  mediaPayloadFromEventTarget,
  prepareSvgMarkup,
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

  it('缩放到边界后不再变化', () => {
    const maxed = zoomBy({ scale: MAX_VIEW_SCALE, x: 0, y: 0 }, 2, 10, 10)
    const mined = zoomBy({ scale: MIN_VIEW_SCALE, x: 0, y: 0 }, 0.5, 10, 10)
    expect(maxed.scale).toBe(MAX_VIEW_SCALE)
    expect(mined.scale).toBe(MIN_VIEW_SCALE)
  })

  it('大图缩小适应窗口，小图保持原始尺寸并居中', () => {
    const large = fitTransform(800, 600, 1600, 1200)
    expect(large.scale).toBeLessThan(1)
    expect(large.x).toBeCloseTo((800 - 1600 * large.scale) / 2)
    const small = fitTransform(800, 600, 200, 100)
    expect(small.scale).toBe(1)
    expect(small.x).toBeCloseTo(300)
    expect(small.y).toBeCloseTo(250)
  })

  it('按行滚动的滚轮换算成像素步进', () => {
    expect(wheelZoomDelta(1, 1)).toBe(100)
    expect(wheelZoomDelta(40, 0)).toBe(40)
  })
})
