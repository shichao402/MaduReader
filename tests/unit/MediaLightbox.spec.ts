import { act, createElement, StrictMode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import MediaLightbox from '../../src/components/MediaLightbox'
import { fitTransform, MIN_VIEW_SCALE, type MediaPayload, type ViewTransform } from '../../src/lib/mediaView'

const SMALL_SVG: MediaPayload = {
  kind: 'svg',
  svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 100"><rect width="200" height="100"/></svg>',
  label: '小流程图',
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
  return document.querySelector('button[title*="相对适应窗口"]')!
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

function wheel(deltaY: number, x = 400, y = 300) {
  const event = new WheelEvent('wheel', {
    deltaY,
    clientX: x + 20,
    clientY: y + 60,
    bubbles: true,
    cancelable: true,
  })
  act(() => viewport().dispatchEvent(event))
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
  act(() => fitButton().click())
}

beforeEach(() => {
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
  it('小 SVG 首次可见时已放大到可用区域，百分比是适配的 100%', () => {
    render()
    expect(stage().style.visibility).toBe('visible')
    expectTransform({ scale: 3.52, x: 48, y: 124 })
    expect(fitButton().textContent).toBe('100%')
    expect(fitButton().title).toContain('相对适应窗口')
    expect(fitButton().title).toContain('重新适配并居中')
    expect(observers[0].observe).toHaveBeenCalledWith(viewport())
  })

  it('巨大 SVG 首次显示完整，不受旧绝对最小缩放限制', () => {
    render(HUGE_SVG)
    const fit = readTransform()
    expect(fit.scale).toBeLessThan(MIN_VIEW_SCALE)
    expect(100000 * fit.scale).toBeLessThanOrEqual(704)
    expect(200000 * fit.scale).toBeLessThanOrEqual(504)
    expectTransform(fitTransform(800, 600, 100000, 200000, 48, true))
    expect(fitButton().textContent).toBe('100%')
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
    expect(fitButton().textContent).toBe('100%')
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

  it('普通小位图不自动放大，但 100%/200% 和重新适配的口径一致', () => {
    render({ kind: 'image', src: 'photo.png', label: '照片' })
    const img = loadImage(200, 100)
    expectTransform({ scale: 1, x: 300, y: 250 })
    expect(img.style.width).toBe('200px')
    expect(img.style.height).toBe('100px')
    expect(fitButton().textContent).toBe('100%')
    wheel(-Math.log(2) / 0.0015)
    expect(readTransform().scale).toBeCloseTo(2)
    expect(fitButton().textContent).toBe('200%')
    reset()
    expectTransform({ scale: 1, x: 300, y: 250 })
    expect(fitButton().textContent).toBe('100%')
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
    expect(fitButton().textContent).toBe('100%')
  })
})

describe('MediaLightbox user transforms and resize', () => {
  it.each([SMALL_SVG, HUGE_SVG])('$label 的 50%/200% 相对适配基准，点击百分比重新适配并居中', (payload) => {
    render(payload)
    const fit = readTransform()
    wheel(Math.log(2) / 0.0015)
    expect(readTransform().scale).toBeCloseTo(fit.scale * 0.5, 10)
    expect(fitButton().textContent).toBe('50%')
    wheel(-Math.log(4) / 0.0015)
    expect(readTransform().scale).toBeCloseTo(fit.scale * 2, 10)
    expect(fitButton().textContent).toBe('200%')
    drag()
    expect(readTransform().x).not.toBe(fit.x)
    reset()
    expectTransform(fit)
    expect(fitButton().textContent).toBe('100%')
  })

  it.each(['window', 'observer'] as const)('自动模式下 %s resize 重新完整适配并保持 100%', (source) => {
    render()
    resize(1200, 900, source)
    expectTransform(fitTransform(1200, 900, 200, 100, 48, true))
    expect(fitButton().textContent).toBe('100%')
    resize(400, 300, source)
    expectTransform(fitTransform(400, 300, 200, 100, 48, true))
    expect(fitButton().textContent).toBe('100%')
  })

  it.each(['window', 'observer'] as const)('用户滚轮缩放后 %s resize 不抢复位或更改基准', (source) => {
    render(HUGE_SVG)
    wheel(Math.log(2) / 0.0015)
    const manual = readTransform()
    resize(1200, 900, source)
    expectTransform(manual)
    expect(fitButton().textContent).toBe('50%')
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
    expect(fitButton().textContent).toBe('100%')
  })

  it('缩放按钮也退出自动模式，reset 使用新窗口并重新进入自动模式', () => {
    render()
    act(() => document.querySelector<HTMLButtonElement>('button[title="放大"]')!.click())
    const manual = readTransform()
    expect(fitButton().textContent).toBe('120%')
    resize(1200, 900, 'observer')
    expectTransform(manual)
    reset()
    expectTransform(fitTransform(1200, 900, 200, 100, 48, true))
    expect(fitButton().textContent).toBe('100%')
    resize(700, 500, 'observer')
    expectTransform(fitTransform(700, 500, 200, 100, 48, true))
    expect(fitButton().textContent).toBe('100%')
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
