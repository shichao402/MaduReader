import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ContentArea from '../../src/components/ContentArea'
import { readingProgress } from '../../src/lib/readingProgress'

const app = vi.hoisted(() => ({
  tabStore: { activeTab: { path: '/docs/a.md' }, activeTabId: 'a', activeContent: 'same' },
  settingsStore: { currentZoom: 100, isDark: false, settings: { fontSize: 16, plantUmlServer: '' } },
  renderMarkdown: vi.fn(),
}))
vi.mock('../../src/hooks/useStores', () => ({ useStores: () => app, getTabStore: () => app.tabStore, getSettingsStore: () => app.settingsStore }))
vi.mock('../../src/composables/useMarkdown', () => ({ renderMarkdownAsync: app.renderMarkdown, initCodeCopy: () => {} }))
vi.mock('../../src/composables/useMermaid', () => ({ renderMermaidCode: async (html: string) => html }))
vi.mock('../../src/composables/usePlantUml', () => ({ renderPlantUmlCode: (html: string) => html }))
vi.mock('../../src/composables/useLinkHandler', () => ({ attachLinkHandler: () => {}, detachLinkHandler: () => {} }))
vi.mock('../../src/lib/inlineDiagrams', () => ({ attachInlineDiagrams: () => ({ dispose: () => {}, refresh: () => {}, handleToggle: () => false, payloadFromTarget: () => null }) }))
vi.mock('../../src/components/ExportDialog', () => ({ default: () => null }))
vi.mock('../../src/components/MediaLightbox', () => ({ default: () => null }))

let host: HTMLDivElement, root: Root, frames: Map<number, FrameRequestCallback>, next: number
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  frames = new Map(); next = 0
  vi.stubGlobal('requestAnimationFrame', (fn: FrameRequestCallback) => { const id = next++; frames.set(id, fn); return id })
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id))
  vi.stubGlobal('ResizeObserver', class { observe() {}; disconnect() {} })
  vi.spyOn(Element.prototype, 'scrollHeight', 'get').mockReturnValue(1200)
  vi.spyOn(Element.prototype, 'clientHeight', 'get').mockReturnValue(200)
  app.tabStore = { activeTab: { path: '/docs/a.md' }, activeTabId: 'a', activeContent: 'same' }
  app.renderMarkdown.mockReset().mockImplementation(async (source: string) => `<h1>${source}</h1><p>body</p>`)
  readingProgress.reset()
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
})
afterEach(() => { act(() => root.unmount()); host.remove(); readingProgress.reset(); vi.restoreAllMocks(); vi.unstubAllGlobals() })
async function render() {
  await act(async () => { root.render(createElement(ContentArea, { onOpenSettings: () => {} })) })
  act(() => { const batch = [...frames.values()]; frames.clear(); batch.forEach(fn => fn(0)) })
}
function scroller() { return host.querySelector<HTMLElement>('[data-reading-path]')! }
async function activate(id: string, content = 'same') {
  window.dispatchEvent(new Event('madu:before-document-change'))
  app.tabStore = { activeTab: { path: `/docs/${id}.md` }, activeTabId: id, activeContent: content }
  await render()
}
function readAt(top: number) { scroller().dispatchEvent(new Event('wheel')); scroller().scrollTop = top; scroller().dispatchEvent(new Event('scroll')) }

describe('ContentArea independent document scrolling', () => {
  it('different documents with identical contents start at top and re-render by identity', async () => {
    await render(); readAt(650)
    const a = scroller()
    await activate('b')
    expect(scroller()).not.toBe(a)
    expect(scroller().dataset.readingPath).toBe('/docs/b.md')
    expect(scroller().scrollTop).toBe(0)
    expect(app.renderMarkdown).toHaveBeenCalledTimes(2)
  })
  it('switching back restores each document position without closing the page', async () => {
    await render(); readAt(650)
    await activate('b'); readAt(280)
    await activate('a')
    expect(scroller().scrollTop).toBe(650)
    await activate('b')
    expect(scroller().scrollTop).toBe(280)
  })
  it('new content hides old DOM while rendering and late completion cannot overwrite the current document', async () => {
    await render(); readAt(650)
    let resolve!: (html: string) => void
    app.renderMarkdown.mockImplementationOnce(() => new Promise<string>(done => { resolve = done }))
    await activate('slow', 'slow source')
    expect(host.querySelector('[data-reading-path]')).toBeNull()
    expect(host.textContent).toContain('正在加载文档')
    await activate('c', 'current source')
    await act(async () => resolve('<h1>late old document</h1>'))
    expect(scroller().dataset.readingPath).toBe('/docs/c.md')
    expect(host.textContent).toContain('current source')
    expect(host.textContent).not.toContain('late old document')
    expect(readingProgress.get('/docs/slow.md')).toBeUndefined()
  })
  it('manual close/reopen of the same path still retains its last reading position', async () => {
    await render(); readAt(420)
    window.dispatchEvent(new Event('madu:before-document-change'))
    app.tabStore.activeTabId = ''
    app.tabStore.activeContent = ''
    await render()
    await activate('a')
    expect(scroller().scrollTop).toBe(420)
  })
})
