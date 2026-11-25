import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { tabStore, type Tab } from '../../src/stores/tabs'
import ExternalChangeBanner from '../../src/components/ExternalChangeBanner'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const mocks = vi.hoisted(() => ({
  readText: vi.fn<(path: string) => Promise<string>>(),
  stat: vi.fn<(path: string) => Promise<string>>(),
}))
vi.mock('../../src/lib/fsAccess', () => ({
  allowAndReadTextFile: mocks.readText,
  allowAndStatFile: mocks.stat,
  allowAndReadDir: vi.fn(async () => []),
}))
vi.mock('../../src/lib/perfLog', () => ({ perfLog: vi.fn(async () => {}) }))

let disk: Map<string, string>
let stamps: Map<string, string>

function tab(path: string, content: string, extra: Partial<Tab> = {}): Tab {
  return { id: path, path, name: path.split('/').pop()!, content, isModified: false, isUntitled: false, ...extra }
}

function setup(tabs: Tab[], active: string) {
  tabStore.tabs = tabs
  tabStore.activeTabId = active
}

beforeEach(() => {
  tabStore.reset()
  vi.resetAllMocks()
  disk = new Map()
  stamps = new Map()
  mocks.readText.mockImplementation(async (path) => {
    const value = disk.get(path)
    if (value === undefined) throw new Error('missing')
    return value
  })
  mocks.stat.mockImplementation(async (path) => {
    const value = stamps.get(path)
    if (value === undefined) throw new Error('stat unavailable')
    return value
  })
})

describe('external file changes', () => {
  it('does not replace the document being read; marks it for manual refresh', async () => {
    setup([tab('/docs/a.md', 'old')], '/docs/a.md')
    disk.set('/docs/a.md', 'new')
    await tabStore.syncOpenFileContents()
    expect(tabStore.activeTab?.content).toBe('old')
    expect(tabStore.activeTab?.externalContent).toBe('new')

    tabStore.reloadExternalChange('/docs/a.md')
    expect(tabStore.activeTab?.content).toBe('new')
    expect(tabStore.activeTab?.externalContent).toBeUndefined()
  })

  it('silently updates clean background tabs', async () => {
    setup([tab('/docs/a.md', 'a'), tab('/docs/b.md', 'old')], '/docs/a.md')
    disk.set('/docs/a.md', 'a')
    disk.set('/docs/b.md', 'new')
    await tabStore.syncOpenFileContents()
    const b = tabStore.tabs.find(t => t.id === '/docs/b.md')!
    expect(b.content).toBe('new')
    expect(b.externalContent).toBeUndefined()
  })

  it('never overwrites background tabs with unsaved edits', async () => {
    setup([tab('/docs/a.md', 'a'), tab('/docs/b.md', 'edited', { isModified: true })], '/docs/a.md')
    disk.set('/docs/a.md', 'a')
    disk.set('/docs/b.md', 'new')
    await tabStore.syncOpenFileContents()
    const b = tabStore.tabs.find(t => t.id === '/docs/b.md')!
    expect(b.content).toBe('edited')
    expect(b.externalContent).toBe('new')
  })

  it('clears the notice when disk reverts to the displayed version', async () => {
    setup([tab('/docs/a.md', 'old')], '/docs/a.md')
    disk.set('/docs/a.md', 'new')
    await tabStore.syncOpenFileContents()
    disk.set('/docs/a.md', 'old')
    await tabStore.syncOpenFileContents()
    expect(tabStore.activeTab?.externalContent).toBeUndefined()
  })

  it('dismissing keeps the current version and only re-notifies on a newer change', async () => {
    setup([tab('/docs/a.md', 'old')], '/docs/a.md')
    disk.set('/docs/a.md', 'v2')
    await tabStore.syncOpenFileContents()
    tabStore.dismissExternalChange('/docs/a.md')
    await tabStore.syncOpenFileContents()
    expect(tabStore.activeTab?.externalContent).toBeUndefined()
    expect(tabStore.activeTab?.content).toBe('old')
    disk.set('/docs/a.md', 'v3')
    await tabStore.syncOpenFileContents()
    expect(tabStore.activeTab?.externalContent).toBe('v3')
  })

  it('skips reading when the disk stamp is unchanged', async () => {
    setup([tab('/docs/a.md', 'old')], '/docs/a.md')
    disk.set('/docs/a.md', 'old')
    stamps.set('/docs/a.md', '1:3')
    await tabStore.syncOpenFileContents()
    await tabStore.syncOpenFileContents()
    expect(mocks.readText).toHaveBeenCalledTimes(1)
    stamps.set('/docs/a.md', '2:3')
    disk.set('/docs/a.md', 'new')
    await tabStore.syncOpenFileContents()
    expect(mocks.readText).toHaveBeenCalledTimes(2)
    expect(tabStore.activeTab?.externalContent).toBe('new')
  })

  it('keeps content when the file cannot be read', async () => {
    setup([tab('/docs/a.md', 'old')], '/docs/a.md')
    await tabStore.syncOpenFileContents()
    expect(tabStore.activeTab?.content).toBe('old')
    expect(tabStore.activeTab?.externalContent).toBeUndefined()
  })

  it('reopening an already-open background file loads the fresh version', async () => {
    setup([tab('/docs/a.md', 'a'), tab('/docs/b.md', 'old')], '/docs/a.md')
    disk.set('/docs/b.md', 'new')
    await tabStore.openFile('/docs/b.md')
    expect(tabStore.activeTab?.id).toBe('/docs/b.md')
    expect(tabStore.activeTab?.content).toBe('new')
  })

  it('reopening the file being read only shows the notice', async () => {
    setup([tab('/docs/a.md', 'old')], '/docs/a.md')
    disk.set('/docs/a.md', 'new')
    await tabStore.openFile('/docs/a.md')
    expect(tabStore.activeTab?.content).toBe('old')
    expect(tabStore.activeTab?.externalContent).toBe('new')
  })
})

describe('ExternalChangeBanner', () => {
  function mount(modified: boolean, onReload = () => {}, onDismiss = () => {}) {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)
    act(() => root.render(createElement(ExternalChangeBanner, { modified, onReload, onDismiss })))
    return { host, unmount: () => { act(() => root.unmount()); host.remove() } }
  }

  it('lets the user refresh or dismiss', () => {
    const onReload = vi.fn()
    const onDismiss = vi.fn()
    const { host, unmount } = mount(false, onReload, onDismiss)
    expect(host.textContent).toContain('文件已在外部修改')
    expect(host.textContent).not.toContain('未保存')
    const buttons = host.querySelectorAll('button')
    act(() => { buttons[0].click() })
    act(() => { (host.querySelector('[aria-label="忽略外部修改提示"]') as HTMLButtonElement).click() })
    expect(onReload).toHaveBeenCalledTimes(1)
    expect(onDismiss).toHaveBeenCalledTimes(1)
    unmount()
  })

  it('warns that unsaved edits will be discarded', () => {
    const { host, unmount } = mount(true)
    expect(host.textContent).toContain('刷新将丢弃当前未保存的修改')
    unmount()
  })
})
