import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { captureReadingPosition, contentSignature, readingPositionTop, ReadingProgressStore, sanitizeReadingPosition, type ReadingPosition } from '../../src/lib/readingProgress'
import { attachReadingPosition } from '../../src/hooks/useReadingPosition'

let scroll: HTMLDivElement, root: HTMLDivElement
let frames: Map<number, FrameRequestCallback>
const position = (patch: Partial<ReadingPosition> = {}): ReadingPosition => ({
  top: 400, ratio: .5, signature: contentSignature('old'), anchorText: 'kept paragraph', anchorIndex: 1, anchorOffset: 10, updatedAt: Date.now(), ...patch,
})
const rect = (top: number, bottom = top + 40) => ({ top, bottom, left: 0, right: 600, width: 600, height: bottom - top, x: 0, y: top, toJSON() {} })
let max = 800
beforeEach(() => {
  frames = new Map(); max = 800
  vi.stubGlobal('requestAnimationFrame', (fn: FrameRequestCallback) => { const id = frames.size + 1; frames.set(id, fn); return id })
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id))
  scroll = document.createElement('div'); root = document.createElement('div')
  root.innerHTML = '<h1>heading</h1><p>kept paragraph</p><p>tail</p>'
  scroll.append(root); document.body.append(scroll)
  Object.defineProperty(scroll, 'scrollHeight', { get: () => max + 200 })
  Object.defineProperty(scroll, 'clientHeight', { value: 200 })
  scroll.getBoundingClientRect = () => rect(100, 300)
  root.querySelectorAll<HTMLElement>('h1,p').forEach((el, index) => { el.getBoundingClientRect = () => rect(120 + index * 300 - scroll.scrollTop) })
  window.localStorage.removeItem('madureader-reading-progress')
})
afterEach(() => { scroll.remove(); vi.unstubAllGlobals(); vi.useRealTimers() })
function paint() { const batch = [...frames.values()]; frames.clear(); batch.forEach(fn => fn(0)) }

describe('reading position correction', () => {
  it('first opening always starts at top, not previous container offset', () => {
    scroll.scrollTop = 600
    expect(readingPositionTop(scroll, root, contentSignature('new'))).toBe(0)
    const dispose = attachReadingPosition(scroll, root, 'new', undefined, vi.fn())
    expect(scroll.scrollTop).toBe(0); dispose()
  })
  it('captures the first visible block and normalized progress', () => {
    scroll.scrollTop = 400
    const saved = captureReadingPosition(scroll, root, contentSignature('old'))
    expect(saved).toMatchObject({ top: 400, ratio: .5, anchorText: 'tail', anchorIndex: 2 })
  })
  it('same content preserves exact position and safely clamps after shrinking', () => {
    expect(readingPositionTop(scroll, root, contentSignature('old'), position())).toBe(400)
    max = 80
    expect(readingPositionTop(scroll, root, contentSignature('old'), position())).toBe(80)
    max = 0
    expect(readingPositionTop(scroll, root, contentSignature('old'), position())).toBe(0)
  })
  it('same content width reflow explicitly restores its block, not old pixel top', () => {
    expect(readingPositionTop(scroll, root, contentSignature('old'), position(), true)).toBe(310)
  })
  it('width reflow ends opening restoration so a delayed image cannot restore stale pixels', () => {
    const image = document.createElement('img'); root.append(image)
    Object.defineProperty(image, 'complete', { get: () => false })
    const dispose = attachReadingPosition(scroll, root, 'old', position(), vi.fn())
    scroll.dispatchEvent(new Event('madu:reading-reflow'))
    scroll.scrollTop = 310
    image.dispatchEvent(new Event('load')); paint()
    expect(scroll.scrollTop).toBe(310); dispose()
  })
  it('edited content relocates the retained paragraph instead of unrelated pixels', () => {
    expect(readingPositionTop(scroll, root, contentSignature('new'), position())).toBe(310)
  })
  it('deleted anchor uses relative progress and handles empty or short documents', () => {
    const saved = position({ anchorText: 'deleted' })
    expect(readingPositionTop(scroll, root, contentSignature('new'), saved)).toBe(400)
    max = 20
    expect(readingPositionTop(scroll, root, contentSignature('new'), saved)).toBe(10)
  })
  it('top remains top even when the document is modified', () => {
    expect(readingPositionTop(scroll, root, 'new', position({ top: 0 }))).toBe(0)
  })
  it('restore waits for delayed image geometry without overwriting the original position', () => {
    const image = document.createElement('img'); root.append(image)
    Object.defineProperty(image, 'complete', { configurable: true, get: () => false })
    const save = vi.fn(); max = 20
    const dispose = attachReadingPosition(scroll, root, 'old', position(), save)
    expect(scroll.scrollTop).toBe(20)
    scroll.dispatchEvent(new Event('scroll')); paint()
    expect(save).not.toHaveBeenCalled()
    max = 800
    Object.defineProperty(image, 'complete', { get: () => true })
    image.dispatchEvent(new Event('load')); paint()
    expect(scroll.scrollTop).toBe(400); expect(save).toHaveBeenCalled()
    dispose()
  })
  it('user scroll wins over delayed images and remains remembered while page stays open', () => {
    const image = document.createElement('img'); root.append(image)
    Object.defineProperty(image, 'complete', { get: () => false })
    const save = vi.fn()
    const dispose = attachReadingPosition(scroll, root, 'old', position(), save)
    scroll.dispatchEvent(new Event('wheel')); scroll.scrollTop = 620; scroll.dispatchEvent(new Event('scroll'))
    expect(save.mock.lastCall?.[0].top).toBe(620)
    image.dispatchEvent(new Event('load')); paint()
    expect(scroll.scrollTop).toBe(620); dispose()
  })
  it('before switching flushes current live geometry, and cleanup does not read disconnected DOM', () => {
    const save = vi.fn(); const dispose = attachReadingPosition(scroll, root, 'old', position(), save)
    paint(); scroll.scrollTop = 510
    window.dispatchEvent(new Event('madu:before-document-change'))
    expect(save.mock.lastCall?.[0].top).toBe(510)
    save.mockClear(); scroll.remove(); dispose()
    expect(save).not.toHaveBeenCalled()
  })
  it('disposes image listeners and pending animation frames', () => {
    const save = vi.fn(); const dispose = attachReadingPosition(scroll, root, 'old', position(), save)
    dispose(); paint(); scroll.dispatchEvent(new Event('scroll'))
    expect(save).not.toHaveBeenCalled()
  })
  it('invalid persisted numbers cannot escape viewport or propagate NaN', () => {
    expect(sanitizeReadingPosition({ signature: 'x', top: NaN, ratio: Infinity, anchorOffset: -Infinity })).toMatchObject({ top: 0, ratio: 0, anchorOffset: 0 })
    expect(sanitizeReadingPosition(null)).toBeNull()
  })
})

