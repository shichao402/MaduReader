import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import OpenFilesGroup, { toRelative, type Tab } from '../../src/components/OpenFilesGroup'
import Sidebar from '../../src/components/Sidebar'

const noop = () => {}
const tab: Tab = {
  id: 'keep', path: '/notes/readme.md', name: 'readme.md', content: '# retained snapshot',
  isModified: false, isUntitled: false,
}

function opened(tabs: Tab[]) {
  return renderToStaticMarkup(createElement(OpenFilesGroup, {
    tabs, activeTabId: 'keep', workingDirectory: '/notes', onCloseTab: noop, onSetActive: noop,
  }))
}

function sidebar(directoryError: string | null, view: 'tree' | 'outline' = 'tree') {
  return renderToStaticMarkup(createElement(Sidebar, {
    view, fileTree: [], tabs: [tab], activeTabId: 'keep', workingDirectory: '/notes',
    activePath: tab.path, directoryError, sidebarPosition: 'left', sidebarWidth: 280,
    onSidebarWidthChange: noop, onViewChange: noop, onCollapse: noop, onTogglePosition: noop,
    onRefreshTree: noop, onOpenFile: noop, onToggleNode: noop, onCloseTab: noop, onSetActiveTab: noop,
  }))
}

describe('directory sync UI', () => {
  it('shows missing source while keeping the tab usable', () => {
    const html = opened([{ ...tab, sourceMissing: true }])
    expect(html).toContain('文件已移动或删除')
    expect(html).toContain('当前保留已打开的内容快照')
    expect(html).toContain('readme.md')
    expect(html).toContain('role="button"')
  })
  it('does not warn about ordinary or restored sources', () => {
    expect(opened([tab, { ...tab, id: 'ok', sourceMissing: false }])).not.toContain('文件已移动或删除')
  })
  it('preserves the unsaved marker on a missing source', () => {
    expect(opened([{ ...tab, sourceMissing: true, isModified: true }])).toContain('未保存')
  })
  it('reports unavailable root and retains the opened group', () => {
    const html = sidebar('无法读取目录：path does not exist')
    expect(html).toContain('role="status"')
    expect(html).toContain('目录暂不可用或部分内容读取失败')
    expect(html).toContain('目录恢复后自动重试')
    expect(html).toContain('readme.md')
  })
  it('does not report an error after recovery', () => {
    expect(sidebar(null)).not.toContain('目录暂不可用')
  })
  it('does not insert directory errors into the document outline', () => {
    expect(sidebar('permission denied', 'outline')).not.toContain('目录暂不可用')
  })
  it('escapes error details instead of treating them as markup', () => {
    expect(sidebar('<script>bad</script>')).toContain('&lt;script&gt;bad&lt;/script&gt;')
  })
})

describe('platform-relative source labels', () => {
  it('respects case-sensitive POSIX roots', () => {
    expect(toRelative('/Notes/a.md', '/notes')).toBe('/Notes/a.md')
  })
  it('handles the POSIX root', () => {
    expect(toRelative('/docs/a.md', '/')).toBe('docs/a.md')
  })
  it('handles the Windows drive root', () => {
    expect(toRelative('D:\\docs\\a.md', 'd:\\')).toBe('docs/a.md')
  })
  it('keeps UNC roots usable', () => {
    expect(toRelative('\\\\server\\Share\\docs\\a.md', '\\\\SERVER\\share')).toBe('docs/a.md')
  })
  it('does not accept a prefix that is only a sibling name', () => {
    expect(toRelative('/notes2/a.md', '/notes')).toBe('/notes2/a.md')
  })
})
