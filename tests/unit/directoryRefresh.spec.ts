import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { tabStore, type Tab } from '../../src/stores/tabs'

type Entry = { name: string; isDirectory: boolean }
const mocks = vi.hoisted(() => ({
  readDir: vi.fn<(path: string) => Promise<Entry[]>>(),
  readText: vi.fn<(path: string) => Promise<string>>(),
  exists: vi.fn<(path: string) => Promise<boolean>>(),
  perfLog: vi.fn<(message: string) => Promise<void>>(),
}))
vi.mock('../../src/lib/fsAccess', () => ({
  allowAndReadDir: mocks.readDir,
  allowAndReadTextFile: mocks.readText,
}))
vi.mock('@tauri-apps/plugin-fs', () => ({
  readDir: mocks.readDir,
  readTextFile: mocks.readText,
  exists: mocks.exists,
}))
vi.mock('../../src/lib/perfLog', () => ({ perfLog: mocks.perfLog }))

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
const file = (name: string): Entry => ({ name, isDirectory: false })
const dir = (name: string): Entry => ({ name, isDirectory: true })
function tab(path: string, sourceMissing?: boolean): Tab {
  return {
    id: path, path, name: path.split('/').pop()!, content: `snapshot:${path}`,
    isModified: true, isUntitled: false, sourceMissing,
  }
}
let listing: Map<string, Entry[] | Error>
async function load(root = '/docs') {
  tabStore.setWorkingDirectory(root)
  await tabStore.refreshFileTree()
}
const names = () => tabStore.fileTree.map((node) => node.name)
const waitFor = (assertion: () => void) => vi.waitFor(assertion, { interval: 1 })

