import { act, createElement, createRef } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import SelectionContextMenu from '../../src/components/SelectionContextMenu'

const ROOT = 'D:/workspace/MaduReader'
const PATH = `${ROOT}/docs/guide.md`
let container: HTMLDivElement
let root: Root
let writeText: ReturnType<typeof vi.fn>
let contentRef: ReturnType<typeof createRef<HTMLDivElement>>
let clipboardDescriptor: PropertyDescriptor | undefined

function render(documentPath = PATH, workingDirectory = ROOT) {
  act(() => root.render(createElement(
    SelectionContextMenu,
    { documentPath, workingDirectory, contentRef },
    createElement('div', { ref: contentRef },
      createElement('p', { 'data-source-line': '3', 'data-source-line-end': '5' }, '第一段跨三行'),
      createElement('p', { 'data-source-line': '8', 'data-source-line-end': '8' }, '第二段'),
      createElement('p', null, '没有映射'),
    ),
  )))
}

function select(start: Node, end = start) {
  const range = document.createRange()
  range.setStart(start, 0)
  range.setEnd(end, end.textContent?.length ?? 0)
  const selection = window.getSelection()!
  selection.removeAllRanges()
  selection.addRange(range)
}

function open(target: Element) {
  const event = new MouseEvent('contextmenu', {
    bubbles: true, cancelable: true, clientX: 120, clientY: 140, button: 2,
  })
  act(() => target.dispatchEvent(event))
  return event
}

function action(label: string): HTMLButtonElement {
  return Array.from(document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'))
    .find(button => button.textContent === label)!
}

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  clipboardDescriptor = Object.getOwnPropertyDescriptor(navigator, 'clipboard')
  writeText = vi.fn().mockResolvedValue(undefined)
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  contentRef = createRef<HTMLDivElement>()
  render()
})

afterEach(() => {
  act(() => root.unmount())
  window.getSelection()?.removeAllRanges()
  container.remove()
  document.querySelectorAll('[role="menu"], [role="status"]').forEach(el => el.remove())
  if (clipboardDescriptor) Object.defineProperty(navigator, 'clipboard', clipboardDescriptor)
  else Reflect.deleteProperty(navigator, 'clipboard')
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('selection context menu', () => {
  it('单个多行块复制相对路径和完整源码块范围', async () => {
    const paragraph = contentRef.current!.children[0]
    select(paragraph.firstChild!)
    expect(open(paragraph).defaultPrevented).toBe(true)
    expect(document.querySelector('.file-context-menu-title')?.textContent).toContain('docs/guide.md:3-5')
    await act(async () => { action('复制引用（路径:行号）').click(); await Promise.resolve() })
    expect(writeText).toHaveBeenCalledWith('docs/guide.md:3-5')
    expect(document.querySelector('[role="status"]')?.textContent).toBe('已复制引用')
  })

  it('跨块选择使用首块起始行到末块结束行', async () => {
    const first = contentRef.current!.children[0]
    const second = contentRef.current!.children[1]
    select(first.firstChild!, second.firstChild!)
    open(first)
    await act(async () => { action('复制引用（路径:行号）').click(); await Promise.resolve() })
    expect(writeText).toHaveBeenCalledWith('docs/guide.md:3-8')
  })

  it('工作目录不匹配时保留绝对路径', async () => {
    render(PATH, 'D:/other')
    const paragraph = contentRef.current!.children[1]
    select(paragraph.firstChild!)
    open(paragraph)
    await act(async () => { action('复制引用（路径:行号）').click(); await Promise.resolve() })
    expect(writeText).toHaveBeenCalledWith('D:/workspace/MaduReader/docs/guide.md:8')
  })

  it('没有选区时保留系统默认右键菜单', () => {
    const paragraph = contentRef.current!.children[0]
    window.getSelection()?.removeAllRanges()
    expect(open(paragraph).defaultPrevented).toBe(false)
    expect(document.querySelector('[role="menu"]')).toBeNull()
  })

  it('无源码映射时仍可复制选中文本，但引用动作禁用', async () => {
    const paragraph = contentRef.current!.children[2]
    select(paragraph.firstChild!)
    open(paragraph)
    expect(action('复制引用（路径:行号）').disabled).toBe(true)
    await act(async () => { action('复制选中文本').click(); await Promise.resolve() })
    expect(writeText).toHaveBeenCalledWith('没有映射')
  })

  it('选区不在正文根节点时不接管右键', () => {
    const outside = document.createElement('p')
    outside.textContent = '外部文本'
    document.body.appendChild(outside)
    select(outside.firstChild!)
    expect(open(contentRef.current!.children[0]).defaultPrevented).toBe(false)
    outside.remove()
  })
})
