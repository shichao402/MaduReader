import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Copy, FileText, FolderOpen, Link, Type } from 'lucide-react'
import { copyText } from '../lib/clipboard'
import { toRelative } from './OpenFilesGroup'

interface MenuTarget {
  path: string
  name: string
  isDir: boolean
  x: number
  y: number
  trigger: HTMLElement
}

interface FileContextMenuProps {
  children: ReactNode
  className?: string
  workingDirectory: string
  onOpenFile: (path: string) => void
}

/** 一个侧栏共用一个菜单；复制目标取自右键行，不依赖当前打开的文件。 */
export default function FileContextMenu({
  children,
  className,
  workingDirectory,
  onOpenFile,
}: FileContextMenuProps) {
  const [target, setTarget] = useState<MenuTarget | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  function close(restoreFocus = false) {
    if (restoreFocus && target?.trigger.isConnected) target.trigger.focus({ preventScroll: true })
    setTarget(null)
  }

  function show(eventTarget: EventTarget | null, owner: HTMLElement, x?: number, y?: number): boolean {
    if (!(eventTarget instanceof Element)) return false
    const item = eventTarget.closest<HTMLElement>('[data-file-path]')
    const path = item?.dataset.filePath
    if (!item || !path || !owner.contains(item)) return false
    const rect = item.getBoundingClientRect()
    setNotice(null)
    setTarget({
      path,
      name: item.dataset.fileName || path.split(/[\\/]/).pop() || path,
      isDir: item.dataset.fileIsDir === 'true',
      x: x ?? rect.left + 16,
      y: y ?? rect.bottom,
      trigger: item,
    })
    return true
  }

  useEffect(() => {
    setTarget(null)
    setNotice(null)
  }, [workingDirectory])

  useLayoutEffect(() => {
    const menu = menuRef.current
    if (!target || !menu) return
    // Portal 脱离侧栏裁切；根据实际菜单尺寸处理屏幕四边。
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
    close(true)
    try {
      await copyText(value)
      setNotice(`已复制${label}`)
    } catch {
      setNotice('复制失败，请重试或检查剪贴板权限')
    }
  }

  const relative = target ? toRelative(target.path, workingDirectory) : ''
  const canCopyRelative = Boolean(workingDirectory && target && relative !== target.path.replace(/\\/g, '/'))

  return (
    <div
      className={className}
      onContextMenu={(event) => {
        if (!show(event.target, event.currentTarget, event.clientX || undefined, event.clientY || undefined)) return
        event.preventDefault()
        event.stopPropagation()
      }}
      onKeyDown={(event) => {
        if (event.key !== 'ContextMenu' && !(event.key === 'F10' && event.shiftKey)) return
        if (!show(event.target, event.currentTarget)) return
        event.preventDefault()
        event.stopPropagation()
      }}
    >
      {children}
      {target && createPortal(
        <div
          ref={menuRef}
          role="menu"
          aria-label={`${target.name} 的右键菜单`}
          className="file-context-menu"
          style={{ left: target.x, top: target.y }}
          onContextMenu={(event) => { event.preventDefault(); event.stopPropagation() }}
          onKeyDown={(event) => {
            event.stopPropagation()
            if (event.key === 'Escape' || event.key === 'Tab') {
              if (event.key === 'Escape') event.preventDefault()
              close(true)
              return
            }
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
          <div className="file-context-menu-title" title={target.path}>
            {target.isDir ? <FolderOpen size={14} /> : <FileText size={14} />}
            <span>{target.name}</span>
          </div>
          <button type="button" role="menuitem" onClick={() => void copy(target.path, '完整路径')}>
            <Copy size={15} />复制完整路径
          </button>
          <button type="button" role="menuitem" disabled={!canCopyRelative} onClick={() => void copy(relative, '相对路径')}>
            <Link size={15} />复制相对路径
          </button>
          <button type="button" role="menuitem" onClick={() => void copy(target.name, target.isDir ? '文件夹名' : '文件名')}>
            <Type size={15} />{target.isDir ? '复制文件夹名' : '复制文件名'}
          </button>
          {!target.isDir && <>
            <div role="separator" className="file-context-menu-separator" />
            <button type="button" role="menuitem" onClick={() => { const path = target.path; close(true); onOpenFile(path) }}>
              <FileText size={15} />打开文件
            </button>
          </>}
        </div>,
        document.body,
      )}
      {notice && createPortal(<div role="status" className="file-action-notice">{notice}</div>, document.body)}
    </div>
  )
}
