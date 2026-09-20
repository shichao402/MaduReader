import { X, FileText } from 'lucide-react'
import { cn } from '../lib/utils'

export interface Tab {
  id: string
  path: string
  name: string
  content: string
  isModified: boolean
  isUntitled: boolean
}

interface TabListProps {
  tabs: Tab[]
  activeTabId: string | null
  onCloseTab: (id: string) => void
  onSetActive: (id: string) => void
}

export default function TabList({
  tabs,
  activeTabId,
  onCloseTab,
  onSetActive,
}: TabListProps) {
  return (
    <div className="flex flex-col gap-1 py-2 max-h-full overflow-y-auto">
      {tabs.map((tab) => (
        <div
          key={tab.id}
          role="button"
          tabIndex={0}
          className={cn(
            'group flex items-center gap-2 px-3 py-2 cursor-pointer text-sm rounded-md transition-colors',
            'text-[color:var(--color-text-primary)] hover:bg-[color:var(--color-sidebar-hover)]',
            activeTabId === tab.id &&
              'bg-[color:var(--color-sidebar-active)] text-[color:var(--color-primary)]',
          )}
          onClick={() => onSetActive(tab.id)}
          onKeyDown={(e) => e.key === 'Enter' && onSetActive(tab.id)}
        >
          <FileText size={14} className="shrink-0 opacity-70" />
          <span className="flex-1 truncate" title={tab.name}>
            {tab.name}
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
      ))}
      {tabs.length === 0 && (
        <p className="px-3 py-6 text-xs text-center text-[color:var(--color-text-tertiary)]">
          尚未打开文件，可从目录中选择
        </p>
      )}
    </div>
  )
}
