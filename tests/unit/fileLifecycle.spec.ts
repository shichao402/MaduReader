import { beforeEach, describe, expect, it, vi } from 'vitest'
import { tabStore } from '../../src/stores/tabs'
import { DAY_MS, sanitizeFilePolicy, compareFileActivity } from '../../src/lib/fileActivity'
import { sanitizeSession } from '../../src/lib/session'
import { settingsStore } from '../../src/stores/settings'

const fs = vi.hoisted(() => ({ read: vi.fn(), dir: vi.fn(), exists: vi.fn() }))
vi.mock('../../src/lib/fsAccess', () => ({ allowAndReadTextFile: fs.read, allowAndReadDir: fs.dir }))
vi.mock('@tauri-apps/plugin-fs', () => ({ exists: fs.exists, readTextFile: fs.read, readDir: fs.dir }))

beforeEach(() => {
  tabStore.reset(); settingsStore.reset(); vi.clearAllMocks()
  fs.read.mockImplementation(async (path: string) => `# ${path}\nbody`)
  fs.dir.mockResolvedValue(['a', 'b', 'c', 'd', 'good', 'bad'].map(name => ({ name: name + '.md', isDirectory: false }))); fs.exists.mockResolvedValue(true)
})

const open = (name: string) => tabStore.openFile(`/docs/${name}.md`)