beforeEach(() => {
  tabStore.reset()
  vi.resetAllMocks()
  listing = new Map()
  mocks.readDir.mockImplementation(async (path) => {
    const result = listing.get(path) ?? []
    if (result instanceof Error) throw result
    return result
  })
  mocks.readText.mockResolvedValue('# disk content')
  mocks.exists.mockResolvedValue(true)
  mocks.perfLog.mockResolvedValue(undefined)
  vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => { vi.restoreAllMocks() })

describe('directory refresh scheduling and workspace generations', () => {
  it('coalesces bursts, scans serially, and keeps every waiter pending through follow-up scans', async () => {
    const gates = [deferred<Entry[]>(), deferred<Entry[]>(), deferred<Entry[]>()]
    let active = 0
    let peak = 0
    mocks.readDir.mockImplementation(async () => {
      const index = mocks.readDir.mock.calls.length - 1
      peak = Math.max(peak, ++active)
      try { return await gates[index].promise } finally { active -= 1 }
    })
    tabStore.setWorkingDirectory('/docs')
    const first = tabStore.refreshFileTree()
    expect(tabStore.refreshFileTree()).toBe(first)
    let settled = 0
    void first.then(() => { settled += 1 })
    await waitFor(() => expect(mocks.readDir).toHaveBeenCalledTimes(1))
    const second = tabStore.refreshFileTree()
    void second.then(() => { settled += 1 })
    for (let i = 0; i < 12; i += 1) void tabStore.refreshFileTree()
    gates[0].resolve([file('old.md')])
    await waitFor(() => expect(mocks.readDir).toHaveBeenCalledTimes(2))
    expect(settled).toBe(0)
    const third = tabStore.refreshFileTree()
    gates[1].resolve([file('middle.md')])
    await waitFor(() => expect(mocks.readDir).toHaveBeenCalledTimes(3))
    expect(settled).toBe(0)
    gates[2].resolve([file('latest.md')])
    await Promise.all([first, second, third])
    expect(names()).toEqual(['latest.md'])
    expect(peak).toBe(1)
    expect(settled).toBe(2)
    expect(mocks.perfLog).toHaveBeenCalledTimes(3)
    expect(mocks.perfLog.mock.calls.every(([line]) => /generation=\d+ request=\d+.* in \d+ms/.test(line))).toBe(true)
  })

  it('includes a request arriving in the drain-to-promise-cleanup microtask window', async () => {
    const last = deferred<Entry[]>()
    mocks.readDir.mockResolvedValueOnce([file('old.md')]).mockImplementationOnce(() => last.promise)
    mocks.perfLog.mockImplementationOnce(async () => {
      queueMicrotask(() => { void tabStore.refreshFileTree() })
    })
    tabStore.setWorkingDirectory('/docs')
    const original = tabStore.refreshFileTree()
    let done = false
    void original.then(() => { done = true })
    await waitFor(() => expect(mocks.readDir).toHaveBeenCalledTimes(2))
    expect(done).toBe(false)
    last.resolve([file('latest.md')])
    await original
    expect(names()).toEqual(['latest.md'])
  })

  it('does not scan an unset directory', async () => {
    await tabStore.refreshFileTree()
    expect(mocks.readDir).not.toHaveBeenCalled()
    expect(tabStore.isVirtualWorkspace).toBe(false)
    expect(tabStore.directoryError).toBeNull()
  })

  it('rejects the first A result after A -> B -> A, even though the path matches again', async () => {
    const old = deferred<Entry[]>()
    const current = deferred<Entry[]>()
    mocks.readDir.mockImplementationOnce(() => old.promise).mockImplementationOnce(() => current.promise)
    tabStore.setWorkingDirectory('/A')
    const first = tabStore.refreshFileTree()
    await waitFor(() => expect(mocks.readDir).toHaveBeenCalledTimes(1))
    tabStore.setWorkingDirectory('/B')
    tabStore.workingDirectory = '/A/'
    const latest = tabStore.refreshFileTree()
    expect(mocks.readDir).toHaveBeenCalledTimes(1)
    old.resolve([file('stale.md')])
    await waitFor(() => expect(mocks.readDir).toHaveBeenCalledTimes(2))
    expect(names()).toEqual([])
    current.resolve([file('current.md')])
    await Promise.all([first, latest])
    expect(mocks.readDir.mock.calls.map(([path]) => path)).toEqual(['/A', '/A'])
    expect(names()).toEqual(['current.md'])
    const lines = mocks.perfLog.mock.calls.map(([line]) => line)
    expect(lines[0]).toContain('stale')
    expect(lines[0].match(/generation=(\d+)/)?.[1]).not.toBe(lines[1].match(/generation=(\d+)/)?.[1])
  })

  it('keeps the scan lock until old recursive branches have also completed', async () => {
    const child = deferred<Entry[]>()
    listing.set('/A', [dir('slow')])
    listing.set('/B', [file('new.md')])
    mocks.readDir.mockImplementation(async (path) => path === '/A/slow' ? child.promise : listing.get(path) as Entry[])
    tabStore.setWorkingDirectory('/A')
    const old = tabStore.refreshFileTree()
    await waitFor(() => expect(mocks.readDir).toHaveBeenCalledWith('/A/slow'))
    tabStore.setWorkingDirectory('/B')
    const latest = tabStore.refreshFileTree()
    expect(mocks.readDir).not.toHaveBeenCalledWith('/B')
    child.resolve([file('old.md')])
    await Promise.all([old, latest])
    expect(names()).toEqual(['new.md'])
  })

  it('reset invalidates old results without releasing the actual scan lock', async () => {
    const old = deferred<Entry[]>()
    const current = deferred<Entry[]>()
    mocks.readDir.mockImplementationOnce(() => old.promise).mockImplementationOnce(() => current.promise)
    tabStore.setWorkingDirectory('/docs')
    const pending = tabStore.refreshFileTree()
    await waitFor(() => expect(mocks.readDir).toHaveBeenCalledTimes(1))
    tabStore.reset()
    tabStore.setWorkingDirectory('/docs')
    const latest = tabStore.refreshFileTree()
    expect(mocks.readDir).toHaveBeenCalledTimes(1)
    old.resolve([file('stale.md')])
    await waitFor(() => expect(mocks.readDir).toHaveBeenCalledTimes(2))
    expect(names()).toEqual([])
    current.resolve([file('new.md')])
    await Promise.all([pending, latest])
    expect(names()).toEqual(['new.md'])
  })

  it('does not leak an old root error into reset state', async () => {
    const old = deferred<Entry[]>()
    mocks.readDir.mockImplementationOnce(() => old.promise)
    tabStore.setWorkingDirectory('/docs')
    const pending = tabStore.refreshFileTree()
    await waitFor(() => expect(mocks.readDir).toHaveBeenCalledTimes(1))
    tabStore.reset()
    old.reject(new Error('old permission failure'))
    await pending
    expect(tabStore.workingDirectory).toBe('')
    expect(tabStore.directoryError).toBeNull()
    expect(names()).toEqual([])
  })

  it.each([false, true])('isolates a same-root virtual workspace from an in-flight real scan (empty=%s)', async (empty) => {
    const old = deferred<Entry[]>()
    mocks.readDir.mockImplementationOnce(() => old.promise)
    tabStore.setWorkingDirectory('/docs')
    const pending = tabStore.refreshFileTree()
    await waitFor(() => expect(mocks.readDir).toHaveBeenCalledTimes(1))
    await tabStore.setVirtualWorkspace('/docs', empty ? [] : [{ path: '/docs/virtual.md', content: '# virtual' }])
    const latest = tabStore.refreshFileTree()
    old.resolve([file('stale.md')])
    await Promise.all([pending, latest])
    expect(tabStore.isVirtualWorkspace).toBe(true)
    expect(names()).toEqual(empty ? [] : ['virtual.md'])
    expect(tabStore.activeContent).toBe(empty ? '' : '# virtual')
    expect(mocks.readDir).toHaveBeenCalledTimes(1)
    expect(mocks.readText).not.toHaveBeenCalled()
    expect(mocks.exists).not.toHaveBeenCalled()
  })

  it('setWorkingDirectory exits virtual mode even for the same root and removes virtual read overrides', async () => {
    await tabStore.setVirtualWorkspace('/docs', [{ path: '/docs/a.md', content: '# virtual' }])
    listing.set('/docs', [file('a.md')])
    await load('/docs/')
    expect(tabStore.isVirtualWorkspace).toBe(false)
    await tabStore.openFile('/docs/a.md')
    expect(mocks.readText).toHaveBeenCalledWith('/docs/a.md')
    expect(tabStore.activeContent).toBe('# virtual')
    expect(tabStore.tabs).toHaveLength(1)
  })

  it('session restoration isolates same-root old scans', async () => {
    const old = deferred<Entry[]>()
    const current = deferred<Entry[]>()
    mocks.readDir.mockImplementationOnce(() => old.promise).mockImplementationOnce(() => current.promise)
    tabStore.setWorkingDirectory('/docs')
    const pending = tabStore.refreshFileTree()
    await waitFor(() => expect(mocks.readDir).toHaveBeenCalledTimes(1))
    await tabStore.restoreSession({ workingDirectory: '/docs', openPaths: [], activePath: null })
    const latest = tabStore.refreshFileTree()
    old.resolve([file('stale.md')])
    await waitFor(() => expect(mocks.readDir).toHaveBeenCalledTimes(2))
    expect(names()).toEqual([])
    current.resolve([file('restored.md')])
    await Promise.all([pending, latest])
    expect(names()).toEqual(['restored.md'])
  })

  it.each(['reset', 'virtual', 'directory', 'restore'])('discards stale session file reads after %s', async (action) => {
    const text = deferred<string>()
    mocks.readText.mockImplementationOnce(() => text.promise)
    const pending = tabStore.restoreSession({ workingDirectory: '/docs', openPaths: ['/docs/old.md'], activePath: '/docs/old.md' })
    await waitFor(() => expect(mocks.readText).toHaveBeenCalledTimes(1))
    if (action === 'reset') tabStore.reset()
    if (action === 'virtual') await tabStore.setVirtualWorkspace('/docs', [])
    if (action === 'directory') await load('/new')
    if (action === 'restore') await tabStore.restoreSession({ workingDirectory: '/docs', openPaths: [], activePath: null })
    text.resolve('# stale session')
    await pending
    await tabStore.refreshFileTree()
    expect(tabStore.tabs).toEqual([])
    expect(tabStore.activeTabId).toBeNull()
  })

  it('restores virtual sessions without switching them to real filesystem scans', async () => {
    await tabStore.setVirtualWorkspace('web-demo', [{ path: 'web-demo/a.markdown', content: '# demo' }])
    await tabStore.restoreSession({ workingDirectory: 'web-demo/', openPaths: ['web-demo/a.markdown'], activePath: 'web-demo/a.markdown' })
    await tabStore.refreshFileTree()
    expect(tabStore.isVirtualWorkspace).toBe(true)
    expect(tabStore.activeContent).toBe('# demo')
    expect(mocks.readDir).not.toHaveBeenCalled()
    expect(mocks.readText).not.toHaveBeenCalled()
  })

  it('discards stale exists metadata as well as stale trees after switching directories', async () => {
    listing.set('/docs', [file('old.md')])
    listing.set('/new', [file('new.md')])
    await load()
    const opened = tab('/outside/a.md', false)
    tabStore.tabs = [opened]
    const probe = deferred<boolean>()
    mocks.exists.mockImplementationOnce(() => probe.promise)
    const observed: boolean[] = []
    const unsubscribe = tabStore.subscribe(() => { observed.push(Boolean(opened.sourceMissing)) })
    const pending = tabStore.refreshFileTree()
    try {
      await waitFor(() => expect(mocks.exists).toHaveBeenCalledTimes(1))
      tabStore.setWorkingDirectory('/new')
      const latest = tabStore.refreshFileTree()
      probe.resolve(false)
      await Promise.all([pending, latest])
      expect(names()).toEqual(['new.md'])
      expect(opened.sourceMissing).toBe(false)
      expect(observed).not.toContain(true)
    } finally { probe.resolve(true); await pending; unsubscribe() }
  })

  it('same-root restoration retains known expansion and tree on a failed scan', async () => {
    listing.set('/docs', [dir('sub')])
    listing.set('/docs/sub', [file('a.md')])
    await load()
    tabStore.toggleFileNode('/docs/sub')
    const original = tabStore.fileTree
    const version = tabStore.version
    listing.set('/docs', new Error('disconnected'))
    await tabStore.restoreSession({ workingDirectory: '/docs', openPaths: [], activePath: null })
    await tabStore.refreshFileTree()
    expect(tabStore.fileTree).toBe(original)
    expect(tabStore.findNode('/docs/sub')?.expanded).toBe(true)
    expect(tabStore.directoryError).toContain('disconnected')
    expect(tabStore.version).toBe(version + 1)
  })

  it('does not drop concurrent file opens when the first open infers the directory', async () => {
    const a = deferred<string>()
    const b = deferred<string>()
    mocks.readText.mockImplementationOnce(() => a.promise).mockImplementationOnce(() => b.promise)
    const first = tabStore.openFile('/docs/a.md')
    const second = tabStore.openFile('/docs/b.md')
    await waitFor(() => expect(mocks.readText).toHaveBeenCalledTimes(2))
    a.resolve('# A')
    await waitFor(() => expect(tabStore.workingDirectory).toBe('/docs'))
    b.resolve('# B')
    await Promise.all([first, second])
    expect(tabStore.tabs.map((item) => item.path).sort()).toEqual(['/docs/a.md', '/docs/b.md'])
  })
})

describe('tree state and read failures', () => {
  it('preserves live expansion changes across directory reads and exists awaits', async () => {
    listing.set('/docs', [dir('keep'), dir('removed')])
    listing.set('/docs/keep', [dir('nested')])
    listing.set('/docs/keep/nested', [file('a.md')])
    listing.set('/docs/removed', [file('old.md')])
    await load()
    expect(tabStore.findNode('/docs/keep/nested/a.md')).toBeDefined()
    const read = deferred<Entry[]>()
    const probe = deferred<boolean>()
    mocks.readDir.mockImplementationOnce(() => read.promise)
    mocks.exists.mockImplementationOnce(() => probe.promise)
    tabStore.tabs = [tab('/outside/a.md')]
    const refresh = tabStore.refreshFileTree()
    try {
      await waitFor(() => expect(mocks.readDir.mock.calls.filter(([path]) => path === '/docs')).toHaveLength(2))
      tabStore.toggleFileNode('/docs/keep')
      tabStore.toggleFileNode('/docs/keep/nested')
      listing.set('/docs/new', [file('new.md')])
      read.resolve([dir('keep'), dir('new')])
      await waitFor(() => expect(mocks.exists).toHaveBeenCalledTimes(1))
      tabStore.toggleFileNode('/docs/keep')
      probe.resolve(true)
      await refresh
      expect(tabStore.directoryError, JSON.stringify(mocks.readDir.mock.calls)).toBeNull()
      expect(tabStore.findNode('/docs/keep')?.expanded).toBe(false)
      expect(tabStore.findNode('/docs/keep/nested')?.expanded).toBe(true)
      expect(tabStore.findNode('/docs/new')?.expanded, JSON.stringify(mocks.readDir.mock.calls)).toBe(false)
      expect(tabStore.findNode('/docs/removed')).toBeUndefined()
    } finally {
      read.resolve([])
      probe.resolve(true)
      await refresh
    }
  })

  it('does not emit or replace tree references on no-op refresh or unchanged setters', async () => {
    listing.set('/docs', [dir('sub')])
    listing.set('/docs/sub', [file('a.md')])
    await load()
    tabStore.toggleFileNode('/docs/sub')
    const original = tabStore.fileTree
    const version = tabStore.version
    const listener = vi.fn()
    const unsubscribe = tabStore.subscribe(listener)
    try {
      await tabStore.refreshFileTree()
      await load('/docs/')
      tabStore.activeTabId = tabStore.activeTabId
      tabStore.sidebarView = tabStore.sidebarView
      tabStore.fileTree = structuredClone(original)
      tabStore.tabs = tabStore.tabs
      expect(tabStore.version).toBe(version)
      expect(tabStore.fileTree).toBe(original)
      expect(listener).not.toHaveBeenCalled()
    } finally { unsubscribe() }
  })

  it('retains the last tree and flags on root failure, suppresses repeated error emits, and recovers to a real empty tree', async () => {
    listing.set('/docs', [file('a.md')])
    await load()
    const opened = tab('/docs/a.md')
    tabStore.tabs = [opened]
    const original = tabStore.fileTree
    listing.set('/docs', new Error('Permission denied'))
    await tabStore.refreshFileTree()
    expect(tabStore.fileTree).toBe(original)
    expect(tabStore.directoryError).toContain('/docs')
    expect(tabStore.directoryError).toContain('Permission denied')
    expect(opened.sourceMissing).toBeUndefined()
    expect(mocks.exists).not.toHaveBeenCalled()
    const version = tabStore.version
    await tabStore.refreshFileTree()
    expect(tabStore.version).toBe(version)
    listing.set('/docs', [])
    await tabStore.refreshFileTree()
    expect(tabStore.directoryError).toBeNull()
    expect(names()).toEqual([])
    expect(opened.sourceMissing).toBe(true)
    expect(opened.content).toBe('snapshot:/docs/a.md')
    expect(mocks.perfLog.mock.calls.some(([line]) => line.includes(' error in '))).toBe(true)
  })

  it('does not accept an invalid root listing as a successful empty directory', async () => {
    listing.set('/docs', [file('a.md')])
    await load()
    const original = tabStore.fileTree
    mocks.readDir.mockResolvedValueOnce(undefined as never)
    await tabStore.refreshFileTree()
    expect(tabStore.fileTree).toBe(original)
    expect(tabStore.directoryError).toContain('有效列表')
    await expect(tabStore.buildFileTree('/denied')).resolves.toEqual([])
    listing.set('/denied', new Error('unreadable'))
    await expect(tabStore.buildFileTree('/denied')).rejects.toThrow('/denied')
  })

  it('retains known failed subtrees, updates readable siblings, and never changes failed-subtree source flags', async () => {
    listing.set('/docs', [dir('bad'), dir('good')])
    listing.set('/docs/bad', [dir('nested'), file('known.md')])
    listing.set('/docs/bad/nested', [file('deep.md')])
    listing.set('/docs/good', [file('gone.md')])
    await load()
    tabStore.toggleFileNode('/docs/bad/nested')
    const original = tabStore.fileTree
    const known = tab('/docs/bad/known.md')
    const deep = tab('/docs/bad/nested/deep.md', true)
    const gone = tab('/docs/good/gone.md')
    tabStore.tabs = [known, deep, gone]
    listing.set('/docs/bad', new Error('disk disconnected'))
    listing.set('/docs/good', [file('new.markdown')])
    mocks.exists.mockResolvedValue(false)
    await tabStore.refreshFileTree()
    expect(tabStore.findNode('/docs/bad/known.md')).toBeDefined()
    expect(tabStore.findNode('/docs/bad/nested/deep.md')).toBeDefined()
    expect(tabStore.findNode('/docs/bad/nested')?.expanded).toBe(true)
    expect(tabStore.findNode('/docs/good/new.markdown')).toBeDefined()
    expect(tabStore.findNode('/docs/good/gone.md')).toBeUndefined()
    expect(known.sourceMissing).toBeUndefined()
    expect(deep.sourceMissing).toBe(true)
    expect(gone.sourceMissing).toBe(true)
    expect(mocks.exists).not.toHaveBeenCalled()
    expect(original[1].children[0].name).toBe('gone.md')
    expect(tabStore.directoryError).toContain('/docs/bad')
    expect(tabStore.directoryError).toContain('disk disconnected')
    expect(mocks.perfLog.mock.calls.some(([line]) => line.includes(' partial in '))).toBe(true)
  })

  it('does not invent content or deletion evidence for a failed directory with no known tree', async () => {
    listing.set('/docs', [dir('unknown'), file('root.md')])
    listing.set('/docs/unknown', new Error('denied'))
    tabStore.tabs = [tab('/docs/unknown/a.md')]
    mocks.exists.mockResolvedValue(false)
    await load()
    expect(names()).toEqual(['root.md'])
    expect(tabStore.directoryError).toContain('/docs/unknown')
    expect(tabStore.tabs[0].sourceMissing).toBeUndefined()
    expect(mocks.exists).not.toHaveBeenCalled()
  })
})

describe('sourceMissing metadata without reloading snapshots', () => {
  it('marks moved/deleted sources and clears flags when they return, without switching tabs or reading content', async () => {
    listing.set('/docs', [file('moved.md'), dir('deleted'), file('keep.md')])
    listing.set('/docs/deleted', [file('nested.md')])
    await load()
    const moved = tab('/docs/moved.md')
    const deleted = tab('/docs/deleted/nested.md')
    const keep = tab('/docs/keep.md')
    tabStore.tabs = [moved, deleted, keep]
    tabStore.activeTabId = moved.id
    const snapshots = tabStore.tabs.map((item) => ({ ...item }))
    listing.set('/docs', [file('renamed.md'), file('keep.md')])
    await tabStore.refreshFileTree()
    expect(moved.sourceMissing).toBe(true)
    expect(deleted.sourceMissing).toBe(true)
    expect(keep.sourceMissing).not.toBe(true)
    expect(tabStore.activeTabId).toBe(moved.id)
    expect(tabStore.tabs.map(({ sourceMissing: _missing, ...item }) => item)).toEqual(snapshots.map(({ sourceMissing: _missing, ...item }) => item))
    expect(tabStore.activeContent).toBe(moved.content)
    listing.set('/docs', [file('moved.md'), file('keep.md')])
    await tabStore.refreshFileTree()
    expect(moved.sourceMissing).toBe(false)
    expect(deleted.sourceMissing).toBe(true)
    expect(mocks.readText).not.toHaveBeenCalled()
    expect(mocks.exists).not.toHaveBeenCalled()
  })

  it('uses reliable exists results outside scan coverage, but does not interpret failed probes as deletion', async () => {
    listing.set('/docs', [dir('.hidden'), dir('node_modules'), file('image.png')])
    const missing = tab('/docs-other/missing.md')
    const denied = tab('/outside/denied.md')
    const stillMissing = tab('/outside/denied-again.md', true)
    const hidden = tab('/docs/.hidden/keep.md', true)
    const dependency = tab('/docs/node_modules/keep.md')
    const image = tab('/docs/image.png', true)
    const untitled = { ...tab(''), isUntitled: true }
    tabStore.tabs = [missing, denied, stillMissing, hidden, dependency, image, untitled]
    mocks.exists.mockImplementation(async (path) => {
      if (path.includes('denied')) throw new Error('forbidden path')
      return !path.includes('missing')
    })
    await load()
    expect(missing.sourceMissing).toBe(true)
    expect(denied.sourceMissing).toBeUndefined()
    expect(stillMissing.sourceMissing).toBe(true)
    expect(hidden.sourceMissing).toBe(false)
    expect(dependency.sourceMissing).not.toBe(true)
    expect(image.sourceMissing).toBe(false)
    expect(mocks.exists.mock.calls.map(([path]) => path).sort()).toEqual([
      '/docs-other/missing.md', '/docs/.hidden/keep.md', '/docs/node_modules/keep.md', '/outside/denied-again.md', '/outside/denied.md',
    ].sort())
    expect(tabStore.directoryError).toBeNull()
    expect(names()).toEqual([])
  })

  it('does not collapse case-sensitive paths', async () => {
    listing.set('/docs', [file('Case.md')])
    const present = tab('/docs/Case.md', true)
    const absent = tab('/docs/case.md')
    tabStore.tabs = [present, absent]
    await load()
    expect(present.sourceMissing).toBe(false)
    expect(absent.sourceMissing).toBe(true)
    expect(mocks.exists).not.toHaveBeenCalled()
  })
})

describe('path normalization and original pruning boundaries', () => {
  it.each([
    ['\\\\server\\share\\Docs\\', '//server/share/Docs'],
    ['//server//share///Docs/', '//server/share/Docs'],
    ['C:\\', 'C:/'], ['D:\\Docs\\', 'D:/Docs'], ['/', '/'], ['/Docs///', '/Docs'],
  ])('normalizes %s without losing UNC, root, or case', async (input, expected) => {
    listing.set(expected, [file('Readme.MARKDOWN')])
    await load(input)
    expect(tabStore.workingDirectory).toBe(expected)
    expect(mocks.readDir).toHaveBeenCalledWith(expected)
    const path = `${expected.endsWith('/') ? expected : `${expected}/`}Readme.MARKDOWN`
    expect(tabStore.findNode(path)?.path).toBe(path)
  })

  it.each([
    ['C:\\readme.md', 'C:/'], ['/readme.md', '/'], ['\\\\server\\share\\readme.md', '//server/share'],
  ])('infers the correct directory from opening %s', async (path, expected) => {
    await tabStore.openFile(path)
    expect(tabStore.workingDirectory).toBe(expected)
    expect(mocks.readDir).toHaveBeenCalledWith(expected)
    expect(tabStore.isVirtualWorkspace).toBe(false)
  })

  it('applies normalization to restored directory inference and tree toggles', async () => {
    await tabStore.restoreSession({ workingDirectory: '', openPaths: ['C:\\readme.md'], activePath: 'C:\\readme.md' })
    await tabStore.refreshFileTree()
    expect(tabStore.workingDirectory).toBe('C:/')
    await tabStore.setVirtualWorkspace('C:/', [{ path: 'C:\\sub\\a.md', content: '# A' }])
    tabStore.toggleFileNode('C:\\sub\\')
    expect(tabStore.findNode('C:\\sub')?.expanded).toBe(false)
  })

  it('keeps only markdown descendants and preserves hidden/node_modules/depth exclusions', async () => {
    listing.set('/docs', [dir('.hidden'), dir('node_modules'), dir('empty'), dir('chain'), file('.secret.md'), file('a.md'), file('B.MARKDOWN'), file('c.txt')])
    let path = '/docs/chain'
    for (let depth = 1; depth <= 10; depth += 1) {
      listing.set(path, [dir('next')])
      path += '/next'
    }
    listing.set(path, [file('too-deep.md')])
    await load()
    expect(names()).toEqual(['a.md', 'B.MARKDOWN'])
    expect(mocks.readDir).not.toHaveBeenCalledWith('/docs/.hidden')
    expect(mocks.readDir).not.toHaveBeenCalledWith('/docs/node_modules')
    expect(mocks.readDir).not.toHaveBeenCalledWith(path)
  })

  it('opens both supported markdown extensions from the tree and ignores other files', async () => {
    const open = vi.spyOn(tabStore, 'openFile').mockResolvedValue(undefined)
    tabStore.openFileFromTree('/docs/A.MD')
    tabStore.openFileFromTree('/docs/b.markdown')
    tabStore.openFileFromTree('/docs/c.txt')
    expect(open.mock.calls).toEqual([['/docs/A.MD'], ['/docs/b.markdown']])
  })
})
