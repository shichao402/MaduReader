import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import FileContextMenu from '../../src/components/FileContextMenu'
import FileTree, { type FileNode } from '../../src/components/FileTree'
import OpenFilesGroup, { type Tab } from '../../src/components/OpenFilesGroup'
import { copyText } from '../../src/lib/clipboard'

const ROOT = 'D:/workspace/PersonalDevDocs'
const CURRENT = `${ROOT}/当前文档.md`
const OTHER = `${ROOT}/英雄设计/鼠标所在文档.md`
const nodes: FileNode[] = [{
  name: '英雄设计', path: `${ROOT}/英雄设计`, isDir: true, expanded: true,
  children: [{ name: '鼠标所在文档.md', path: OTHER, isDir: false, expanded: false, children: [] }],
}]
const tabs: Tab[] = [
  { id: 'current', name: '当前文档.md', path: CURRENT, content: '', isModified: false, isUntitled: false },
  { id: 'untitled', name: '未命名', path: 'untitled-1', content: '', isModified: false, isUntitled: true },
]
let container: HTMLDivElement
let root: Root
let writeText: ReturnType<typeof vi.fn>
let onOpen: ReturnType<typeof vi.fn>
let onToggle: ReturnType<typeof vi.fn>
let clipboardDescriptor: PropertyDescriptor | undefined
let execDescriptor: PropertyDescriptor | undefined

function render(workingDirectory = ROOT) {
  act(() => root.render(createElement(FileContextMenu, { workingDirectory, onOpenFile: onOpen },
    createElement(OpenFilesGroup, { tabs, activeTabId: 'current', workingDirectory, onCloseTab: vi.fn(), onSetActive: vi.fn() }),
    createElement(FileTree, { nodes, activePath: CURRENT, onOpenFile: onOpen, onToggleNode: onToggle }),
  )))
}
function item(path = OTHER): HTMLElement {
  return Array.from(container.querySelectorAll<HTMLElement>('[data-file-path]')).find(el => el.dataset.filePath === path)!
}
function open(target = item(), x = 100, y = 100) {
  const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 2 })
  act(() => target.dispatchEvent(event))
  return event
}
function menu(): HTMLElement | null { return document.querySelector('[role="menu"]') }
function action(label: string): HTMLButtonElement {
  return Array.from(menu()!.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')).find(el => el.textContent === label)!
}
async function choose(label: string) {
  await act(async () => { action(label).click(); await Promise.resolve() })
}
function key(target: HTMLElement, key: string, shiftKey = false) {
  const event = new KeyboardEvent('keydown', { key, shiftKey, bubbles: true, cancelable: true })
  act(() => target.dispatchEvent(event))
  return event
}

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  clipboardDescriptor = Object.getOwnPropertyDescriptor(navigator, 'clipboard')
  execDescriptor = Object.getOwnPropertyDescriptor(document, 'execCommand')
  writeText = vi.fn().mockResolvedValue(undefined)
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
  Object.defineProperty(document, 'execCommand', { value: vi.fn().mockReturnValue(false), configurable: true })
  onOpen = vi.fn()
  onToggle = vi.fn()
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  render()
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  if (clipboardDescriptor) Object.defineProperty(navigator, 'clipboard', clipboardDescriptor)
  else Reflect.deleteProperty(navigator, 'clipboard')
  if (execDescriptor) Object.defineProperty(document, 'execCommand', execDescriptor)
  else Reflect.deleteProperty(document, 'execCommand')
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  expect(menu()).toBeNull()
})

