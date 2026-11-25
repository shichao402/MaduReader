import { afterEach, describe, expect, it, vi } from 'vitest'
import { autoScaleLimit, loadPlantUmlMetrics, measureDiagramSvg, svgSize } from '../../src/lib/diagramMetrics'
import { fitTransform, prepareSvgMarkup, relativeScalePercent } from '../../src/lib/mediaView'
import { inlineDiagramLayout } from '../../src/lib/inlineDiagrams'

const diagram = (body: string, attrs = 'width="200" height="1600" viewBox="0 0 200 1600"') => `<svg xmlns="http://www.w3.org/2000/svg" ${attrs}>${body}</svg>`
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

describe('original diagram metrics', () => {
  it('绝对输出尺寸优先于 viewBox，并按坐标转换字号', () => {
    expect(measureDiagramSvg(diagram('<text font-size="16">label</text>', 'width="400" height="200" viewBox="0 0 200 100"')))
      .toEqual({ width: 400, height: 200, labelFontPx: 32 })
  })
  it.each(['width="100%" height="100%"', 'style="width:100%;max-width:200px"', ''])('百分比/缺失绝对尺寸 %s 才用 viewBox', attrs => {
    expect(measureDiagramSvg(diagram('<text font-size="16">label</text>', `${attrs} viewBox="0 0 200 100"`)))
      .toEqual({ width: 200, height: 100, labelFontPx: 16 })
  })
  it('无可靠尺寸时不猜测尺寸，无标签时只有尺寸', () => {
    expect(measureDiagramSvg('<svg><text>label</text></svg>')).toBeNull()
    expect(measureDiagramSvg(diagram('<rect/>'))).toEqual({ width: 200, height: 1600 })
  })
  it('继承字号、tspan 相对字号与内部变换均参与最大值', () => {
    expect(measureDiagramSvg(diagram('<g font-size="16" transform="scale(2)"><text>label<tspan font-size="150%">large</tspan></text></g>'))?.labelFontPx).toBe(48)
  })
  it.each([0.5, 1.25, 2])('取消页面屏幕缩放 %s，但保留原始 viewport 与标签内部变换', pageZoom => {
    const prototype = SVGElement.prototype
    const descriptor = Object.getOwnPropertyDescriptor(prototype, 'getScreenCTM')
    Object.defineProperty(prototype, 'getScreenCTM', { configurable: true, value: function (this: SVGElement) {
      const scale = pageZoom * 2 * (this.localName === 'svg' ? 1 : 3)
      return { a: scale, b: 0, c: 0, d: scale, e: 900, f: 400 }
    } })
    try {
      expect(measureDiagramSvg(diagram('<text style="font-size:16px" transform="scale(3)">label</text>',
        'width="400" height="200" viewBox="0 0 200 100"')))
        .toEqual({ width: 400, height: 200, labelFontPx: 96 })
    } finally {
      if (descriptor) Object.defineProperty(prototype, 'getScreenCTM', descriptor)
      else Reflect.deleteProperty(prototype, 'getScreenCTM')
    }
  })
  it('foreignObject HTML 多行文字参与测量', () => {
    const result = measureDiagramSvg(diagram('<foreignObject width="180" height="100"><div xmlns="http://www.w3.org/1999/xhtml" style="font-size:18px">a<br>b<span style="font-size:24px">c</span></div></foreignObject>'))
    expect(result?.labelFontPx).toBe(24)
  })
  it('只排除明确标题、隐藏文字和空文字，未知角色的大字不猜成标题', () => {
    expect(measureDiagramSvg(diagram('<g class="title"><text font-size="80">title</text></g><text class="flowchartTitleText" font-size="90">title</text><text style="display:none" font-size="100">hidden</text><text font-size="99"> </text><text font-size="16">label</text><text font-size="24">unknown</text>'))?.labelFontPx).toBe(24)
  })
  it('测量节点与脚本、外链资源不留在正文中', () => {
    const before = document.body.innerHTML
    const append = vi.spyOn(document.body, 'append')
    measureDiagramSvg(diagram('<script>window.bad=1</script><image href="https://bad.example/a"/><text onclick="bad()" font-size="16">label</text><style>@import "https://bad.example/style";text{font-size:16px}</style>'))
    expect(append).toHaveBeenCalledOnce()
    expect(document.body.innerHTML).toBe(before)
    expect((window as unknown as { bad?: number }).bad).toBeUndefined()
  })
  it('准备预览保留 renderer 根 ID 对应的 CSS 选择器和完整标签', () => {
    const prepared = prepareSvgMarkup('<svg id="mermaid-1" width="200" height="100"><style>#mermaid-1 .label{font-size:16px;fill:blue}</style><text class="label">label</text></svg>')
    const svg = new DOMParser().parseFromString(prepared.markup, 'text/html').querySelector('svg')!
    expect(svg.id).not.toBe('mermaid-1')
    expect(svg.querySelector('style')?.textContent).toContain(`#${svg.id} .label`)
  })
  it('CSS px 及物理绝对单位统一', () => {
    const svg = new DOMParser().parseFromString('<svg width="1in" height="72pt" viewBox="0 0 5 5"/>', 'text/html').querySelector('svg')!
    expect(svgSize(svg)).toEqual({ width: 96, height: 96 })
  })
})

