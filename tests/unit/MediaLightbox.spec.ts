import { act, createElement, StrictMode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import MediaLightbox from '../../src/components/MediaLightbox'
import { settingsStore } from '../../src/stores/settings'
import { fitTransform, relativeScalePercent, MIN_VIEW_SCALE, type MediaPayload, type ViewTransform } from '../../src/lib/mediaView'

const SMALL_SVG: MediaPayload = {
  kind: 'svg',
  svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 100"><rect width="200" height="100"/></svg>',
  label: '小流程图',
  diagramMetrics: { width: 200, height: 100, labelFontPx: 2 },
}
const HUGE_SVG: MediaPayload = {
  kind: 'svg',
  svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100000 200000"/>',
  label: '巨大图形',
}

let viewportW: number
let viewportH: number
let container: HTMLDivElement
let root: Root
let observers: TestResizeObserver[]

class TestResizeObserver {
  observe = vi.fn()
  disconnect = vi.fn()

  constructor(private callback: ResizeObserverCallback) {
    observers.push(this)
  }

  notify() {
    this.callback([], this as unknown as ResizeObserver)
  }
}

function viewport(): HTMLDivElement {
  return document.querySelector('.media-lightbox-viewport')!
}

function stage(): HTMLDivElement {
  return document.querySelector('.media-lightbox-stage')!
}

function fitButton(): HTMLButtonElement {
  return document.querySelector('button[title*="相对原始尺寸"]')!
}

function readTransform(): ViewTransform {
  const match = stage().style.transform.match(/^translate\(([-\d.e+]+)px, ([-\d.e+]+)px\) scale\(([-\d.e+]+)\)$/)
  expect(match).not.toBeNull()
  return { x: Number(match![1]), y: Number(match![2]), scale: Number(match![3]) }
}

function expectTransform(expected: ViewTransform) {
  const actual = readTransform()
  expect(actual.scale).toBeCloseTo(expected.scale, 10)
  expect(actual.x).toBeCloseTo(expected.x, 8)
  expect(actual.y).toBeCloseTo(expected.y, 8)
}

function render(payload = SMALL_SVG, onClose = vi.fn(), strict = false) {
  const element = createElement(MediaLightbox, { payload, onClose })
  act(() => root.render(strict ? createElement(StrictMode, null, element) : element))
  Object.defineProperty(viewport(), 'setPointerCapture', { value: vi.fn(), configurable: true })
  return onClose
}

function loadImage(w: number, h: number) {
  const img = document.querySelector<HTMLImageElement>('.media-lightbox-plate')!
  Object.defineProperties(img, {
    naturalWidth: { value: w, configurable: true },
    naturalHeight: { value: h, configurable: true },
  })
  act(() => img.dispatchEvent(new Event('load')))
  return img
}

function wheel(deltaY: number, x = 400, y = 300, options: WheelEventInit = {}, target: Element = viewport()) {
  const event = new WheelEvent('wheel', {
    deltaY,
    clientX: x + 20,
    clientY: y + 60,
    bubbles: true,
    cancelable: true,
    ...options,
  })
  act(() => target.dispatchEvent(event))
  return event
}

function pointer(type: string, x: number, y: number) {
  const event = new MouseEvent(type, {
    bubbles: true,
    button: 0,
    buttons: type === 'pointerup' ? 0 : 1,
    clientX: x,
    clientY: y,
  })
  Object.defineProperty(event, 'pointerId', { value: 1 })
  act(() => viewport().dispatchEvent(event))
}

function drag() {
  pointer('pointerdown', 100, 120)
  pointer('pointermove', 180, 90)
  pointer('pointerup', 180, 90)
}

function resize(w: number, h: number, source: 'window' | 'observer' = 'window') {
  viewportW = w
  viewportH = h
  act(() => {
    if (source === 'window') window.dispatchEvent(new Event('resize'))
    else observers.forEach((observer) => observer.notify())
  })
}

function reset() {
  act(() => document.querySelector<HTMLButtonElement>('button[title="适应窗口"]')!.click())
}

beforeEach(() => {
  settingsStore.reset()
  viewportW = 800
  viewportH = 600
  observers = []
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('ResizeObserver', TestResizeObserver)
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(function (this: HTMLElement) {
    return this.classList.contains('media-lightbox-viewport') ? viewportW : 0
  })
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockImplementation(function (this: HTMLElement) {
    return this.classList.contains('media-lightbox-viewport') ? viewportH : 0
  })
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(() => ({
    x: 20, y: 60, left: 20, top: 60, right: 20 + viewportW, bottom: 60 + viewportH,
    width: viewportW, height: viewportH, toJSON: () => ({}),
  }))
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  expect(document.querySelector('.media-lightbox')).toBeNull()
})

describe('MediaLightbox fit and loading', () => {
  it('已知小字号 SVG 首次可见时已完整放大，显示原始尺寸的 352%', () => {
    render()
    expect(stage().style.visibility).toBe('visible')
    expectTransform({ scale: 3.52, x: 48, y: 124 })
    expect(fitButton().textContent).toBe(`${relativeScalePercent(readTransform().scale)}%`)
    expect(fitButton().title).toContain('相对原始尺寸')
    expect(fitButton().title).toContain('恢复 100% 并居中')
    expect(observers[0].observe).toHaveBeenCalledWith(viewport())
  })

  it('Mermaid 多行 HTML 标签全屏使用真实尺寸适配，SVG 输出尺寸与 transform 一致', () => {
    render({
      kind: 'svg', label: '棋子状态机',
      svg: '<svg xmlns="http://www.w3.org/2000/svg" width="100%" viewBox="4 4 1095 628" style="max-width:1095px"><foreignObject width="200" height="80"><div xmlns="http://www.w3.org/1999/xhtml"><p>ChessController<br>StateMachine<br>ChessState</p></div></foreignObject></svg>',
    })
    expectTransform(fitTransform(800, 600, 1095, 628, 48, true))
    const svg = stage().querySelector('svg')!
    expect(svg.getAttribute('width')).toBe('1095')
    expect(svg.getAttribute('height')).toBe('628')
    expect(svg.querySelectorAll('br')).toHaveLength(2)
    expect(fitButton().textContent).toBe(`${relativeScalePercent(readTransform().scale)}%`)
  })

  it('巨大 SVG 首次显示完整，不受旧绝对最小缩放限制', () => {
    render(HUGE_SVG)
    const fit = readTransform()
    expect(fit.scale).toBeLessThan(MIN_VIEW_SCALE)
    expect(100000 * fit.scale).toBeLessThanOrEqual(704)
    expect(200000 * fit.scale).toBeLessThanOrEqual(504)
    expectTransform(fitTransform(800, 600, 100000, 200000, 48, true))
    expect(fitButton().textContent).toBe(`${relativeScalePercent(readTransform().scale)}%`)
  })

  it('异步 PlantUML 加载前不适配、不缩放，加载后使用当时的窗口和真实尺寸', () => {
    render({ kind: 'image', src: 'https://example.com/plantuml/svg/encoded', allowUpscale: true, label: 'PlantUML' })
    expect(stage().style.visibility).toBe('hidden')
    expect(fitButton().disabled).toBe(true)
    expect(fitButton().textContent).toBe('加载中')
    wheel(-100)
    drag()
    resize(1000, 800)
    expectTransform({ scale: 1, x: 0, y: 0 })
    loadImage(200, 100)
    expect(stage().style.visibility).toBe('visible')
    expectTransform(fitTransform(1000, 800, 200, 100, 48, true))
    expect(fitButton().disabled).toBe(false)
    expect(fitButton().textContent).toBe(`${relativeScalePercent(readTransform().scale)}%`)
  })

  it('未获取有效图形尺寸时保持隐藏，后续有效 load 才显示', () => {
    render({ kind: 'image', src: 'diagram.svg', label: 'SVG' })
    loadImage(0, 0)
    expect(stage().style.visibility).toBe('hidden')
    loadImage(200, 100)
    expectTransform(fitTransform(800, 600, 200, 100, 48, true))
    expect(stage().style.visibility).toBe('visible')
  })

  it('初始预览区域没有尺寸时等待 ResizeObserver，不先显示错误适配', () => {
    viewportW = 0
    viewportH = 0
    render()
    expect(stage().style.visibility).toBe('hidden')
    expect(fitButton().disabled).toBe(true)
    resize(800, 600, 'observer')
    expectTransform(fitTransform(800, 600, 200, 100, 48, true))
    expect(stage().style.visibility).toBe('visible')
  })

  it('普通小位图完整放大，百分比以原始尺寸为基准', () => {
    render({ kind: 'image', src: 'photo.png', label: '照片' })
    const img = loadImage(200, 100)
    expectTransform({ scale: 3.52, x: 48, y: 124 })
    expect(img.style.width).toBe('200px')
    expect(img.style.height).toBe('100px')
    expect(fitButton().textContent).toBe(`${relativeScalePercent(readTransform().scale)}%`)
    wheel(-Math.log(2) / 0.0015)
    expect(readTransform().scale).toBeCloseTo(7.04)
    expect(fitButton().textContent).toBe(`${relativeScalePercent(readTransform().scale)}%`)
    reset()
    expectTransform({ scale: 3.52, x: 48, y: 124 })
    expect(fitButton().textContent).toBe(`${relativeScalePercent(readTransform().scale)}%`)
  })

  it('换图清除上一张图的尺寸和失败状态，不在异步加载前套用旧适配', () => {
    render()
    wheel(-100)
    const previousObserver = observers[0]
    render({ kind: 'image', src: 'first.png', label: '第一张' })
    expect(previousObserver.disconnect).toHaveBeenCalled()
    expect(stage().style.visibility).toBe('hidden')
    expectTransform({ scale: 1, x: 0, y: 0 })
    act(() => document.querySelector('img')!.dispatchEvent(new Event('error')))
    expect(document.querySelector('.media-lightbox-status')?.textContent).toBe('图片加载失败')
    render({ kind: 'image', src: 'next.svg', label: '第二张' })
    expect(stage().style.visibility).toBe('hidden')
    expect(document.querySelector('.media-lightbox-status')).toBeNull()
    loadImage(200, 100)
    expectTransform(fitTransform(800, 600, 200, 100, 48, true))
    expect(fitButton().textContent).toBe(`${relativeScalePercent(readTransform().scale)}%`)
  })
})

describe('MediaLightbox blank double-click dismissal', () => {
  function doubleClick(target: Element, x = 30, y = 70) {
    act(() => target.dispatchEvent(new MouseEvent('dblclick', {
      bubbles: true, cancelable: true, button: 0, clientX: x, clientY: y,
    })))
  }

  function enable() {
    act(() => settingsStore.update({ closePreviewOnBlankDoubleClick: true }, { save: false }))
  }

  function boundPlate() {
    const plate = document.querySelector<HTMLElement>('.media-lightbox-plate')!
    vi.spyOn(plate, 'getBoundingClientRect').mockReturnValue({
      x: 100, y: 150, left: 100, top: 150, right: 700, bottom: 450,
      width: 600, height: 300, toJSON: () => ({}),
    })
    return plate
  }

  it('默认不关闭，启用后只双击空白关闭，单击不关闭', () => {
    const onClose = render()
    boundPlate()
    doubleClick(viewport())
    expect(onClose).not.toHaveBeenCalled()
    enable()
    expect(document.querySelector('.media-lightbox-hint')?.textContent).toContain('双击空白关闭')
    act(() => viewport().click())
    expect(onClose).not.toHaveBeenCalled()
    doubleClick(viewport())
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it.each(['svg', 'image'] as const)('双击 %s 内容和工具栏不关闭，包括捕获指针后重定向到 viewport 的事件', (kind) => {
    enable()
    const onClose = render(kind === 'svg' ? SMALL_SVG : { kind: 'image', src: 'photo.png', label: '照片' })
    if (kind === 'image') loadImage(200, 100)
    const plate = boundPlate()
    doubleClick(plate, 200, 200)
    if (kind === 'svg') doubleClick(plate.querySelector('rect')!, 200, 200)
    doubleClick(viewport(), 200, 200)
    doubleClick(document.querySelector('.media-lightbox-toolbar')!)
    doubleClick(fitButton())
    expect(onClose).not.toHaveBeenCalled()
    doubleClick(viewport())
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('关闭选项立即生效，拖动和滚轮缩放不变', () => {
    enable()
    const onClose = render()
    boundPlate()
    drag()
    const manual = readTransform()
    wheel(-100)
    expect(readTransform().scale).toBeGreaterThan(manual.scale)
    expect(onClose).not.toHaveBeenCalled()
    act(() => settingsStore.update({ closePreviewOnBlankDoubleClick: false }, { save: false }))
    expect(document.querySelector('.media-lightbox-hint')?.textContent).not.toContain('双击空白关闭')
    doubleClick(viewport())
    expect(onClose).not.toHaveBeenCalled()
  })

  it('开启后加载前和加载失败时也可以双击空白退出', () => {
    enable()
    const onClose = render({ kind: 'image', src: 'missing.png', label: '未加载图片' })
    doubleClick(viewport())
    expect(onClose).toHaveBeenCalledTimes(1)
    act(() => document.querySelector('img')!.dispatchEvent(new Event('error')))
    doubleClick(viewport())
    expect(onClose).toHaveBeenCalledTimes(2)
  })
})

describe('MediaLightbox modifier wheel pan', () => {
  function enable() {
    act(() => settingsStore.update({ previewModifierWheelPan: true }, { save: false }))
  }

  it.each([{ ctrlKey: true }, { shiftKey: true }])('默认关闭时 $ctrlKey / $shiftKey 滚轮仍缩放', (keys) => {
    render()
    const before = readTransform()
    expect(wheel(100, 400, 300, keys).defaultPrevented).toBe(true)
    expect(readTransform().scale).toBeLessThan(before.scale)
  })

  it.each([SMALL_SVG, HUGE_SVG])('$label 的 Ctrl / Shift 滚轮只平移，不改变比例或基准', (payload) => {
    enable()
    render(payload)
    const before = readTransform()
    expect(wheel(100, 400, 300, { ctrlKey: true }).defaultPrevented).toBe(true)
    expectTransform({ ...before, y: before.y - 100 })
    wheel(-40, 400, 300, { ctrlKey: true })
    expectTransform({ ...before, y: before.y - 60 })
    wheel(80, 400, 300, { shiftKey: true })
    expectTransform({ ...before, x: before.x - 80, y: before.y - 60 })
    wheel(-30, 400, 300, { shiftKey: true })
    expectTransform({ ...before, x: before.x - 50, y: before.y - 60 })
    expect(fitButton().textContent).toBe(`${relativeScalePercent(readTransform().scale)}%`)
  })

  it('兼容 Shift 被浏览器转换成纯 deltaX，不重复叠加两个轴', () => {
    enable()
    render()
    const before = readTransform()
    wheel(0, 400, 300, { shiftKey: true, deltaX: 75 })
    expectTransform({ ...before, x: before.x - 75 })
    wheel(75, 400, 300, { shiftKey: true, deltaX: 75 })
    expectTransform({ ...before, x: before.x - 150 })
  })

  it.each([
    { keys: { ctrlKey: true }, mode: 1, distance: 32, axis: 'y' as const },
    { keys: { shiftKey: true }, mode: 1, distance: 32, axis: 'x' as const },
    { keys: { ctrlKey: true }, mode: 2, distance: 1200, axis: 'y' as const },
    { keys: { shiftKey: true }, mode: 2, distance: 1600, axis: 'x' as const },
  ])('按 $mode 模式平移 $axis 轴，正确换算行和可用视口页尺寸', ({ keys, mode, distance, axis }) => {
    enable()
    render()
    const before = readTransform()
    wheel(2, 400, 300, { ...keys, deltaMode: mode })
    expectTransform({ ...before, [axis]: before[axis] - distance })
  })

  it('Ctrl 与 Shift 同时按下时优先上下滚动', () => {
    enable()
    render()
    const before = readTransform()
    wheel(60, 400, 300, { ctrlKey: true, shiftKey: true, deltaX: 60 })
    expectTransform({ ...before, y: before.y - 60 })
  })

  it('开关实时生效，关闭时保留当前视图并恢复原有缩放', () => {
    render()
    enable()
    expect(document.querySelector('.media-lightbox-hint')?.textContent).toContain('Ctrl+滚轮上下')
    wheel(60, 400, 300, { ctrlKey: true })
    const panned = readTransform()
    act(() => settingsStore.update({ previewModifierWheelPan: false }, { save: false }))
    expectTransform(panned)
    expect(document.querySelector('.media-lightbox-hint')?.textContent).not.toContain('Ctrl+滚轮上下')
    wheel(60, 400, 300, { ctrlKey: true })
    expect(readTransform().scale).toBeLessThan(panned.scale)
  })

  it('开启后普通滚轮仍缩放，平移步进不随缩放比例变化', () => {
    enable()
    render()
    wheel(-100)
    const zoomed = readTransform()
    expect(fitButton().textContent).not.toBe('100%')
    wheel(50, 400, 300, { shiftKey: true })
    expectTransform({ ...zoomed, x: zoomed.x - 50 })
  })

  it('修饰键平移后 resize 不抢复位，点击比例按钮重新居中', () => {
    enable()
    render()
    wheel(50, 400, 300, { ctrlKey: true })
    const panned = readTransform()
    resize(1000, 700, 'observer')
    expectTransform(panned)
    reset()
    expectTransform(fitTransform(1000, 700, 200, 100, 48, true))
  })

  it('零增量和工具栏上的滚轮不会移动图片或退出自动适配', () => {
    enable()
    render()
    const before = readTransform()
    wheel(0, 400, 300, { ctrlKey: true })
    wheel(0, 400, 300, { shiftKey: true })
    wheel(100, 400, 300, { ctrlKey: true }, fitButton())
    expectTransform(before)
    resize(1000, 700, 'observer')
    expectTransform(fitTransform(1000, 700, 200, 100, 48, true))
  })

  it('图片加载前不平移，加载后普通位图也支持两个方向', () => {
    enable()
    render({ kind: 'image', src: 'photo.png', label: '照片' })
    wheel(50, 400, 300, { ctrlKey: true })
    wheel(50, 400, 300, { shiftKey: true })
    expectTransform({ scale: 1, x: 0, y: 0 })
    loadImage(200, 100)
    wheel(50, 400, 300, { ctrlKey: true })
    wheel(50, 400, 300, { shiftKey: true })
    expectTransform({ scale: 3.52, x: -2, y: 74 })
  })
})

describe('MediaLightbox user transforms and resize', () => {
  it.each([SMALL_SVG, HUGE_SVG])('$label 按手动倍率缩放后通过独立适应按钮重新适配', (payload) => {
    render(payload)
    const fit = readTransform()
    wheel(Math.log(2) / 0.0015)
    expect(readTransform().scale).toBeCloseTo(fit.scale * 0.5, 10)
    expect(fitButton().textContent).toBe(`${relativeScalePercent(readTransform().scale)}%`)
    wheel(-Math.log(4) / 0.0015)
    expect(readTransform().scale).toBeCloseTo(fit.scale * 2, 10)
    expect(fitButton().textContent).toBe(`${relativeScalePercent(readTransform().scale)}%`)
    drag()
    expect(readTransform().x).not.toBe(fit.x)
    reset()
    expectTransform(fit)
    expect(fitButton().textContent).toBe(`${relativeScalePercent(readTransform().scale)}%`)
  })

  it.each(['window', 'observer'] as const)('自动模式下 %s resize 重新完整适配并更新真实百分比', (source) => {
    render()
    resize(1200, 900, source)
    expectTransform(fitTransform(1200, 900, 200, 100, 48, true))
    expect(fitButton().textContent).toBe(`${relativeScalePercent(readTransform().scale)}%`)
    resize(400, 300, source)
    expectTransform(fitTransform(400, 300, 200, 100, 48, true))
    expect(fitButton().textContent).toBe(`${relativeScalePercent(readTransform().scale)}%`)
  })

  it.each(['window', 'observer'] as const)('用户滚轮缩放后 %s resize 不抢复位或更改基准', (source) => {
    render(HUGE_SVG)
    wheel(Math.log(2) / 0.0015)
    const manual = readTransform()
    resize(1200, 900, source)
    expectTransform(manual)
    expect(fitButton().textContent).toBe(`${relativeScalePercent(readTransform().scale)}%`)
  })

  it.each(['window', 'observer'] as const)('用户拖拽后 %s resize 不抢复位', (source) => {
    render()
    const fit = readTransform()
    drag()
    const manual = readTransform()
    expect(manual.x).toBeCloseTo(fit.x + 80)
    expect(manual.y).toBeCloseTo(fit.y - 30)
    resize(1200, 900, source)
    expectTransform(manual)
    expect(fitButton().textContent).toBe(`${relativeScalePercent(readTransform().scale)}%`)
  })

  it('缩放按钮也退出自动模式，reset 使用新窗口并重新进入自动模式', () => {
    render()
    act(() => document.querySelector<HTMLButtonElement>('button[title="放大"]')!.click())
    const manual = readTransform()
    expect(fitButton().textContent).toBe('422%')
    resize(1200, 900, 'observer')
    expectTransform(manual)
    reset()
    expectTransform(fitTransform(1200, 900, 200, 100, 48, true))
    expect(fitButton().textContent).toBe(`${relativeScalePercent(readTransform().scale)}%`)
    resize(700, 500, 'observer')
    expectTransform(fitTransform(700, 500, 200, 100, 48, true))
    expect(fitButton().textContent).toBe(`${relativeScalePercent(readTransform().scale)}%`)
  })

  it('只点击预览而没有移动不退出自动模式', () => {
    render()
    pointer('pointerdown', 100, 120)
    pointer('pointermove', 100, 120)
    pointer('pointerup', 100, 120)
    wheel(0)
    resize(1200, 900, 'observer')
    expectTransform(fitTransform(1200, 900, 200, 100, 48, true))
  })

  it('鼠标锚点包含 viewport 页面偏移，滚轮拦截与光标下内容点保持不变', () => {
    render(HUGE_SVG)
    const before = readTransform()
    expect(wheel(-100, 160, 220).defaultPrevented).toBe(true)
    const after = readTransform()
    expect((160 - after.x) / after.scale).toBeCloseTo((160 - before.x) / before.scale)
    expect((220 - after.y) / after.scale).toBeCloseTo((220 - before.y) / before.scale)
  })

  it('同一来源的 props 更新不清除用户视图', () => {
    render()
    drag()
    const manual = readTransform()
    render({ ...SMALL_SVG, label: '更新标题' })
    expectTransform(manual)
    resize(1200, 900)
    expectTransform(manual)
  })

  it('没有 ResizeObserver 时仍通过窗口 resize 自动适配', () => {
    vi.stubGlobal('ResizeObserver', undefined)
    render()
    resize(1200, 900)
    expectTransform(fitTransform(1200, 900, 200, 100, 48, true))
  })

  it('StrictMode 保留正确适配、关闭按钮焦点与 Esc 关闭', () => {
    const onClose = render(SMALL_SVG, vi.fn(), true)
    expectTransform(fitTransform(800, 600, 200, 100, 48, true))
    expect(document.activeElement?.getAttribute('title')).toBe('关闭 (Esc)')
    act(() => document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })))
    expect(onClose).toHaveBeenCalledTimes(1)
    act(() => document.querySelector<HTMLButtonElement>('button[title="关闭 (Esc)"]')!.click())
    expect(onClose).toHaveBeenCalledTimes(2)
  })
})


describe('original baseline and automatic label protection', () => {
  it('known labels cap automatic enlargement at 125%, but manual original 100% and zoom are unrestricted', () => {
    render({ ...SMALL_SVG, diagramMetrics: { width: 200, height: 100, labelFontPx: 16 } })
    expectTransform({ scale: 1.25, x: 275, y: 237.5 })
    expect(fitButton().textContent).toBe('125%')
    act(() => fitButton().click())
    expectTransform({ scale: 1, x: 300, y: 250 })
    expect(fitButton().textContent).toBe('100%')
    resize(1000, 800)
    expectTransform({ scale: 1, x: 300, y: 250 })
    wheel(-Math.log(4) / 0.0015)
    expect(readTransform().scale).toBe(4)
    expect(fitButton().textContent).toBe('400%')
    reset()
    expectTransform({ scale: 1.25, x: 375, y: 337.5 })
  })
  it('unknown diagram label font conservatively fits without enlargement, while a regular SVG image enlarges', () => {
    render({ ...SMALL_SVG, diagramMetrics: undefined })
    expectTransform({ scale: 1, x: 300, y: 250 })
    render({ kind: 'image', source: 'image', src: 'ordinary.svg', label: '普通 SVG' })
    loadImage(200, 100)
    expectTransform({ scale: 3.52, x: 48, y: 124 })
    expect(fitButton().textContent).toBe('352%')
  })
  it('giant diagram below 1% never displays 0%, and original 100% remains reachable', () => {
    render(HUGE_SVG)
    expect(fitButton().textContent).toBe('0.252%')
    act(() => fitButton().click())
    expectTransform({ scale: 1, x: -49600, y: -99700 })
    expect(fitButton().textContent).toBe('100%')
    reset()
    expect(fitButton().textContent).toBe('0.252%')
  })
  it('font and delayed metrics updates only refit automatic state, never reset the user transform', () => {
    render({ ...SMALL_SVG, diagramMetrics: { width: 200, height: 100, labelFontPx: 16 } })
    act(() => settingsStore.update({ fontSize: 20 }, { save: false }))
    expect(readTransform().scale).toBe(1.5625)
    drag(); const manual = readTransform()
    render({ ...SMALL_SVG, diagramMetrics: { width: 200, height: 100, labelFontPx: 24 } })
    expectTransform(manual)
    reset()
    expect(readTransform().scale).toBeCloseTo(25 / 24)
  })
})


describe('explicit PlantUML asynchronous metadata', () => {
  const markup = '<svg width="400" height="200" viewBox="0 0 400 200"><text font-size="16">label</text></svg>'
  it.each([false, true])('late metadata uses renderer original size and respects user mode %s', async userMode => {
    let resolve!: (response: { ok: boolean; text: () => Promise<string> }) => void
    const fetcher = vi.fn().mockImplementation(() => new Promise<{ ok: boolean; text: () => Promise<string> }>(done => { resolve = done }))
    vi.stubGlobal('fetch', fetcher)
    render({ kind: 'image', source: 'plantuml', src: `https://example.test/lightbox-late-${userMode}.svg`, label: 'PlantUML' })
    expect(fitButton().disabled).toBe(true)
    loadImage(200, 100)
    expectTransform({ scale: 1, x: 300, y: 250 })
    if (userMode) drag()
    const before = readTransform()
    await act(async () => { resolve({ ok: true, text: async () => markup }) })
    expect(fetcher).toHaveBeenCalledOnce()
    expect(fetcher.mock.calls[0][1]).toMatchObject({ credentials: 'omit' })
    expect(document.querySelector<HTMLImageElement>('.media-lightbox-plate')!.style.width).toBe('400px')
    if (userMode) expectTransform(before)
    else expectTransform({ scale: 1.25, x: 150, y: 175 })
    reset()
    expectTransform({ scale: 1.25, x: 150, y: 175 })
  })
  it('CORS failure only caps a rendered image; an ordinary SVG image never requests metadata', async () => {
    const fetcher = vi.fn().mockRejectedValue(new Error('cors'))
    vi.stubGlobal('fetch', fetcher)
    render({ kind: 'image', source: 'plantuml', src: 'https://example.test/lightbox-cors.svg', label: 'PlantUML' })
    loadImage(200, 100)
    await act(async () => {})
    expectTransform({ scale: 1, x: 300, y: 250 })
    expect(document.querySelector('.media-lightbox-status')).toBeNull()
    render({ kind: 'image', source: 'image', src: 'ordinary-no-metrics.svg', label: 'ordinary' })
    loadImage(200, 100)
    expectTransform({ scale: 3.52, x: 48, y: 124 })
    expect(fetcher).toHaveBeenCalledOnce()
  })
  it('a disposed PlantUML preview cannot apply late metadata to the next image', async () => {
    let resolve!: (response: { ok: boolean; text: () => Promise<string> }) => void
    vi.stubGlobal('fetch', vi.fn(() => new Promise<{ ok: boolean; text: () => Promise<string> }>(done => { resolve = done })))
    render({ kind: 'image', source: 'plantuml', src: 'https://example.test/lightbox-disposed.svg', label: 'PlantUML' })
    loadImage(200, 100)
    render({ kind: 'image', source: 'image', src: 'next-after-plantuml.png', label: 'next' })
    loadImage(200, 100)
    await act(async () => { resolve({ ok: true, text: async () => markup }) })
    expectTransform({ scale: 3.52, x: 48, y: 124 })
    expect(document.querySelector<HTMLImageElement>('.media-lightbox-plate')!.style.width).toBe('200px')
  })
})