describe('file context menu', () => {
  it('右键非活动文件时阻止默认菜单，复制鼠标所在行的完整路径而非当前文档', async () => {
    expect(open().defaultPrevented).toBe(true)
    expect(onOpen).not.toHaveBeenCalled()
    expect(menu()?.getAttribute('aria-label')).toContain('鼠标所在文档.md')
    expect(document.activeElement).toBe(action('复制完整路径'))
    await choose('复制完整路径')
    expect(writeText).toHaveBeenCalledWith(OTHER)
    expect(writeText).not.toHaveBeenCalledWith(CURRENT)
    expect(menu()).toBeNull()
    expect(document.querySelector('[role="status"]')?.textContent).toBe('已复制完整路径')
  })

  it.each([
    ['复制相对路径', '英雄设计/鼠标所在文档.md'],
    ['复制文件名', '鼠标所在文档.md'],
  ])('%s 复制正确内容', async (label, expected) => {
    open()
    await choose(label)
    expect(writeText).toHaveBeenCalledWith(expected)
  })

  it('已打开分组中的文件也支持复制路径', async () => {
    open(item(CURRENT))
    await choose('复制完整路径')
    expect(writeText).toHaveBeenCalledWith(CURRENT)
  })

  it('文件夹支持复制，右键不会展开目录，也不会提供打开文件动作', async () => {
    open(item(`${ROOT}/英雄设计`))
    expect(onToggle).not.toHaveBeenCalled()
    expect(action('打开文件')).toBeUndefined()
    await choose('复制文件夹名')
    expect(writeText).toHaveBeenCalledWith('英雄设计')
  })

  it('打开文件动作使用右键目标且关闭菜单', async () => {
    open()
    await choose('打开文件')
    expect(onOpen).toHaveBeenCalledWith(OTHER)
    expect(menu()).toBeNull()
  })

  it('空白区域和未命名文档保留默认菜单，不伪造文件路径', () => {
    expect(open(container).defaultPrevented).toBe(false)
    const untitled = Array.from(container.querySelectorAll<HTMLElement>('[role="button"]')).find(el => el.textContent?.includes('未命名'))!
    expect(open(untitled).defaultPrevented).toBe(false)
    expect(menu()).toBeNull()
  })

  it('不在工作目录内的文件不能把绝对路径冒充相对路径', () => {
    render('D:/other-root')
    open()
    expect(action('复制相对路径').disabled).toBe(true)
  })

  it('支持 Shift+F10、方向键循环、Home/End 和 Esc 返回原条目焦点', () => {
    item().focus()
    expect(key(item(), 'F10', true).defaultPrevented).toBe(true)
    key(menu()!, 'End')
    expect(document.activeElement).toBe(action('打开文件'))
    key(menu()!, 'ArrowDown')
    expect(document.activeElement).toBe(action('复制完整路径'))
    key(menu()!, 'ArrowUp')
    expect(document.activeElement).toBe(action('打开文件'))
    key(menu()!, 'Home')
    expect(document.activeElement).toBe(action('复制完整路径'))
    expect(key(menu()!, 'Escape').defaultPrevented).toBe(true)
    expect(menu()).toBeNull()
    expect(document.activeElement).toBe(item())
  })

  it('屏幕右下角的菜单根据真实尺寸回退到屏幕内', () => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(() => ({
      x: 0, y: 0, left: 0, top: 0, right: 250, bottom: 220, width: 250, height: 220, toJSON: () => ({}),
    }))
    open(item(), window.innerWidth - 1, window.innerHeight - 1)
    expect(menu()!.style.left).toBe(`${window.innerWidth - 258}px`)
    expect(menu()!.style.top).toBe(`${window.innerHeight - 228}px`)
  })

  it.each(['pointerdown', 'scroll', 'resize', 'blur'])('%s 关闭菜单', type => {
    open()
    act(() => {
      if (type === 'resize' || type === 'blur') window.dispatchEvent(new Event(type))
      else document.body.dispatchEvent(new Event(type, { bubbles: true }))
    })
    expect(menu()).toBeNull()
  })

  it('更换工作目录时关闭旧菜单', () => {
    open()
    render('D:/new-workspace')
    expect(menu()).toBeNull()
  })

  it('剪贴板失败显示失败信息，不声称成功', async () => {
    writeText.mockRejectedValue(new Error('denied'))
    open()
    await choose('复制完整路径')
    expect(document.querySelector('[role="status"]')?.textContent).toContain('复制失败')
  })
})

describe('clipboard fallback', () => {
  it('没有 Clipboard API 时使用临时 textarea，复制原路径并恢复焦点和清理节点', async () => {
    Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true })
    item().focus()
    const exec = vi.fn().mockImplementation(() => {
      expect(document.querySelector('textarea')?.value).toBe('D:\\中文目录\\文件.md')
      return true
    })
    Object.defineProperty(document, 'execCommand', { value: exec, configurable: true })
    await copyText('D:\\中文目录\\文件.md')
    expect(exec).toHaveBeenCalledWith('copy')
    expect(document.querySelector('textarea')).toBeNull()
    expect(document.activeElement).toBe(item())
  })

  it('Clipboard API 拒绝时可回退；两条路径均失败时抛错并清理', async () => {
    writeText.mockRejectedValue(new Error('denied'))
    Object.defineProperty(document, 'execCommand', { value: vi.fn().mockReturnValue(true), configurable: true })
    await expect(copyText(OTHER)).resolves.toBeUndefined()
    Object.defineProperty(document, 'execCommand', { value: vi.fn().mockReturnValue(false), configurable: true })
    await expect(copyText(OTHER)).rejects.toThrow('Clipboard write failed')
    expect(document.querySelector('textarea')).toBeNull()
  })
})
