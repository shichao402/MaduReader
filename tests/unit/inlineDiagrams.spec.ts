import { readFileSync } from 'node:fs'
import { act, createElement, StrictMode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { attachInlineDiagrams, inlineDiagramLayout, type InlineDiagramsController } from '../../src/lib/inlineDiagrams'
import { decorateViewableMedia, mediaPayloadFromEventTarget, prepareSvgMarkup, type MediaPayload } from '../../src/lib/mediaView'
import ContentArea from '../../src/components/ContentArea'

const app = vi.hoisted(() => ({
  html: '', payload: null as MediaPayload | null, close: null as (() => void) | null,
  tabStore: { activeContent: 'diagram', activeTab: { path: '' }, activeTabId: 'diagram' },
  settingsStore: { currentZoom: 100, isDark: false, settings: { fontSize: 16, plantUmlServer: '' } },
  attachLinks: vi.fn(), detachLinks: vi.fn(),
}))
vi.mock('../../src/hooks/useStores', () => ({
  useStores: () => app,
  getTabStore: () => app.tabStore,
  getSettingsStore: () => app.settingsStore,
}))
vi.mock('../../src/composables/useMarkdown', () => ({ renderMarkdownAsync: async () => app.html, initCodeCopy: () => {} }))
vi.mock('../../src/composables/useMermaid', () => ({ renderMermaidCode: async (html: string) => html }))
vi.mock('../../src/composables/usePlantUml', () => ({ renderPlantUmlCode: (html: string) => html }))
vi.mock('../../src/composables/useLinkHandler', () => ({
  attachLinkHandler: app.attachLinks, detachLinkHandler: app.detachLinks,
}))
vi.mock('../../src/components/ExportDialog', () => ({ default: () => null }))
vi.mock('../../src/components/MediaLightbox', () => ({
  default: ({ payload, onClose }: { payload: MediaPayload; onClose: () => void }) => {
    app.payload = payload; app.close = onClose; return null
  },
}))

let width: number
let viewportHeight: number
let displayScale: number
let frameTop: number
let observers: TestResizeObserver[]
let cleanups: (() => void)[]
let reactRoot: Root | null
let scrollTo: ReturnType<typeof vi.fn>
let originalScrollTo: PropertyDescriptor | undefined
let frameCallbacks: Map<number, FrameRequestCallback>
let nextFrameId: number
let requestFrame: ReturnType<typeof vi.fn>
let cancelFrame: ReturnType<typeof vi.fn>

class TestResizeObserver {
  observe = vi.fn()
  disconnect = vi.fn()
  constructor(private callback: ResizeObserverCallback) { observers.push(this) }
  notify(targets: Element[] = []) {
    this.callback(targets.map((target) => ({ target } as ResizeObserverEntry)), this as unknown as ResizeObserver)
  }
}

function flushAnimationFrame() {
  // Snapshot this frame: callbacks queued by it must wait until the next frame.
  for (const [id, callback] of Array.from(frameCallbacks)) {
    if (frameCallbacks.delete(id)) callback(16)
  }
}

function svg(w = 200, h = 100, extras = '') {
  return `<svg class="mermaid-svg" viewBox="0 0 ${w} ${h}" ${extras}><rect width="${w}" height="${h}"/></svg>`
}
function rect(top: number, w: number, h: number): DOMRect {
  return { top, bottom: top + h, left: 0, right: w, width: w, height: h, x: 0, y: top, toJSON: () => ({}) }
}
function fixture(html = svg()) {
  const scroll = document.createElement('div')
  scroll.className = 'diagram-scroll'
  const root = document.createElement('div')
  root.className = 'markdown-content'
  root.innerHTML = decorateViewableMedia(html)
  scroll.appendChild(root)
  document.body.appendChild(scroll)
  return { root, scroll }
}
function enhance(root: HTMLElement, scroll: HTMLElement) {
  const controller = attachInlineDiagrams(root, scroll)
  cleanups.push(controller.dispose)
  return controller
}
function mounted(html = svg()) {
  const f = fixture(html)
  return { ...f, controller: enhance(f.root, f.scroll) }
}
function parts(root: HTMLElement, index = 0) {
  const frame = root.querySelectorAll<HTMLElement>('.inline-diagram')[index]
  return {
    frame,
    clip: frame.querySelector<HTMLDivElement>('.inline-diagram-viewport')!,
    toggle: frame.querySelector<HTMLButtonElement>('.inline-diagram-toggle')!,
    media: frame.querySelector<SVGSVGElement | HTMLImageElement>('.inline-diagram-viewport svg, .inline-diagram-viewport img')!,
    fullscreen: frame.querySelector<HTMLButtonElement>('.media-expand')!,
  }
}
function imageState(img: HTMLImageElement, w: number, h: number, complete = true) {
  Object.defineProperties(img, {
    naturalWidth: { value: w, configurable: true }, naturalHeight: { value: h, configurable: true },
    complete: { value: complete, configurable: true },
  })
}
function click(controller: InlineDiagramsController, root: HTMLElement, target: Element) {
  const handler = (event: Event) => controller.handleToggle(event)
  root.addEventListener('click', handler, true)
  const event = new MouseEvent('click', { bubbles: true, cancelable: true })
  target.dispatchEvent(event)
  root.removeEventListener('click', handler, true)
  return event
}
function resize(w = width, h = viewportHeight, viaWindow = false) {
  width = w
  viewportHeight = h
  if (viaWindow) window.dispatchEvent(new Event('resize'))
  else observers.filter((o) => !o.disconnect.mock.calls.length).forEach((o) => o.notify())
  flushAnimationFrame()
}

beforeEach(() => {
  width = 800; viewportHeight = 700; displayScale = 1; frameTop = 140
  observers = []; cleanups = []; reactRoot = null; scrollTo = vi.fn()
  frameCallbacks = new Map(); nextFrameId = 0
  requestFrame = vi.fn((callback: FrameRequestCallback) => {
    const id = nextFrameId++
    frameCallbacks.set(id, callback)
    return id
  })
  cancelFrame = vi.fn((id: number) => { frameCallbacks.delete(id) })
  app.html = svg(100, 300); app.payload = null
  app.tabStore.activeContent = 'diagram'; app.settingsStore.isDark = false; app.settingsStore.currentZoom = 100
  app.attachLinks.mockClear(); app.detachLinks.mockClear()
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('ResizeObserver', TestResizeObserver)
  vi.stubGlobal('requestAnimationFrame', requestFrame)
  vi.stubGlobal('cancelAnimationFrame', cancelFrame)
  originalScrollTo = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollTo')
  Object.defineProperty(HTMLElement.prototype, 'scrollTo', { value: scrollTo, configurable: true })
  vi.spyOn(Element.prototype, 'clientWidth', 'get').mockImplementation(function (this: Element) {
    return this.matches('.markdown-content, .inline-diagram-viewport, .media-frame') ? width : 0
  })
  vi.spyOn(Element.prototype, 'clientHeight', 'get').mockImplementation(function (this: Element) {
    return this.matches('.diagram-scroll, .overflow-auto') ? viewportHeight : 0
  })
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    if (this.matches('.diagram-scroll, .overflow-auto')) return rect(100, width, viewportHeight)
    if (this.matches('.inline-diagram-viewport')) return rect(frameTop + 30 * displayScale, width * displayScale, 0)
    return rect(frameTop, width * displayScale, 0)
  })
})
afterEach(() => {
  if (reactRoot) act(() => reactRoot!.unmount())
  cleanups.forEach((dispose) => dispose())
  document.body.innerHTML = ''
  vi.restoreAllMocks(); vi.unstubAllGlobals()
  if (originalScrollTo) Object.defineProperty(HTMLElement.prototype, 'scrollTo', originalScrollTo)
  else delete (HTMLElement.prototype as { scrollTo?: unknown }).scrollTo
})

