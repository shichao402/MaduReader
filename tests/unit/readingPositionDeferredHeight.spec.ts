import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { attachReadingPosition } from '../../src/hooks/useReadingPosition'
import { contentSignature, type ReadingPosition } from '../../src/lib/readingProgress'

let scroll: HTMLDivElement
let root: HTMLDivElement
let available: number
let resize: ResizeObserverCallback
const frames = new Map<number, FrameRequestCallback>()
let id = 0
function paint() {
  for (const [key, callback] of [...frames]) { frames.delete(key); callback(16) }
}
beforeEach(() => {
  available = 3000
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => { frames.set(++id, cb); return id })
  vi.stubGlobal('cancelAnimationFrame', (key: number) => frames.delete(key))
  vi.stubGlobal('ResizeObserver', class {
    constructor(cb: ResizeObserverCallback) { resize = cb }
    observe() {} disconnect() {}
  })
  scroll = document.createElement('div'); root = document.createElement('div')
  root.innerHTML = '<p>Persistent reading position</p><div class="media-frame"></div>'
  scroll.append(root); document.body.append(scroll)
  Object.defineProperty(scroll, 'scrollHeight', { get: () => available + 200 })
  Object.defineProperty(scroll, 'clientHeight', { value: 200 })
  scroll.getBoundingClientRect = () => ({ top: 0 } as DOMRect)
  root.firstElementChild!.getBoundingClientRect = () => ({ top: 4200 - scroll.scrollTop, bottom: 4300 - scroll.scrollTop } as DOMRect)
})
afterEach(() => { scroll.remove(); frames.clear(); vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.useRealTimers() })
it('does not replace an old valid reading position with an early clamped layout', () => {
  const source = 'unchanged long document'
  const saved: ReadingPosition = {
    top: 4200, ratio: 0.5, signature: contentSignature(source), anchorIndex: 0,
    anchorText: 'Persistent reading position', anchorOffset: 0, updatedAt: Date.now(),
  }
  const onSave = vi.fn()
  const dispose = attachReadingPosition(scroll, root, source, saved, onSave)
  expect(scroll.scrollTop).toBe(3000)
  paint()
  expect(onSave).not.toHaveBeenCalled()
  scroll.dispatchEvent(new CustomEvent('madu:reading-reflow', { detail: { widthChanged: false } }))
  expect(onSave).not.toHaveBeenCalled()
  available = 9000
  resize([], {} as ResizeObserver); paint()
  expect(scroll.scrollTop).toBe(4200)
  expect(scroll.dataset.readingPositionRestoring).toBe('true')
  expect(onSave).not.toHaveBeenCalled()
  dispose()
})
it('keeps the saved pixel top through a late media reflow before it settles', () => {
  available = 9000
  const source = 'unchanged long document'
  const saved: ReadingPosition = {
    top: 4200, ratio: 0.5, signature: contentSignature(source), anchorIndex: 0,
    anchorText: 'Persistent reading position', anchorOffset: 0, updatedAt: Date.now(),
  }
  const dispose = attachReadingPosition(scroll, root, source, saved, vi.fn())
  paint()
  scroll.scrollTop = 2503
  scroll.dispatchEvent(new CustomEvent('madu:reading-reflow', { detail: { widthChanged: false } }))
  paint()
  expect(scroll.scrollTop).toBe(4200)
  dispose()
})
