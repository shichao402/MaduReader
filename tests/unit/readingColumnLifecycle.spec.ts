import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { attachReadingColumn, type ReadingColumnController } from '../../src/lib/readingColumn'

let frames: Map<number, FrameRequestCallback>
let nextId: number
let viewport: number
let height: number
let anchorTop: number
let controllers: ReadingColumnController[]
let resized: ResizeObserverCallback

function frame() {
  for (const [id, callback] of [...frames]) {
    frames.delete(id)
    callback(16)
  }
}
function fixture() {
  const surface = document.createElement('div')
  const scroll = document.createElement('div')
  const column = document.createElement('div')
  const root = document.createElement('div')
  root.innerHTML = '<p>Reading anchor</p><a href="#target">Link</a>'
  column.append(root); scroll.append(column); surface.append(scroll); document.body.append(surface)
  Object.defineProperties(scroll, {
    clientWidth: { get: () => viewport }, clientHeight: { value: 700 }, scrollHeight: { value: 5000 },
  })
  Object.defineProperties(root, { scrollHeight: { get: () => height }, offsetHeight: { get: () => height } })
  vi.spyOn(surface, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0 } as DOMRect)
  vi.spyOn(scroll, 'getBoundingClientRect').mockReturnValue({ left: 200, top: 80 } as DOMRect)
  vi.spyOn(root.firstElementChild!, 'getBoundingClientRect').mockImplementation(() => ({
    top: 80 + anchorTop - scroll.scrollTop, bottom: 180 + anchorTop - scroll.scrollTop,
  } as DOMRect))
  const options = { width: 800, zoom: 1, loaded: true, source: 'anchor', onWidth: vi.fn(), onFlush: vi.fn(), onLayout: vi.fn() }
  const controller = attachReadingColumn(surface, scroll, column, root, options)
  controllers.push(controller)
  const handle = surface.querySelector<HTMLElement>('[data-side="right"]')!
  return { surface, scroll, column, root, options, controller, handle }
}
function pointer(handle: HTMLElement, type: string, x: number, id = 1) {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, clientX: x })
  Object.defineProperties(event, { pointerId: { value: id }, isPrimary: { value: true } })
  handle.dispatchEvent(event)
}
beforeEach(() => {
  frames = new Map(); nextId = 0; viewport = 1400; height = 1200; anchorTop = 0; controllers = []
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { frames.set(++nextId, callback); return nextId })
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id))
  vi.stubGlobal('ResizeObserver', class {
    constructor(callback: ResizeObserverCallback) { resized = callback }
    observe() {} disconnect() {}
  })
})
afterEach(() => {
  controllers.forEach(controller => controller.dispose())
  document.body.innerHTML = ''
  vi.restoreAllMocks(); vi.unstubAllGlobals()
})

describe('reading column lifecycle regressions', () => {
  it('clicking a handle focuses it without scrolling, so the next arrow key changes width', () => {
    const f = fixture()
    const focus = vi.spyOn(f.handle, 'focus')
    pointer(f.handle, 'pointerdown', 500); pointer(f.handle, 'pointerup', 500)
    expect(document.activeElement).toBe(f.handle)
    expect(focus).toHaveBeenCalledWith({ preventScroll: true })
    document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
    expect(f.options.onWidth).toHaveBeenLastCalledWith(820)
  })
  it('another primary pointer cannot replace the active captured pointer', () => {
    const f = fixture()
    pointer(f.handle, 'pointerdown', 500, 1)
    pointer(f.handle, 'pointerdown', 900, 2)
    pointer(f.handle, 'pointermove', 540, 1); frame()
    expect(f.options.onWidth).toHaveBeenLastCalledWith(880)
  })
  it('capture outside the handle cannot trigger a link/media click during drag or on release', () => {
    const f = fixture()
    const clicked = vi.fn()
    const link = f.root.querySelector('a')!
    link.addEventListener('click', clicked)
    pointer(f.handle, 'pointerdown', 500); pointer(f.handle, 'pointermove', 540); frame()
    const during = new MouseEvent('click', { bubbles: true, cancelable: true })
    link.dispatchEvent(during)
    expect(during.defaultPrevented).toBe(true)
    expect(clicked).not.toHaveBeenCalled()
    pointer(f.handle, 'pointerup', 540)
    const release = new MouseEvent('click', { bubbles: true, cancelable: true })
    link.dispatchEvent(release)
    expect(release.defaultPrevented).toBe(true)
    pointer(link, 'pointerdown', 540)
    link.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    expect(clicked).toHaveBeenCalledOnce()
  })
  it('zoom changes flush the last valid coalesced move before ending the drag', () => {
    const f = fixture()
    pointer(f.handle, 'pointerdown', 500); pointer(f.handle, 'pointermove', 540)
    f.controller.update({ ...f.options, width: 880, zoom: 2 })
    expect(f.options.onWidth).toHaveBeenLastCalledWith(880)
    expect(f.options.onFlush).toHaveBeenCalledOnce()
    expect(document.body.style.userSelect).toBe('')
    frame()
    expect(f.column.style.width).toBe('880px')
    expect(f.root.style.width).toBe('440px')
  })
  it('a viewport change ends the drag instead of applying a move using new bounds', () => {
    const f = fixture()
    pointer(f.handle, 'pointerdown', 500); pointer(f.handle, 'pointermove', 540)
    viewport = 850; resized([], {} as ResizeObserver); frame()
    expect(f.options.onWidth).not.toHaveBeenCalled()
    expect(f.handle.hidden).toBe(true)
    expect(document.body.style.cursor).toBe('')
  })
  it('async height changes keep the last observed reading block at its screen offset', () => {
    const f = fixture()
    anchorTop = 500
    f.scroll.scrollTop = 520; f.scroll.dispatchEvent(new Event('scroll'))
    anchorTop = 800; height = 1600
    resized([], {} as ResizeObserver); frame(); frame()
    expect(f.scroll.scrollTop).toBe(820)
    expect(f.column.style.height).toBe('1600px')
  })
  it('a user scroll between reflow and the compensation frame is never undone', () => {
    const f = fixture()
    anchorTop = 500; f.scroll.scrollTop = 520; f.scroll.dispatchEvent(new Event('scroll'))
    f.options.onLayout.mockImplementation(() => { anchorTop = 600 })
    pointer(f.handle, 'pointerdown', 500); pointer(f.handle, 'pointermove', 540); frame()
    f.scroll.dispatchEvent(new Event('wheel'))
    f.scroll.scrollTop = 900; f.scroll.dispatchEvent(new Event('scroll'))
    frame()
    expect(f.scroll.scrollTop).toBe(900)
  })
  it('dispose removes capture-phase suppression and cancels old-document compensation', () => {
    const f = fixture()
    pointer(f.handle, 'pointerdown', 500); pointer(f.handle, 'pointermove', 540); frame()
    f.controller.dispose()
    const link = f.root.querySelector('a')!
    const clicked = vi.fn(); link.addEventListener('click', clicked)
    link.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    expect(clicked).toHaveBeenCalledOnce()
    expect(f.surface.querySelector('[role="separator"]')).toBeNull()
    frame()
    expect(document.body.style.cursor).toBe('')
  })
})