describe('inlineDiagramLayout', () => {
  it('小矢量和大图都铺满正文宽度，保持原始比例而不是按高度缩小', () => {
    for (const size of [{ width: 20, height: 10 }, { width: 20000, height: 10000 }]) {
      expect(inlineDiagramLayout(size, 800, 700)).toEqual({ width: 800, height: 400, limit: 490, overflows: false })
    }
    expect(inlineDiagramLayout({ width: 100, height: 2000 }, 800, 700)?.height).toBe(16000)
  })
  it('只限制展示容器高度：70% 视口并封顶 600px；考虑现有阅读缩放', () => {
    expect(inlineDiagramLayout({ width: 100, height: 300 }, 800, 700)).toMatchObject({ height: 2400, limit: 490, overflows: true })
    expect(inlineDiagramLayout({ width: 100, height: 300 }, 800, 1200)?.limit).toBe(600)
    expect(inlineDiagramLayout({ width: 100, height: 300 }, 800, 700, 2)?.limit).toBe(245)
  })
  it('不把相等高度和亚像素舍入误差当溢出', () => {
    expect(inlineDiagramLayout({ width: 100, height: 100 }, 490, 700)?.overflows).toBe(false)
    expect(inlineDiagramLayout({ width: 100, height: 100 }, 490.5, 700)?.overflows).toBe(false)
    expect(inlineDiagramLayout({ width: 100, height: 100 }, 492, 700)?.overflows).toBe(true)
  })
  it.each([0, -1, NaN, Infinity])('无效尺寸 %s 不计算折叠', (invalid) => {
    expect(inlineDiagramLayout({ width: invalid, height: 100 }, 800, 700)).toBeNull()
    expect(inlineDiagramLayout({ width: 100, height: invalid }, 800, 700)).toBeNull()
    expect(inlineDiagramLayout({ width: 100, height: 100 }, invalid, 700)).toBeNull()
    expect(inlineDiagramLayout({ width: 100, height: 100 }, 800, invalid)).toBeNull()
    expect(inlineDiagramLayout({ width: 100, height: 100 }, 800, 700, invalid)).toBeNull()
  })
})