describe('file lifetime', () => {
  it('caps loaded files and retains only metadata in inactive', async () => {
    tabStore.applyFilePolicy({ maxOpenFiles: 2 })
    await open('a'); await open('b'); await open('c')
    expect(tabStore.tabs).toHaveLength(2)
    expect(tabStore.activeTab?.name).toBe('c.md')
    expect(tabStore.inactiveFiles.map(file => file.path)).toEqual(['/docs/a.md'])
    expect(Object.keys(tabStore.inactiveFiles[0]).sort()).toEqual(['accessCount', 'inactiveSince', 'lastAccessedAt', 'path'])
    expect(JSON.stringify(tabStore.snapshotSession())).not.toContain('# /docs/')
  })
  it('reactivates from disk and preserves frequency', async () => {
    tabStore.applyFilePolicy({ maxOpenFiles: 1 })
    await open('a'); await open('b')
    fs.read.mockResolvedValueOnce('# changed on disk')
    await open('a')
    expect(tabStore.activeContent).toBe('# changed on disk')
    expect(tabStore.activeTab?.accessCount).toBe(2)
    expect(tabStore.inactiveFiles.map(file => file.path)).toEqual(['/docs/b.md'])
  })
  it('does not erase dormant entry or active body when reactivation fails', async () => {
    tabStore.applyFilePolicy({ maxOpenFiles: 1 })
    await open('a'); await open('b')
    fs.read.mockRejectedValueOnce(new Error('moved'))
    await expect(open('a')).rejects.toThrow('moved')
    expect(tabStore.inactiveFiles).toHaveLength(1)
    expect(tabStore.activeTab?.name).toBe('b.md')
  })
  it('evicts least recently used, not recently opened low-frequency files', async () => {
    tabStore.applyFilePolicy({ maxOpenFiles: 2 })
    await open('a'); await open('b')
    const [a, b] = tabStore.tabs
    a.lastAccessedAt = 1; b.lastAccessedAt = 2
    tabStore.setActiveTab(a.id)
    await open('c')
    expect(tabStore.inactiveFiles[0].path).toBe('/docs/b.md')
    expect(tabStore.tabs.map(tab => tab.name)).toEqual(['a.md', 'c.md'])
  })
  it('changing limit acts immediately; increasing limit does not eagerly read inactive', async () => {
    await open('a'); await open('b'); await open('c')
    tabStore.applyFilePolicy({ maxOpenFiles: 1 })
    expect(tabStore.tabs).toHaveLength(1); expect(tabStore.inactiveFiles).toHaveLength(2)
    fs.read.mockClear()
    tabStore.applyFilePolicy({ maxOpenFiles: 20 })
    expect(fs.read).not.toHaveBeenCalled(); expect(tabStore.inactiveFiles).toHaveLength(2)
  })
  it('protects active, untitled, unsaved and missing-source snapshots', async () => {
    await open('a'); await open('b')
    tabStore.tabs[0].sourceMissing = true
    tabStore.updateTabContent(tabStore.tabs[1].id, '# unsaved')
    const draft = tabStore.newTab()
    await open('c')
    tabStore.applyFilePolicy({ maxOpenFiles: 1 })
    expect(tabStore.tabs).toHaveLength(4)
    expect(tabStore.tabs.find(tab => tab.id === draft.id)).toBeDefined()
    expect(tabStore.inactiveFiles).toHaveLength(0)
  })
  it('expires from inactiveSince and only at boundary, without reading disk', async () => {
    tabStore.applyFilePolicy({ maxOpenFiles: 1, inactiveRetentionDays: 2 })
    await open('a'); await open('b')
    const since = tabStore.inactiveFiles[0].inactiveSince
    fs.read.mockClear(); fs.exists.mockClear()
    tabStore.cleanupInactiveFiles(since + 2 * DAY_MS - 1)
    expect(tabStore.inactiveFiles).toHaveLength(1)
    tabStore.cleanupInactiveFiles(since + 2 * DAY_MS)
    expect(tabStore.inactiveFiles).toHaveLength(0)
    expect(tabStore.activeTab?.name).toBe('b.md')
    expect(fs.read).not.toHaveBeenCalled(); expect(fs.exists).not.toHaveBeenCalled()
  })
  it('manual close only removes the inactive entry', async () => {
    tabStore.applyFilePolicy({ maxOpenFiles: 1 })
    await open('a'); await open('b')
    tabStore.closeInactiveFile('/docs/a.md')
    expect(tabStore.inactiveFiles).toEqual([])
    expect(tabStore.activeTab?.name).toBe('b.md')
  })
  it('restores only bounded body reads even from a legacy unlimited session', async () => {
    tabStore.applyFilePolicy({ maxOpenFiles: 2 })
    await tabStore.restoreSession({ workingDirectory: '/docs', openPaths: ['a', 'b', 'c', 'd'].map(name => `/docs/${name}.md`), activePath: '/docs/d.md' })
    expect(fs.read).toHaveBeenCalledTimes(2)
    expect(tabStore.activeTab?.path).toBe('/docs/d.md')
    expect(tabStore.tabs).toHaveLength(2); expect(tabStore.inactiveFiles).toHaveLength(2)
  })
  it('inactive entries are not restored eagerly or scanned and expired paths are dropped', async () => {
    const now = Date.now()
    await tabStore.restoreSession({ workingDirectory: '/docs', openPaths: [], activePath: null,
      inactiveFiles: [
        { path: '/docs/keep.md', lastAccessedAt: now - DAY_MS, accessCount: 3, inactiveSince: now },
        { path: '/docs/old.md', lastAccessedAt: 0, accessCount: 1, inactiveSince: now - 10 * DAY_MS },
      ],
    })
    await tabStore.refreshFileTree()
    expect(fs.read).not.toHaveBeenCalled(); expect(fs.exists).not.toHaveBeenCalled()
    expect(tabStore.inactiveFiles.map(file => file.path)).toEqual(['/docs/keep.md'])
  })
  it('source read failure during restore keeps a recoverable path and falls back to a loaded document', async () => {
    fs.read.mockImplementation(async (path: string) => { if (path.endsWith('bad.md')) throw new Error('not found'); return '# good' })
    await tabStore.restoreSession({ workingDirectory: '/docs', openPaths: ['/docs/good.md'], activePath: '/docs/bad.md' })
    expect(tabStore.activeTab?.path).toBe('/docs/good.md')
    expect(tabStore.inactiveFiles[0].path).toBe('/docs/bad.md')
  })
  it('normalizes Windows case for inactive activation and avoids duplicate paths', async () => {
    tabStore.applyFilePolicy({ maxOpenFiles: 1 })
    await tabStore.openFile('D:\\Docs\\A.md'); await tabStore.openFile('D:\\Docs\\B.md')
    await tabStore.openFile('d:/docs/a.md')
    expect(tabStore.inactiveFiles.map(file => file.path)).toEqual(['D:/Docs/B.md'])
    await tabStore.openFile('D:/DOCS/A.md')
    expect(tabStore.tabs).toHaveLength(1)
  })
  it('sorting is deterministic and does not reorder actual tab navigation', async () => {
    await open('b'); await open('a')
    const order = tabStore.tabs.map(tab => tab.id)
    tabStore.applyFilePolicy({ openFilesSort: 'name' })
    expect(tabStore.sortedTabs.map(tab => tab.name)).toEqual(['a.md', 'b.md'])
    expect(tabStore.tabs.map(tab => tab.id)).toEqual(order)
    expect(compareFileActivity({ path: 'a', accessCount: 8 }, { path: 'b', accessCount: 2 }, 'frequent')).toBeLessThan(0)
  })
})

describe('safe file policy and session migration', () => {
  it('sanitizes invalid counts, days, types and sort values', () => {
    expect(sanitizeFilePolicy({ maxOpenFiles: -3, inactiveRetentionDays: Infinity, openFilesSort: 'bad' as never }))
      .toEqual({ maxOpenFiles: 1, inactiveRetentionDays: 7, openFilesSort: 'recent' })
    expect(sanitizeFilePolicy({ maxOpenFiles: 999, inactiveRetentionDays: 999 })).toMatchObject({ maxOpenFiles: 200, inactiveRetentionDays: 365 })
    settingsStore.update({ maxOpenFiles: NaN, inactiveRetentionDays: 0 }, { save: false })
    expect(settingsStore.settings).toMatchObject({ maxOpenFiles: 20, inactiveRetentionDays: 1 })
  })
  it('drops malformed metadata and never restores embedded body from cache', () => {
    const result = sanitizeSession({ openPaths: ['a.md', 42], inactiveFiles: [null, { path: 'b.md', content: '# malicious snapshot' }] })
    expect(result.openPaths).toEqual(['a.md'])
    expect(result.inactiveFiles).toHaveLength(1)
    expect(JSON.stringify(result)).not.toContain('content')
  })
})
