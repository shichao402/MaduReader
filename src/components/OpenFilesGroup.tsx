import { useState } from 'react'
import { ChevronDown, ChevronRight, FileText, X } from 'lucide-react'
import { cn } from '../lib/utils'

export interface Tab {
  id: string
  path: string
  name: string
  content: string
  isModified: boolean
  isUntitled: boolean
}

interface OpenFilesGroupProps {
  tabs: Tab[]
  activeTabId: string | null
  workingDirectory: string
  onCloseTab: (id: string) => void
  onSetActive: (id: string) => void
}

/** 把绝对路径转换为相对工作目录的路径，失败时原样返回 */
export function toRelative(path: string, root: string): string {
  const p = path.replace(/\\/g, '/')
  const r = root.replace(/\\/g, '/').replace(/\/+$/, '')
  if (r && p.toLowerCase().startsWith(r.toLowerCase() + '/')) return p.slice(r.length + 1)
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
      <button
        className="flex w-full items-center gap-1.5 px-2 py-1.5 text-xs font-semibold uppercase tracking-wide text-[color:var(--color-text-secondary)] hover:text-[color:var(--color-text-primary)] transition-colors"
        onClick={() => setCollapsed((v) => !v)}
        title={collapsed ? '展开已打开的文件' : '折叠已打开的文件'}
      >
        {collapsed ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
        <span>已打开</span>
        <span className="font-normal normal-case tracking-normal opacity-70">{tabs.length}</span>
      </button>

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
              className={cn(
                'group flex items-center gap-2 py-1.5 pr-2 cursor-pointer text-sm rounded-md transition-colors',
                'text-[color:var(--color-text-primary)] hover:bg-[color:var(--color-sidebar-hover)]',
                activeTabId === tab.id &&
                  'bg-[color:var(--color-sidebar-active)] text-[color:var(--color-primary)]',
              )}
              style={{ paddingLeft: 8 }}
              onClick={() => onSetActive(tab.id)}
              onKeyDown={(e) => e.key === 'Enter' && onSetActive(tab.id)}
            >
              <FileText size={14} className="shrink-0 opacity-70" />
              <span className="flex-1 min-w-0">
                <span className="block truncate" title={tab.path}>
                  {tab.name}
                </span>
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