describe('ResizeObserver frame scheduling', () => {
  function diagram(kind: string) {
    const f = fixture(kind === 'plantuml'
      ? '<figure class="plantuml-diagram"><img src="/svg/encoded"></figure>' : svg(100, 100))
    const img = f.root.querySelector('img')
    if (img) imageState(img, 100, 100)
    return { ...f, controller: enhance(f.root, f.scroll) }
  }
  function watchDom(root: Element) {
    const observer = new MutationObserver(() => {})
    observer.observe(root, { attributes: true, childList: true, characterData: true, subtree: true })
    cleanups.push(() => observer.disconnect())
    return observer
  }

  it.each(['mermaid', 'plantuml'])('%s 观察递送不读写布局，下一帧重测最新容器、缩放和媒体尺寸', (kind) => {
    const f = diagram(kind)
    const p = parts(f.root)
    expect(p.clip.style.maxHeight).toBe('490px')
    expect(requestFrame).not.toHaveBeenCalled()
    const mutation = watchDom(f.scroll)
    const measure = vi.spyOn(p.clip, 'getBoundingClientRect').mockClear()
    const measureWidth = vi.spyOn(p.clip, 'clientWidth', 'get').mockClear()
    const measureHeight = vi.spyOn(f.scroll, 'clientHeight', 'get').mockClear()
    width = 300; viewportHeight = 500
    observers[0].notify([f.root, p.media, f.scroll])
    expect(measure).not.toHaveBeenCalled()
    expect(measureWidth).not.toHaveBeenCalled()
    expect(measureHeight).not.toHaveBeenCalled()
    expect(mutation.takeRecords()).toEqual([])
    expect(p.clip.style.maxHeight).toBe('490px')
    expect(requestFrame).toHaveBeenCalledTimes(1)
    expect(frameCallbacks.size).toBe(1)

    // Change again without another notification: measurements must happen at frame execution.
    width = 200; viewportHeight = 1000; displayScale = 2
    if (p.media instanceof HTMLImageElement) imageState(p.media, 200, 400)
    else p.media.setAttribute('viewBox', '0 0 200 400')
    mutation.takeRecords()
    flushAnimationFrame()
    expect(measure).toHaveBeenCalledTimes(1)
    expect(measureWidth).toHaveBeenCalledTimes(1)
    expect(measureHeight).toHaveBeenCalledTimes(1)
    expect(p.media.style.aspectRatio).toBe('200 / 400')
    expect(p.clip.style.maxHeight).toBe('300px')
    expect(p.toggle.hidden).toBe(false)
    expect(mutation.takeRecords().length).toBeGreaterThan(0)
    expect(frameCallbacks.size).toBe(0)

    width = 100
    observers[0].notify([f.root])
    expect(p.clip.style.maxHeight).toBe('300px')
    flushAnimationFrame()
    expect(p.clip.style.maxHeight).toBe('')
    expect(p.toggle.hidden).toBe(true)
    expect(measure).toHaveBeenCalledTimes(2)
    expect(requestFrame).toHaveBeenCalledTimes(2)
    expect(frameCallbacks.size).toBe(0)
    expect(scrollTo).not.toHaveBeenCalled()
  })

  it('root/media/scroll 多次通知只排一个帧，包含合法的帧 ID 0', () => {
    const f = mounted(svg(100, 300))
    const p = parts(f.root)
    const measure = vi.spyOn(p.clip, 'getBoundingClientRect').mockClear()
    viewportHeight = 300
    for (const target of [f.root, p.media, f.scroll, p.media, f.root]) observers[0].notify([target])
    expect(requestFrame).toHaveBeenCalledTimes(1)
    expect(Array.from(frameCallbacks.keys())).toEqual([0])
    expect(measure).not.toHaveBeenCalled()
    expect(p.clip.style.maxHeight).toBe('490px')
    flushAnimationFrame()
    expect(measure).toHaveBeenCalledTimes(1)
    expect(p.clip.style.maxHeight).toBe('210px')
    expect(frameCallbacks.size).toBe(0)
  })

  it.each(['mermaid', 'plantuml'])('%s 布局反馈允许后续帧，尺寸稳定后无重复 DOM 写入且不自排帧', (kind) => {
    const f = diagram(kind)
    const p = parts(f.root)
    const mutation = watchDom(f.scroll)
    const measure = vi.spyOn(p.clip, 'getBoundingClientRect').mockClear()
    const text = p.toggle.firstChild
    viewportHeight = 300
    observers[0].notify()
    flushAnimationFrame()
    expect(p.clip.style.maxHeight).toBe('210px')
    expect(mutation.takeRecords().some((record) => record.target === p.clip && record.attributeName === 'style')).toBe(true)
    expect(frameCallbacks.size).toBe(0)
    observers[0].notify([f.root, p.media])
    observers[0].notify([f.scroll])
    expect(mutation.takeRecords()).toEqual([])
    flushAnimationFrame()
    expect(measure).toHaveBeenCalledTimes(2)
    expect(mutation.takeRecords()).toEqual([])
    expect(p.toggle.firstChild).toBe(text)
    expect(requestFrame).toHaveBeenCalledTimes(2)
    expect(frameCallbacks.size).toBe(0)
    expect(scrollTo).not.toHaveBeenCalled()
  })

  it('公开 refresh 保持同步，并取消已有观察帧；之后仍可再次排帧', () => {
    const f = mounted(svg(100, 300))
    const p = parts(f.root)
    const measure = vi.spyOn(p.clip, 'getBoundingClientRect').mockClear()
    observers[0].notify()
    displayScale = 2
    f.controller.refresh()
    expect(p.clip.style.maxHeight).toBe('245px')
    expect(measure).toHaveBeenCalledTimes(1)
    expect(cancelFrame).toHaveBeenCalledExactlyOnceWith(0)
    expect(frameCallbacks.size).toBe(0)
    flushAnimationFrame()
    expect(measure).toHaveBeenCalledTimes(1)
    viewportHeight = 300
    observers[0].notify()
    flushAnimationFrame()
    expect(p.clip.style.maxHeight).toBe('105px')
    expect(measure).toHaveBeenCalledTimes(2)
    expect(requestFrame).toHaveBeenCalledTimes(2)
  })

  it('dispose 取消排队帧，迟到回调/事件/refresh 不读写 DOM，重绑也不受旧帧影响', () => {
    const f = fixture('<figure class="plantuml-diagram"><img src="/svg/encoded" style="width:100px"></figure>')
    const img = f.root.querySelector('img')!
    imageState(img, 100, 300)
    const original = f.root.innerHTML
    const controller = enhance(f.root, f.scroll)
    const measure = vi.spyOn(parts(f.root).clip, 'getBoundingClientRect').mockClear()
    const old = observers[0]
    old.notify()
    expect(frameCallbacks.size).toBe(1)
    const lateFrame = frameCallbacks.get(0)!
    controller.dispose(); controller.dispose()
    expect(cancelFrame).toHaveBeenCalledExactlyOnceWith(0)
    expect(old.disconnect).toHaveBeenCalledTimes(1)
    expect(frameCallbacks.size).toBe(0)
    expect(f.root.innerHTML).toBe(original)
    const mutation = watchDom(f.scroll)
    img.dispatchEvent(new Event('load')); img.dispatchEvent(new Event('error'))
    window.dispatchEvent(new Event('resize'))
    old.notify(); controller.refresh(); lateFrame(16); flushAnimationFrame()
    expect(measure).not.toHaveBeenCalled()
    expect(mutation.takeRecords()).toEqual([])
    expect(f.root.innerHTML).toBe(original)
    expect(requestFrame).toHaveBeenCalledTimes(1)
    enhance(f.root, f.scroll)
    const rebound = f.root.innerHTML
    mutation.takeRecords()
    old.notify(); lateFrame(32); controller.refresh()
    expect(mutation.takeRecords()).toEqual([])
    expect(f.root.innerHTML).toBe(rebound)
    expect(requestFrame).toHaveBeenCalledTimes(1)
    expect(frameCallbacks.size).toBe(0)
  })
})