describe('per-file persistence without closing the page', () => {
  it('keeps each path independent, with Windows case-insensitive keys', async () => {
    vi.useFakeTimers()
    const store = new ReadingProgressStore()
    store.record('D:\\docs\\a.md', position({ top: 100 }))
    store.record('D:\\docs\\b.md', position({ top: 600 }))
    expect(store.get('d:/DOCS/a.md')?.top).toBe(100)
    expect(store.get('D:/docs/b.md')?.top).toBe(600)
    expect(store.get('D:/docs/new.md')).toBeUndefined()
    await store.flush()
    const restored = new ReadingProgressStore(); await restored.load()
    expect(restored.get('d:/docs/a.md')?.top).toBe(100)
    store.reset(); restored.reset()
  })
  it('serial flushes keep the newest position rather than stale writes', async () => {
    vi.useFakeTimers(); const store = new ReadingProgressStore()
    store.record('/a.md', position({ top: 1 })); const first = store.flush()
    store.record('/a.md', position({ top: 2 })); const second = store.flush()
    await Promise.all([first, second])
    const restored = new ReadingProgressStore(); await restored.load()
    expect(restored.get('/a.md')?.top).toBe(2)
    store.reset(); restored.reset()
  })
  it('damaged cache cannot prevent initial opening at the top', async () => {
    window.localStorage.setItem('madureader-reading-progress', 'broken json')
    const store = new ReadingProgressStore(); await expect(store.load()).resolves.toBeUndefined()
    expect(store.get('/a.md')).toBeUndefined(); store.reset()
  })
  it('history is bounded and never stores the complete document', async () => {
    vi.useFakeTimers(); const store = new ReadingProgressStore()
    for (let i = 0; i < 1002; i++) store.record(`/${i}.md`, position())
    await store.flush()
    const data = JSON.parse(window.localStorage.getItem('madureader-reading-progress')!)
    expect(Object.keys(data)).toHaveLength(1000)
    expect(store.get('/0.md')).toBeUndefined()
    expect(Object.keys(data['/1001.md'])).not.toContain('content')
    store.reset()
  })
})
