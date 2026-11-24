import { useState } from 'react'
import { ChevronDown, ChevronRight, FileText, X } from 'lucide-react'
import { cn } from '../lib/utils'
import type { OpenFilesSort } from '../lib/fileActivity'

export interface Tab {
  id: string
  path: string
  name: string
  content: string
  isModified: boolean
  isUntitled: boolean
  sourceMissing?: boolean
}

interface OpenFilesGroupProps {
  tabs: Array<Pick<Tab, 'id' | 'path' | 'name'> & Partial<Pick<Tab, 'isModified' | 'isUntitled' | 'sourceMissing'>>>
  label?: string
  inactive?: boolean
  sort?: OpenFilesSort
  onSortChange?: (sort: OpenFilesSort) => void
  activeTabId: string | null
  workingDirectory: string
  onCloseTab: (id: string) => void
  onSetActive: (id: string) => void
}

/** 把绝对路径转换为相对工作目录的路径，失败时原样返回 */
export function toRelative(path: string, root: string): string {
  const p = path.replace(/\\/g, '/')
  const slashedRoot = root.replace(/\\/g, '/')
  const r = slashedRoot === '/' ? '/' : slashedRoot.replace(/\/+$/, '')
  const prefix = r === '/' ? '/' : `${r}/`
  const windowsRoot = /^[a-z]:\//i.test(slashedRoot) || r.startsWith('//')
  const matches = windowsRoot
    ? p.toLowerCase().startsWith(prefix.toLowerCase())
    : p.startsWith(prefix)

  if (r && matches) return p.slice(prefix.length)
  return p
}

/** 取相对路径中的目录部分，顶层文件返回空串 */
export function dirOf(rel: string): string {
  const i = rel.lastIndexOf('/')
  return i === -1 ? '' : rel.slice(0, i)
}

/** 目录视图顶部的「已打开」可折叠分组，替代原先独立的页签视图 */
export default function OpenFilesGroup({
  tabs,
  activeTabId,
  workingDirectory,
  onCloseTab,
  onSetActive,
  label = '已打开',
  inactive = false,
  sort = 'recent',
  onSortChange,
}: OpenFilesGroupProps) {
  const [collapsed, setCollapsed] = useState(false)

  if (tabs.length === 0) return null

  // 仅当文件名重名时才展示所属目录，避免无谓的视觉噪音
  const dupNames = new Set<string>()
  const seen = new Set<string>()
  for (const t of tabs) {
    if (seen.has(t.name)) dupNames.add(t.name)
    seen.add(t.name)
  }

  return (
    <div className="pb-1 mb-1 border-b border-[color:var(--color-border-base)]">
      <div className="flex items-center pr-2">
      <button
        className="flex min-w-0 flex-1 items-center gap-1.5 px-2 py-1.5 text-xs font-semibold uppercase tracking-wide text-[color:var(--color-text-secondary)] hover:text-[color:var(--color-text-primary)] transition-colors"
        onClick={() => setCollapsed((v) => !v)}
        aria-expanded={!collapsed}
        title={collapsed ? `展开${label}的文件` : `折叠${label}的文件`}
      >
        {collapsed ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
        <span>{label}</span>
        <span className="font-normal normal-case tracking-normal opacity-70">{tabs.length}</span>
      </button>
      {onSortChange && <select
        aria-label="已打开文件排序"
        title="排序仅调整列表，超出上限时仍优先休眠最近最少使用的文件"
        className="max-w-[90px] rounded border border-[color:var(--color-border-base)] bg-[color:var(--color-sidebar)] px-1 py-0.5 text-[11px] text-[color:var(--color-text-secondary)]"
        value={sort}
        onChange={event => onSortChange(event.target.value as OpenFilesSort)}
      >
        <option value="recent">最近阅读</option>
        <option value="frequent">常用优先</option>
        <option value="name">文件名</option>
      </select>}
      </div>
      {inactive && !collapsed && <p className="px-2 pb-1 text-[11px] text-[color:var(--color-text-tertiary)]">仅保留路径，点击重新读取</p>}

      {!collapsed && (
        <div className="flex flex-col gap-0.5">
          {tabs.map((tab) => {
            const rel = toRelative(tab.path, workingDirectory)
            // 重名时顶层文件也要有标识，否则与带副标题的条目行高不一致且含义含糊
            const sub = dupNames.has(tab.name) ? dirOf(rel) || '.' : ''
            return (
            <div
              key={tab.id}
              role="button"
              tabIndex={0}
              data-file-path={tab.isUntitled ? undefined : tab.path}
              data-file-name={tab.name}
              data-file-is-dir="false"
              className={cn(
                'group flex items-center gap-2 py-1.5 pr-2 cursor-pointer text-sm rounded-md transition-colors',
                'text-[color:var(--color-text-primary)] hover:bg-[color:var(--color-sidebar-hover)]',
                activeTabId === tab.id &&
                  'bg-[color:var(--color-sidebar-active)] text-[color:var(--color-primary)]',
              )}
              style={{ paddingLeft: 8 }}
              onClick={() => onSetActive(tab.id)}
              onKeyDown={(e) => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); onSetActive(tab.id) } }}
            >
              <FileText size={14} className="shrink-0 opacity-70" />
              <span className="flex-1 min-w-0">
                <span className="block truncate" title={tab.path}>
                  {tab.name}
                </span>
                {tab.sourceMissing && (
                  <span
                    className="block text-[11px] leading-tight text-[color:var(--color-text-secondary)]"
                    title="源文件已移动或删除，当前保留已打开的内容快照"
                  >
                    文件已移动或删除
                  </span>
                )}
                {sub && (
                  <span
                    className="block truncate text-[11px] leading-tight opacity-60"
                    title={rel}
                  >
                    {sub}
                  </span>
                )}
              </span>
              {tab.isModified && (
                <span
                  className="w-2 h-2 rounded-full bg-[color:var(--color-warning)] shrink-0"
                  title="未保存"
                />
              )}
              <button
                className={cn(
                  'w-5 h-5 flex items-center justify-center rounded transition-opacity',
                  'text-[color:var(--color-text-secondary)] hover:bg-[color:var(--color-danger-bg)] hover:text-[color:var(--color-danger)]',
                  'opacity-0 group-hover:opacity-100',
                  activeTabId === tab.id && 'opacity-100',
                )}
                onMouseDown={(e) => e.preventDefault()}
                onClick={(e) => {
                  e.stopPropagation()
                  onCloseTab(tab.id)
                }}
                title="关闭"
              >
                <X size={13} />
              </button>
            </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