describe('sizing, loading and payloads', () => {
  it('只增强标记的正文图表，照片、图标、公式及全屏按钮图标不被改尺寸', () => {
    const f = fixture(`${svg()}<figure class="plantuml-diagram"><img src="diagram.svg"></figure>
      <img src="photo.png" width="100"><img src="icon.svg" width="16"><svg class="katex-svg" viewBox="0 0 10 10"/>`)
    const ordinary = Array.from(f.root.querySelectorAll('[data-media-kind="image"], .katex-svg')).map((n) => n.outerHTML)
    enhance(f.root, f.scroll)
    expect(f.root.querySelectorAll('.inline-diagram')).toHaveLength(2)
    expect(Array.from(f.root.querySelectorAll('[data-media-kind="image"], .katex-svg')).map((n) => n.outerHTML)).toEqual(ordinary)
    expect(parts(f.root).fullscreen.querySelector('svg')!.getAttribute('width')).toBe('14')
    expect(parts(f.root).fullscreen.querySelector('svg')!.getAttribute('style')).toBeNull()
    expect(parts(f.root).media.style.width).toBe('100%')
    expect(parts(f.root).toggle.hidden).toBe(true)
  })
  it('消除 Mermaid inline max-width !important，保留 viewBox/原始尺寸和完整全屏载荷', () => {
    const f = fixture(svg(200, 100, 'width="200" height="100" style="max-width:200px!important;height:100px;" preserveAspectRatio="none"'))
    const original = f.root.querySelector('.mermaid-svg')!.outerHTML
    const controller = enhance(f.root, f.scroll)
    const p = parts(f.root)
    expect(p.media.style.maxWidth).toBe('none')
    expect(p.media.style.getPropertyPriority('max-width')).toBe('important')
    expect(p.media.style.height).toBe('auto')
    expect(p.media.style.aspectRatio).toBe('200 / 100')
    expect(p.media.getAttribute('viewBox')).toBe('0 0 200 100')
    expect(p.media.getAttribute('width')).toBe('200')
    expect(p.media.getAttribute('preserveAspectRatio')).toBe('xMidYMin meet')
    expect(controller.payloadFromTarget(p.fullscreen)?.svg).toBe(original)
    expect(prepareSvgMarkup(controller.payloadFromTarget(p.fullscreen)!.svg!)).toMatchObject({ width: 200, height: 100 })
  })
  it.each(['width="100" height="300"', 'width="100px" height="300px"', 'style="width:100px;height:300px;max-width:100px"'])(
    '无 viewBox 但有绝对尺寸 %s 的 SVG 也能等比例放大，载荷仍按原始尺寸推断', (attributes) => {
      const f = mounted(`<svg class="mermaid-svg" ${attributes}><rect/></svg>`)
      const p = parts(f.root)
      expect(p.media.getAttribute('viewBox')).toBe('0 0 100 300')
      expect(p.toggle.hidden).toBe(false)
      expect(f.controller.payloadFromTarget(p.media)?.svg).not.toContain('viewBox=')
      expect(prepareSvgMarkup(f.controller.payloadFromTarget(p.media)!.svg!)).toMatchObject({ width: 100, height: 300 })
    },
  )
  it.each(['', 'width="100%" height="100%"', 'viewBox="0 0 0 0"', 'viewBox="0 0 Infinity 100"'])(
    'SVG 缺少可靠尺寸 %s 不折叠或猜测默认比例', (attributes) => {
      const f = mounted(`<svg class="mermaid-svg" ${attributes}><rect/></svg>`)
      expect(parts(f.root).toggle.hidden).toBe(true)
      expect(parts(f.root).clip.style.maxHeight).toBe('')
      expect(parts(f.root).media.getAttribute('style')).toBeNull()
      expect(parts(f.root).frame.classList.contains('is-collapsed')).toBe(false)
    },
  )
  it('lazy 图等待 load 后用 natural 尺寸测量，error 清除折叠，重新加载可以恢复', () => {
    const f = fixture('<figure class="plantuml-diagram"><img src="/svg/encoded" loading="lazy" width="100" height="300"></figure>')
    const img = f.root.querySelector('img')!
    imageState(img, 100, 300, false)
    const original = img.getAttribute('style')
    const controller = enhance(f.root, f.scroll)
    expect(parts(f.root).toggle.hidden).toBe(true)
    imageState(img, 100, 300)
    img.dispatchEvent(new Event('load'))
    expect(parts(f.root).clip.style.maxHeight).toBe('490px')
    expect(img.style.width).toBe('100%')
    expect(controller.payloadFromTarget(parts(f.root).fullscreen)).toMatchObject({ src: '/svg/encoded', allowUpscale: true })
    img.dispatchEvent(new Event('error'))
    expect(parts(f.root).toggle.hidden).toBe(true)
    expect(parts(f.root).clip.style.maxHeight).toBe('')
    expect(img.getAttribute('style')).toBe(original)
    resize()
    expect(parts(f.root).toggle.hidden).toBe(true)
    img.dispatchEvent(new Event('load'))
    expect(parts(f.root).toggle.hidden).toBe(false)
    expect(scrollTo).not.toHaveBeenCalled()
  })
  it('缓存已加载图片首次即可测量；零 natural 尺寸不会折叠', () => {
    const f = fixture('<figure class="plantuml-diagram"><img src="diagram.svg"></figure>')
    const img = f.root.querySelector('img')!
    imageState(img, 100, 300)
    enhance(f.root, f.scroll)
    expect(parts(f.root).toggle.hidden).toBe(false)
    imageState(img, 0, 0)
    img.dispatchEvent(new Event('load'))
    expect(parts(f.root).toggle.hidden).toBe(true)
  })
  it('隐藏/零宽和零高视口不折叠，恢复可见后才出现按钮', () => {
    width = 0
    const f = mounted(svg(100, 300))
    expect(parts(f.root).toggle.hidden).toBe(true)
    resize(800, 0)
    expect(parts(f.root).toggle.hidden).toBe(true)
    resize(800, 700)
    expect(parts(f.root).toggle.hidden).toBe(false)
  })
})

