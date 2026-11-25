import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { attachReadingColumn, columnGeometry, draggedPageWidth, sanitizePageWidth, type ReadingColumnController } from '../../src/lib/readingColumn'

let width: number
let frames: Map<number, FrameRequestCallback>
let nextId: number
let controllers: ReadingColumnController[]
let resizeCallback: ResizeObserverCallback
const frame = () => {
  for (const [id, cb] of [...frames]) { frames.delete(id); cb(16) }
}
function fixture(preference = 800, loaded = true) {
  const surface = document.createElement('div')
  const scroll = document.createElement('div')
  const column = document.createElement('div')
  const root = document.createElement('div')
  scroll.className = 'reading-scroll'
  root.innerHTML = '<p>first block</p><p>second block</p>'
  column.append(root); scroll.append(column); surface.append(scroll); document.body.append(surface)
  Object.defineProperties(root, { scrollHeight: { value: 1200 }, offsetHeight: { value: 1200 } })
  const options = { width: preference, zoom: 1, source: 'blocks', loaded, onWidth: vi.fn(), onFlush: vi.fn(), onLayout: vi.fn() }
  const controller = attachReadingColumn(surface, scroll, column, root, options)
  controllers.push(controller)
  return { surface, scroll, column, root, options, controller, handle: (side = 'right') => surface.querySelector<HTMLElement>(`[data-side="${side}"]`)! }
}
function pointer(handle: HTMLElement, type: string, x: number, id = 1, primary = true) {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, clientX: x })
  Object.defineProperties(event, { pointerId: { value: id }, isPrimary: { value: primary } })
  handle.dispatchEvent(event)
  return event
}
beforeEach(() => {
  width = 1400; frames = new Map(); nextId = 0; controllers = []
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => { frames.set(++nextId, cb); return nextId })
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id))
  vi.stubGlobal('ResizeObserver', class {
    observe() {} disconnect() {}
    constructor(cb: ResizeObserverCallback) { resizeCallback = cb }
  })
  vi.spyOn(Element.prototype, 'clientWidth', 'get').mockImplementation(function () { return this.className === 'reading-scroll' ? width : 800 })
  vi.spyOn(Element.prototype, 'clientHeight', 'get').mockReturnValue(700)
  vi.spyOn(Element.prototype, 'scrollHeight', 'get').mockReturnValue(5000)
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({ left: 100, top: 80, bottom: 780, width: 1400, height: 700 } as DOMRect)
})
afterEach(() => { controllers.forEach(c => c.dispose()); document.body.innerHTML = ''; vi.restoreAllMocks(); vi.unstubAllGlobals() })

describe('column geometry', () => {
  it.each([undefined, null, 0, 799, -1, NaN, Infinity, '1000'])('非法偏好 %s 默认 800', value => {
    expect(sanitizePageWidth(value)).toBe(800)
  })
  it.each([0.5, 1, 1.5, 2])('%s 阅读缩放不改变可见栏宽和中线', zoom => {
    expect(columnGeometry(1400, 1000, zoom)).toEqual({ available: 1304, width: 1000, layoutWidth: 1000 / zoom, left: 200 })
  })
  it('宽屏无额外上限，窄屏只夹取实际显示值', () => {
    expect(columnGeometry(4000, 5000).width).toBe(3904)
    expect(columnGeometry(700, 1800).width).toBe(604)
    expect(columnGeometry(10, 800).width).toBe(1)
  })
  it('左右手柄向外 40px 均增加总宽 80px，不能低于 800 或超过可用区', () => {
    expect(draggedPageWidth(800, 40, 'right', 1304)).toBe(880)
    expect(draggedPageWidth(800, -40, 'left', 1304)).toBe(880)
    expect(draggedPageWidth(800, 40, 'left', 1304)).toBe(800)
    expect(draggedPageWidth(1000, 9999, 'right', 1304)).toBe(1304)
  })
})

