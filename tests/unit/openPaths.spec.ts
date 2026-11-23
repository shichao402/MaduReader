import { describe, expect, it, vi } from 'vitest'
import { joinDirectory, noticeForResult, openPaths, parentDirectory, type OpenPathsDependencies } from '../../src/lib/openPaths'

function dependencies(): OpenPathsDependencies {
  return {
    store: { openFile: vi.fn().mockResolvedValue(undefined), setWorkingDirectory: vi.fn(), isVirtualWorkspace: false },
    isDirectory: vi.fn().mockResolvedValue(false),
    readDirectory: vi.fn().mockResolvedValue([]),
  }
}

function entry(name: string, isDirectory = false) {
  return { name, isDirectory, isFile: !isDirectory, isSymlink: false }
}

describe('unified explicit open service', () => {
  it('opens every path in order instead of taking only the first', async () => {
    const deps = dependencies()
    const result = await openPaths(['/notes/a.md', '/notes/b.markdown'], {}, deps)
    expect(result.outcomes).toEqual([{ path: '/notes/a.md', error: null }, { path: '/notes/b.markdown', error: null }])
    expect(deps.store.openFile).toHaveBeenNthCalledWith(1, '/notes/a.md')
    expect(deps.store.openFile).toHaveBeenNthCalledWith(2, '/notes/b.markdown')
  })
  it('continues after one file fails and reports the real error', async () => {
    const deps = dependencies()
    vi.mocked(deps.store.openFile).mockRejectedValueOnce(new Error('permission denied'))
    const result = await openPaths(['/denied.md', '/ok.md'], {}, deps)
    expect(result.outcomes).toEqual([{ path: '/denied.md', error: 'permission denied' }, { path: '/ok.md', error: null }])
    expect(deps.store.setWorkingDirectory).toHaveBeenCalledTimes(1)
  })
  it('does not turn a missing file into success', async () => {
    const deps = dependencies()
    vi.mocked(deps.isDirectory).mockRejectedValue(new Error('path does not exist'))
    const result = await openPaths(['/not-found.md'], {}, deps)
    expect(result.outcomes[0].error).toBe('path does not exist')
    expect(deps.store.openFile).not.toHaveBeenCalled()
    expect(deps.store.setWorkingDirectory).not.toHaveBeenCalled()
  })
  it('opens a directory with a case-insensitive README preference', async () => {
    const deps = dependencies()
    vi.mocked(deps.isDirectory).mockResolvedValue(true)
    vi.mocked(deps.readDirectory).mockResolvedValue([entry('first.md'), entry('README.MARKDOWN'), entry('fake.md', true)])
    expect((await openPaths(['D:\\notes'], {}, deps)).outcomes[0].error).toBeNull()
    expect(deps.store.openFile).toHaveBeenCalledWith('D:\\notes\\README.MARKDOWN')
    expect(deps.store.setWorkingDirectory).toHaveBeenCalledWith('D:\\notes')
  })
  it('an empty directory is a successfully opened workspace', async () => {
    const deps = dependencies()
    vi.mocked(deps.isDirectory).mockResolvedValue(true)
    expect((await openPaths(['/empty'], {}, deps)).outcomes[0].error).toBeNull()
    expect(deps.store.setWorkingDirectory).toHaveBeenCalledWith('/empty')
    expect(deps.store.openFile).not.toHaveBeenCalled()
  })
  it('does not open a directory named like a Markdown file', async () => {
    const deps = dependencies()
    vi.mocked(deps.isDirectory).mockResolvedValue(true)
    vi.mocked(deps.readDirectory).mockResolvedValue([entry('README.md', true), entry('note.MD')])
    await openPaths(['/root'], {}, deps)
    expect(deps.store.openFile).toHaveBeenCalledWith('/root/note.MD')
  })
  it('does not change workspace if directory reading fails', async () => {
    const deps = dependencies()
    vi.mocked(deps.isDirectory).mockResolvedValue(true)
    vi.mocked(deps.readDirectory).mockRejectedValue('cannot read directory')
    expect((await openPaths(['/denied'], {}, deps)).outcomes[0].error).toBe('cannot read directory')
    expect(deps.store.setWorkingDirectory).not.toHaveBeenCalled()
  })
  it('sidebar and palette can keep the existing workspace', async () => {
    const deps = dependencies()
    await openPaths(['/another/file.md'], { updateWorkspace: false }, deps)
    expect(deps.store.openFile).toHaveBeenCalledWith('/another/file.md')
    expect(deps.store.setWorkingDirectory).not.toHaveBeenCalled()
  })
  it('virtual tree files do not probe the native filesystem', async () => {
    const deps = dependencies()
    deps.store.isVirtualWorkspace = true
    await openPaths(['web-demo/a.md'], { updateWorkspace: false }, deps)
    expect(deps.isDirectory).not.toHaveBeenCalled()
    expect(deps.store.openFile).toHaveBeenCalledWith('web-demo/a.md')
  })
  it('reports empty requests and empty paths explicitly', async () => {
    expect((await openPaths([], {}, dependencies())).error).toBeTruthy()
    expect((await openPaths([''], {}, dependencies())).outcomes[0].error).toBe('路径为空')
  })
  it.each([
    ['D:\\file.md', 'D:/'], ['/file.md', '/'],
    ['D:\\notes\\file.md', 'D:/notes'], ['/Notes/file.md', '/Notes'],
    ['\\\\server\\share\\file.md', '//server/share'], ['file.md', ''],
  ])('handles the parent of %s', (path, expected) => {
    expect(parentDirectory(path)).toBe(expected)
  })
  it.each([
    ['D:\\', 'D:\\a.md'], ['/', '/a.md'], ['D:/notes/', 'D:/notes/a.md'],
    ['\\\\server\\share\\', '\\\\server\\share\\a.md'],
  ])('joins directory %s without losing a platform root', (directory, expected) => {
    expect(joinDirectory(directory, 'a.md')).toBe(expected)
  })
  it('creates an error notice with request correlation, not HTML', () => {
    expect(noticeForResult({ error: null, outcomes: [{ path: '<file>', error: '<bad>' }] }, 42)).toEqual({
      title: '无法打开文件或目录', details: '<file>\n<bad>', requestId: 42,
    })
    expect(noticeForResult({ error: null, outcomes: [{ path: 'ok', error: null }] })).toBeNull()
  })
})