describe('collapse, resize and events', () => {
  it('展开/收起只移除/恢复裁切高度，宽度、比例、载荷及全屏入口不变', () => {
    const f = mounted(svg(100, 300))
    const p = parts(f.root)
    const style = p.media.getAttribute('style')
    const payload = f.controller.payloadFromTarget(p.fullscreen)
    expect(p.frame.classList.contains('is-collapsed')).toBe(true)
    expect(p.clip.style.maxHeight).toBe('490px')
    expect(p.toggle.getAttribute('aria-controls')).toBe(p.clip.id)
    click(f.controller, f.root, p.toggle)
    expect(p.toggle.textContent).toBe('收起图表')
    expect(p.toggle.getAttribute('aria-expanded')).toBe('true')
    expect(p.clip.style.maxHeight).toBe('')
    expect(p.frame.classList.contains('is-expanded')).toBe(true)
    click(f.controller, f.root, p.toggle)
    expect(p.toggle.textContent).toBe('展开完整图表')
    expect(p.toggle.getAttribute('aria-expanded')).toBe('false')
    expect(p.clip.style.maxHeight).toBe('490px')
    expect(p.media.getAttribute('style')).toBe(style)
    expect(f.controller.payloadFromTarget(p.fullscreen)).toEqual(payload)
    expect(scrollTo).not.toHaveBeenCalled()
  })
  it('观察正文宽度和实际滚动视口；只有确实溢出才显示按钮', () => {
    const f = mounted(svg(100, 100))
    expect(observers).toHaveLength(1)
    expect(observers[0].observe).toHaveBeenCalledWith(f.root)
    expect(observers[0].observe).toHaveBeenCalledWith(f.scroll)
    expect(observers[0].observe).toHaveBeenCalledWith(parts(f.root).media)
    resize(400, 700)
    expect(parts(f.root).toggle.hidden).toBe(true)
    expect(parts(f.root).clip.style.maxHeight).toBe('')
    resize(800, 1200)
    expect(parts(f.root).clip.style.maxHeight).toBe('600px')
    resize(800, 300, true)
    expect(parts(f.root).clip.style.maxHeight).toBe('210px')
    expect(scrollTo).not.toHaveBeenCalled()
  })
  it('已展开的图表 resize 不会自动折回；溢出消失后隐藏按钮，恢复时保留用户展开状态', () => {
    const f = mounted(svg(100, 100))
    click(f.controller, f.root, parts(f.root).toggle)
    resize(300, 700)
    expect(parts(f.root).toggle.hidden).toBe(true)
    resize(800, 700)
    expect(parts(f.root).toggle.hidden).toBe(false)
    expect(parts(f.root).toggle.textContent).toBe('收起图表')
    expect(parts(f.root).clip.style.maxHeight).toBe('')
    expect(scrollTo).not.toHaveBeenCalled()
  })
  it('现有正文 transform 缩放下，屏幕上的折叠高度仍为 70% 视口', () => {
    displayScale = 2
    const f = mounted(svg(100, 300))
    expect(parts(f.root).clip.style.maxHeight).toBe('245px')
    displayScale = 0.5
    f.controller.refresh()
    expect(parts(f.root).clip.style.maxHeight).toBe('980px')
  })
  it('捕获阶段识别按钮内文本节点的父元素，阻止链接和误进全屏；普通目标不拦截', () => {
    const f = mounted(svg(100, 300))
    const p = parts(f.root)
    p.toggle.innerHTML = '<span>展开完整图表</span>'
    const opened = vi.fn()
    const bubbled = vi.fn()
    const onCapture = (event: Event) => {
      if (f.controller.handleToggle(event)) return
      opened(f.controller.payloadFromTarget(event.target) ?? mediaPayloadFromEventTarget(event.target))
    }
    f.root.addEventListener('click', onCapture, true)
    f.root.addEventListener('click', bubbled)
    const event = new MouseEvent('click', { bubbles: true, cancelable: true })
    p.toggle.firstElementChild!.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(true)
    expect(opened).not.toHaveBeenCalled()
    expect(bubbled).not.toHaveBeenCalled()
    p.fullscreen.querySelector('svg')!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(opened).toHaveBeenCalledWith(expect.objectContaining({ kind: 'svg', svg: expect.stringContaining('0 0 100 300') }))
    expect(f.controller.handleToggle(new Event('click'))).toBe(false)
    expect(f.controller.payloadFromTarget(document.body)).toBeNull()
    expect(f.controller.payloadFromTarget(document.createTextNode('text'))).toBeNull()
  })
  it('收起时只有阅读位置已超出顶部裁切部分才定位图表顶部，加载/展开/resize 不滚动', () => {
    const f = mounted(svg(100, 300))
    const p = parts(f.root)
    f.scroll.scrollTop = 2000
    frameTop = -1200
    click(f.controller, f.root, p.toggle)
    resize()
    expect(scrollTo).not.toHaveBeenCalled()
    click(f.controller, f.root, p.toggle)
    expect(scrollTo).toHaveBeenCalledExactlyOnceWith({ top: 700, behavior: 'auto' })
  })
  it('图表顶部在屏幕上方但裁切部分仍可见时收起不打断阅读', () => {
    const f = mounted(svg(100, 300))
    frameTop = 0
    click(f.controller, f.root, parts(f.root).toggle)
    click(f.controller, f.root, parts(f.root).toggle)
    expect(scrollTo).not.toHaveBeenCalled()
  })
  it('多个图表独立展开，关联 ID 不重复，链接中的 PlantUML 原始地址不变', () => {
    const f = fixture(`${svg(100, 300)}<figure class="plantuml-diagram"><a href="original"><img src="diagram.svg"></a></figure>`)
    imageState(f.root.querySelector('img')!, 100, 300)
    const controller = enhance(f.root, f.scroll)
    const first = parts(f.root), second = parts(f.root, 1)
    expect(first.clip.id).not.toBe(second.clip.id)
    expect(second.clip.querySelector('a > img')).toBeTruthy()
    click(controller, f.root, second.toggle)
    expect(first.clip.style.maxHeight).toBe('490px')
    expect(second.clip.style.maxHeight).toBe('')
    expect(controller.payloadFromTarget(second.fullscreen)?.src).toBe('diagram.svg')
  })
})