describe('source-aware auto scaling', () => {
  const metrics = { width: 200, height: 1600, labelFontPx: 16 }
  it('计划中的长图正文 125%，仍折叠；预览 31.5% 保证完整结构', () => {
    const max = autoScaleLimit('mermaid', metrics, 16)
    expect(max).toBe(1.25)
    expect(inlineDiagramLayout(metrics, 800, 700, 1, max)).toEqual({ width: 250, height: 2000, limit: 490, overflows: true })
    expect(fitTransform(800, 600, 200, 1600, 48, true, max).scale).toBe(0.315)
    expect(relativeScalePercent(0.315)).toBe(32)
  })
  it('渲染图未知字号不能自动放大，但图片包括普通 SVG 不受此限制', () => {
    expect(autoScaleLimit('mermaid', null)).toBe(1)
    expect(autoScaleLimit('plantuml', { width: 200, height: 100 })).toBe(1)
    expect(autoScaleLimit('image', null)).toBe(Infinity)
    expect(inlineDiagramLayout({ width: 200, height: 100 }, 800, 700, 1, autoScaleLimit('image', null))?.width).toBe(800)
    expect(fitTransform(800, 600, 200, 100).scale).toBe(3.52)
  })
  it('不设最小可读字号，手动百分比与自动基准无关', () => {
    expect(relativeScalePercent(0.00000126)).toBe(0.000126)
    expect(relativeScalePercent(2, 0.315)).toBe(200)
    expect(fitTransform(800, 600, 1, 1).scale).toBe(504)
  })
  it('PlantUML URL 请求去重，拒绝读取只该图降级', async () => {
    const fetcher = vi.fn().mockResolvedValue({ ok: true, text: async () => diagram('<text font-size="16">label</text>') })
    vi.stubGlobal('fetch', fetcher)
    const url = 'https://example.test/metrics-unique.svg'
    const first = loadPlantUmlMetrics(url)
    expect(loadPlantUmlMetrics(url)).toBe(first)
    expect(await first).toEqual(metrics)
    expect(fetcher).toHaveBeenCalledOnce()
    fetcher.mockRejectedValue(new Error('cors'))
    expect(await loadPlantUmlMetrics('https://example.test/metrics-cors.svg')).toBeNull()
    expect(autoScaleLimit('image', null)).toBe(Infinity)
  })
  it('正文绝对地址与预览相对地址复用同一请求', async () => {
    const fetcher = vi.fn().mockResolvedValue({ ok: true, text: async () => diagram('<text font-size="16">label</text>') })
    vi.stubGlobal('fetch', fetcher)
    const relative = './metrics-relative-shared.svg'
    const absolute = new URL(relative, document.baseURI).href
    const first = loadPlantUmlMetrics(absolute)
    expect(loadPlantUmlMetrics(relative)).toBe(first)
    expect(await first).toEqual(metrics)
    expect(fetcher).toHaveBeenCalledOnce()
    expect(fetcher).toHaveBeenCalledWith(absolute, expect.objectContaining({ credentials: 'omit' }))
  })
})