describe('reading viewport interactions', () => {
  it.each(['left', 'right'])('%s 拖动合帧更新，并围绕滚动区中线定位', side => {
    const f = fixture(); const handle = f.handle(side)
    const capture = vi.fn(); Object.defineProperty(handle, 'setPointerCapture', { value: capture })
    const before = parseFloat(handle.style.left)
    pointer(handle, 'pointerdown', 500)
    pointer(handle, 'pointermove', side === 'right' ? 520 : 480)
    pointer(handle, 'pointermove', side === 'right' ? 540 : 460)
    expect(f.options.onWidth).not.toHaveBeenCalled()
    frame()
    expect(f.options.onWidth).toHaveBeenCalledExactlyOnceWith(880)
    expect(f.column.style.width).toBe('880px')
    expect(parseFloat(handle.style.left) - before).toBe(side === 'right' ? 40 : -40)
    expect(capture).toHaveBeenCalledWith(1)
    pointer(handle, 'pointerup', side === 'right' ? 540 : 460)
    expect(document.body.style.userSelect).toBe('')
    expect(handle.classList.contains('is-dragging')).toBe(false)
    expect(f.options.onFlush).toHaveBeenCalledOnce()
  })
  it.each(['pointercancel', 'lostpointercapture', 'blur', 'dispose'])('%s 清理拖动状态且迟到帧不再改宽度', type => {
    const f = fixture(); const h = f.handle()
    pointer(h, 'pointerdown', 500); pointer(h, 'pointermove', 540)
    if (type === 'blur') window.dispatchEvent(new Event('blur'))
    else if (type === 'dispose') f.controller.dispose()
    else pointer(h, type, 540)
    const count = f.options.onWidth.mock.calls.length
    frame()
    expect(f.options.onWidth).toHaveBeenCalledTimes(count)
    expect(document.body.style.cursor).toBe('')
    expect(document.body.style.userSelect).toBe('')
  })
  it('非主指针、窄屏和设置加载前不可拖动', () => {
    const f = fixture(800, false)
    expect(f.handle().hidden).toBe(true)
    pointer(f.handle(), 'pointerdown', 500); pointer(f.handle(), 'pointermove', 540); frame()
    expect(f.options.onWidth).not.toHaveBeenCalled()
    f.controller.update({ ...f.options, loaded: true })
    pointer(f.handle(), 'pointerdown', 500, 2, false); pointer(f.handle(), 'pointermove', 540, 2); frame()
    expect(f.options.onWidth).not.toHaveBeenCalled()
    width = 850; window.dispatchEvent(new Event('resize')); frame()
    expect(f.handle().hidden).toBe(true)
  })
  it('窗口变窄不覆盖已保存偏好，放宽恢复；没有实际移动不反写夹取值', () => {
    const f = fixture(1800)
    pointer(f.handle(), 'pointerdown', 500); pointer(f.handle(), 'pointerup', 500)
    expect(f.options.onWidth).not.toHaveBeenCalled()
    width = 700; window.dispatchEvent(new Event('resize')); frame()
    expect(f.column.style.width).toBe('604px')
    width = 2200; window.dispatchEvent(new Event('resize')); frame()
    expect(f.column.style.width).toBe('1800px')
  })
  it('键盘左右是手柄屏幕方向，Shift 放大步进；双击只恢复页宽', () => {
    const f = fixture(1000)
    f.handle().dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
    expect(f.options.onWidth).toHaveBeenLastCalledWith(1020)
    f.handle('left').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', shiftKey: true, bubbles: true }))
    expect(f.options.onWidth).toHaveBeenLastCalledWith(1120)
    f.handle().dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))
    expect(f.options.onWidth).toHaveBeenLastCalledWith(800)
    expect(f.options.zoom).toBe(1)
    expect(f.options.onFlush).toHaveBeenCalled()
  })
  it('缩放、文档变化结束拖动，更新占位高度，旧 observer 清理后无效', () => {
    const f = fixture()
    pointer(f.handle(), 'pointerdown', 500)
    f.controller.update({ ...f.options, zoom: 0.5 })
    expect(document.body.style.cursor).toBe('')
    expect(f.root.style.width).toBe('1600px')
    expect(f.column.style.width).toBe('800px')
    expect(f.column.style.height).toBe('600px')
    f.controller.dispose()
    resizeCallback([], {} as ResizeObserver); frame()
    expect(f.surface.querySelector('.reading-column-handle')).toBeNull()
    expect(f.root.style.transform).toBe('')
  })
})
