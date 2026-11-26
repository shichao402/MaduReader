import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Copy, Quote } from 'lucide-react'
import { copyText } from '../lib/clipboard'
import { toRelative } from './OpenFilesGroup'

interface SelectionTarget {
  reference: string
  text: string
  x: number
  y: number
}

interface SelectionContextMenuProps {
  children: ReactNode
  className?: string
  /** 当前正在阅读的文件绝对路径；无路径（如虚拟工作区）时退化为仅复制文本 */
  documentPath: string
  /** 工作目录，用于把绝对路径转相对路径，跟随文件右键菜单的逻辑 */
  workingDirectory: string
  /** 正文内容根节点，用于约束选区必须落在正文内 */
  contentRef: React.RefObject<HTMLElement | null>
}

/** 取节点最近的带源码映射祖先块的 1-based 包含式起止行。 */
function sourceSpanOf(node: Node | null, root: HTMLElement): { start: number; end: number } | null {
  let el: Element | null = node instanceof Element ? node : node?.parentElement ?? null
  while (el && root.contains(el)) {
    const rawStart = el.getAttribute('data-source-line')
    const rawEnd = el.getAttribute('data-source-line-end')
    if (rawStart) {
      const start = Number(rawStart)
      const end = Number(rawEnd || rawStart)
      if (Number.isFinite(start) && start > 0 && Number.isFinite(end) && end >= start) {
        return { start, end }
      }
    }
    el = el.parentElement
  }
  return null
}

/** 把绝对路径按工作目录转为引用用路径（有工作目录则相对，否则原样绝对），统一用正斜杠 */
function referencePath(documentPath: string, workingDirectory: string): string {
  const rel = workingDirectory ? toRelative(documentPath, workingDirectory) : documentPath
  return rel.replace(/\\/g, '/')
}

/**
 * 从当前选区推导 agent 友好的引用串：`路径:起始行` 或 `路径:起始行-结束行`。
 * 行号取选区首尾落点最近祖先块的源码行号；取不到行号或无路径时退化为仅路径或仅文本。
 */
function buildReference(
  selection: Selection,
  root: HTMLElement,
  documentPath: string,
  workingDirectory: string,
): { reference: string; text: string } | null {
  if (selection.rangeCount === 0) return null
  const text = selection.toString().trim()
  if (!text) return null
  const range = selection.getRangeAt(0)
  if (!root.contains(range.commonAncestorContainer)) return null

  const path = documentPath ? referencePath(documentPath, workingDirectory) : ''
  const startSpan = sourceSpanOf(range.startContainer, root)
  const endSpan = sourceSpanOf(range.endContainer, root)

  let reference = ''
  if (path && startSpan) {
    const lo = Math.min(startSpan.start, endSpan?.start ?? startSpan.start)
    const hi = Math.max(startSpan.end, endSpan?.end ?? startSpan.end)
    reference = lo === hi ? `${path}:${lo}` : `${path}:${lo}-${hi}`
  }
  return { reference, text }
}

/** 正文选区右键菜单：框选文字后右键，复制为 agent 可识别的「路径:行号」引用。 */
export default function SelectionContextMenu({
  children,
  className,
  documentPath,
  workingDirectory,
  contentRef,
}: SelectionContextMenuProps) {
  const [target, setTarget] = useState<SelectionTarget | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    const menu = menuRef.current
    if (!target || !menu) return
    const rect = menu.getBoundingClientRect()
    menu.style.left = `${Math.max(8, Math.min(target.x, window.innerWidth - rect.width - 8))}px`
    menu.style.top = `${Math.max(8, Math.min(target.y, window.innerHeight - rect.height - 8))}px`
    menu.querySelector<HTMLButtonElement>('[role="menuitem"]:not(:disabled)')?.focus()
  }, [target])

  useEffect(() => {
    if (!target) return
    const onOutside = (event: Event) => {
      if (event.target instanceof Node && menuRef.current?.contains(event.target)) return
      setTarget(null)
    }
    const dismiss = () => setTarget(null)
    document.addEventListener('pointerdown', onOutside, true)
    document.addEventListener('scroll', onOutside, true)
    window.addEventListener('resize', dismiss)
    window.addEventListener('blur', dismiss)
    return () => {
      document.removeEventListener('pointerdown', onOutside, true)
      document.removeEventListener('scroll', onOutside, true)
      window.removeEventListener('resize', dismiss)
      window.removeEventListener('blur', dismiss)
    }
  }, [target])

  useEffect(() => {
    if (!notice) return
    const timeout = window.setTimeout(() => setNotice(null), 2400)
    return () => window.clearTimeout(timeout)
  }, [notice])

  async function copy(value: string, label: string) {
    setTarget(null)
    try {
      await copyText(value)
      setNotice(`已复制${label}`)
    } catch {
      setNotice('复制失败，请重试或检查剪贴板权限')
    }
  }

  function onContextMenu(event: React.MouseEvent) {
    const root = contentRef.current
    const selection = window.getSelection()
    if (!root || !selection) return
    const built = buildReference(selection, root, documentPath, workingDirectory)
    if (!built) return
    event.preventDefault()
    event.stopPropagation()
    setNotice(null)
    setTarget({ ...built, x: event.clientX, y: event.clientY })
  }

  const hasReference = Boolean(target && target.reference)

  return (
    <div className={className} onContextMenu={onContextMenu}>
      {children}
      {target && createPortal(
        <div
          ref={menuRef}
          role="menu"
          aria-label="选中文本的右键菜单"
          className="file-context-menu"
          style={{ left: target.x, top: target.y }}
          onContextMenu={(event) => { event.preventDefault(); event.stopPropagation() }}
          onKeyDown={(event) => {
            event.stopPropagation()
            if (event.key === 'Escape') { event.preventDefault(); setTarget(null); return }
            const items = Array.from(menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)') || [])
            const index = items.indexOf(document.activeElement as HTMLButtonElement)
            let next: number
            if (event.key === 'ArrowDown') next = (index + 1) % items.length
            else if (event.key === 'ArrowUp') next = (index - 1 + items.length) % items.length
            else if (event.key === 'Home') next = 0
            else if (event.key === 'End') next = items.length - 1
            else return
            event.preventDefault()
            items[next]?.focus()
          }}
        >
          <div className="file-context-menu-title" title={hasReference ? target.reference : '未定位到源文件行号'}>
            <Quote size={14} />
            <span>{hasReference ? target.reference : '引用选中内容'}</span>
          </div>
          <button
            type="button"
            role="menuitem"
            disabled={!hasReference}
            onClick={() => void copy(target.reference, '引用')}
          >
            <Copy size={15} />复制引用（路径:行号）
          </button>
          <button type="button" role="menuitem" onClick={() => void copy(target.text, '选中文本')}>
            <Copy size={15} />复制选中文本
          </button>
        </div>,
        document.body,
      )}
      {notice && createPortal(<div role="status" className="file-action-notice">{notice}</div>, document.body)}
    </div>
  )
}
