import { describe, it, expect } from 'vitest'
import { dirOf, toRelative } from '../../src/components/OpenFilesGroup'

describe('OpenFilesGroup - toRelative', () => {
  it('should strip the working directory prefix (posix)', () => {
    expect(toRelative('/docs/a/b.md', '/docs/a')).toBe('b.md')
  })

  it('should handle backslash paths (windows)', () => {
    expect(toRelative('D:\\proj\\docs\\a.md', 'D:\\proj')).toBe('docs/a.md')
  })

  it('should tolerate a trailing slash in root', () => {
    expect(toRelative('/docs/a/b.md', '/docs/a/')).toBe('b.md')
  })

  it('should be case-insensitive on windows-style roots', () => {
    expect(toRelative('D:\\Proj\\a.md', 'D:\\proj')).toBe('a.md')
  })

  it('should return the original path when outside root', () => {
    expect(toRelative('/other/x.md', '/docs')).toBe('/other/x.md')
  })

  it('should return the original path when root is empty', () => {
    expect(toRelative('/docs/a.md', '')).toBe('/docs/a.md')
  })
})

describe('OpenFilesGroup - dirOf', () => {
  it('should return the directory part', () => {
    expect(dirOf('docs/advanced.md')).toBe('docs')
  })

  it('should return nested directory', () => {
    expect(dirOf('a/b/c.md')).toBe('a/b')
  })

  it('should return empty string for top-level files', () => {
    expect(dirOf('README.md')).toBe('')
  })
})