describe('lifecycle and themed styles', () => {
  it('重复绑定复用控制器、包装、observer 和 load/error/resize 监听；清理幂等且还原原始 DOM', () => {
    const f = fixture(`${svg(200, 100, 'style="max-width:200px"')}<figure class="plantuml-diagram"><img src="diagram.svg"></figure>`)
    const img = f.root.querySelector('img')!
    imageState(img, 100, 300)
    const original = f.root.innerHTML
    const add = vi.spyOn(img, 'addEventListener'), remove = vi.spyOn(img, 'removeEventListener')
    const winAdd = vi.spyOn(window, 'addEventListener'), winRemove = vi.spyOn(window, 'removeEventListener')
    const controller = enhance(f.root, f.scroll)
    expect(attachInlineDiagrams(f.root, f.scroll)).toBe(controller)
    expect(f.root.querySelectorAll('.inline-diagram-viewport')).toHaveLength(2)
    expect(f.root.querySelectorAll('.inline-diagram-toggle')).toHaveLength(2)
    expect(observers).toHaveLength(1)
    expect(add.mock.calls.filter(([name]) => name === 'load' || name === 'error')).toHaveLength(2)
    expect(winAdd.mock.calls.filter(([name]) => name === 'resize')).toHaveLength(1)
    controller.dispose(); controller.dispose()
    expect(observers[0].disconnect).toHaveBeenCalledTimes(1)
    expect(remove.mock.calls.filter(([name]) => name === 'load' || name === 'error')).toHaveLength(2)
    expect(winRemove.mock.calls.filter(([name]) => name === 'resize')).toHaveLength(1)
    expect(f.root.innerHTML).toBe(original)
    img.dispatchEvent(new Event('load')); observers[0].notify(); controller.refresh()
    expect(f.root.innerHTML).toBe(original)
    expect(controller.payloadFromTarget(img)).toBeNull()
    enhance(f.root, f.scroll)
    expect(observers).toHaveLength(2)
    expect(f.root.querySelectorAll('.inline-diagram-viewport')).toHaveLength(2)
  })
  it('没有正文图表不创建 observer/resize 监听；缺少 ResizeObserver 时 window resize 仍可用', () => {
    const winAdd = vi.spyOn(window, 'addEventListener')
    mounted('<img src="photo.png"><span class="media-frame" data-media-kind="mermaid"><button><svg/></button></span>')
    expect(observers).toHaveLength(0)
    expect(winAdd.mock.calls.filter(([name]) => name === 'resize')).toHaveLength(0)
    vi.stubGlobal('ResizeObserver', undefined)
    const f = mounted(svg(100, 100))
    resize(300, 700, true)
    expect(parts(f.root).toggle.hidden).toBe(true)
    resize(800, 700, true)
    expect(parts(f.root).toggle.hidden).toBe(false)
  })
  it('渐隐和按钮使用主题变量，裁切只作用于容器且不遮挡点击，普通图片没有强制 width', () => {
    const css = readFileSync(`${process.cwd()}/src/styles/tokens.css`, 'utf8')
    expect(css).toMatch(/\.inline-diagram\.is-collapsed \.inline-diagram-viewport\s*\{\s*overflow: hidden;/)
    expect(css).toMatch(/linear-gradient\(to bottom, transparent, var\(--color-content\)\)/)
    expect(css).toMatch(/\.inline-diagram-viewport::after\s*\{[^}]*pointer-events: none;/)
    expect(css).toMatch(/\.inline-diagram-toggle\[hidden\]\s*\{\s*display: none;/)
    expect(css).toMatch(/\.media-frame\.inline-diagram\s*\{\s*width: 100%;/)
    expect(css).not.toMatch(/\.markdown-content \.media-frame\s*\{[^}]*\n\s*width: 100%;/)
  })
})

describe('ContentArea integration', () => {
  async function render(strict = false) {
    if (!reactRoot) {
      const host = document.createElement('div')
      document.body.appendChild(host)
      reactRoot = createRoot(host)
    }
    const element = createElement(ContentArea, { onOpenSettings: () => {} })
    await act(async () => { reactRoot!.render(strict ? createElement(StrictMode, null, element) : element) })
    return document.querySelector<HTMLElement>('.markdown-content')!
  }
  it('实际捕获入口：展开点击不进全屏，折叠/展开下全屏均读取未修改的完整 SVG', async () => {
    const root = await render()
    const p = parts(root)
    expect(p.clip.style.maxHeight).toBe('490px')
    act(() => p.toggle.click())
    expect(app.payload).toBeNull()
    expect(p.toggle.textContent).toBe('收起图表')
    act(() => p.toggle.click())
    act(() => p.fullscreen.click())
    expect(app.payload?.svg).toContain('viewBox="0 0 100 300"')
    expect(app.payload?.svg).not.toContain('max-width: none')
    act(() => app.close!())
    app.payload = null
    act(() => p.toggle.click())
    expect(app.payload).toBeNull()
    act(() => p.media.dispatchEvent(new MouseEvent('click', { bubbles: true })))
    expect(app.payload?.svg).toContain('viewBox="0 0 100 300"')
  })
  it('内容/主题/StrictMode 变化和卸载都清理旧 observer/监听，重绑不重复包装', async () => {
    let root = await render(true)
    const old = observers.at(-1)!
    const oldFrame = parts(root).frame
    act(() => parts(root).toggle.click())
    app.settingsStore.isDark = true
    root = await render(true)
    expect(old.disconnect).toHaveBeenCalledTimes(1)
    expect(root.querySelectorAll('.inline-diagram-viewport')).toHaveLength(1)
    expect(root.querySelectorAll('.inline-diagram-toggle')).toHaveLength(1)
    expect(parts(root).toggle.textContent).toBe('收起图表')
    expect(parts(root).clip.style.maxHeight).toBe('')
    expect(scrollTo).not.toHaveBeenCalled()
    app.tabStore.activeContent = 'new diagram'; app.html = svg(200, 100)
    root = await render(true)
    expect(oldFrame.querySelector('.inline-diagram-viewport')).toBeNull()
    expect(parts(root).toggle.hidden).toBe(true)
    expect(observers.filter((o) => !o.disconnect.mock.calls.length)).toHaveLength(1)
    act(() => reactRoot!.unmount()); reactRoot = null
    expect(observers.every((o) => o.disconnect.mock.calls.length === 1)).toBe(true)
    expect(app.detachLinks).toHaveBeenCalledWith(root)
  })
  it('正文阅读缩放显式重测而不重建 observer 或丢失展开状态', async () => {
    const root = await render()
    act(() => parts(root).toggle.click())
    const count = observers.length
    app.settingsStore.currentZoom = 200; displayScale = 2
    await render()
    expect(root.style.transform).toBe('scale(2)')
    expect(parts(root).clip.style.maxHeight).toBe('')
    expect(parts(root).toggle.textContent).toBe('收起图表')
    expect(observers).toHaveLength(count)
  })
})
