import {
  PanelLeftClose,
  PanelLeftOpen,
  ArrowLeftRight,
  RefreshCw,
  Folder,
  FileStack,
  ListTree,
} from 'lucide-react'
import { cn } from '../lib/utils'
import FileTree, { type FileNode } from './FileTree'
import TabList, { type Tab } from './TabList'

export interface Heading {
  level: number
  text: string
}

/** 从 Markdown 源码提取标题大纲（跳过代码围栏内的 # 行），供侧边栏大纲视图与命令面板共用 */
export function extractHeadings(source: string): Heading[] {
  const headings: Heading[] = []
  let inFence = false
  for (const line of source.split(/\r?\n/)) {
    const fence = line.match(/^\s*(`{3,}|~{3,})/)
    if (fence) {
      inFence = !inFence
      continue
    }
    if (!inFence) {
      const m = line.match(/^(#{1,6})\s+(.+?)\s*#*\s*$/)
      if (m) headings.push({ level: m[1].length, text: m[2] })
    }
  }
  return headings
}

type SidebarView = 'tree' | 'tabs' | 'outline'

interface SidebarProps {
  view: SidebarView
  fileTree: FileNode[]
  tabs: Tab[]
  activeTabId: string | null
  workingDirectory: string
  activePath: string | null
  sidebarPosition: 'left' | 'right'
  onViewChange: (view: SidebarView) => void
  onCollapse: () => void
  onTogglePosition: () => void
  onRefreshTree: () => void
  onOpenFile: (path: string) => void
  onToggleNode: (path: string) => void
  onCloseTab: (id: string) => void
  onSetActiveTab: (id: string) => void
}

function OutlineList({ source }: { source: string }) {
  const headings = extractHeadings(source)
  if (headings.length === 0) {
    return (
      <p className="px-3 py-6 text-xs text-center text-[color:var(--color-text-tertiary)]">
        打开文件后可在此查看大纲
      </p>
    )
  }
  return (
    <div className="py-2">
      {headings.map((h, i) => (
        <button
          key={`${i}-${h.text}`}
          className="flex w-full items-center rounded-md py-1.5 pr-3 text-left text-sm text-[color:var(--color-text-primary)] hover:bg-[color:var(--color-sidebar-hover)] transition-colors"
          style={{ paddingLeft: 12 + (h.level - 1) * 12 }}
          onClick={() =>
            window.dispatchEvent(
              new CustomEvent('scroll-to-heading', { detail: { index: i, text: h.text } }),
            )
          }
        >
          <span className="truncate">{h.text}</span>
        </button>
      ))}
    </div>
  )
}

export default function Sidebar({
  view,
  fileTree,
  tabs,
  activeTabId,
  activePath,
  workingDirectory,
  sidebarPosition,
  onViewChange,
  onCollapse,
  onTogglePosition,
  onRefreshTree,
  onOpenFile,
  onToggleNode,
  onCloseTab,
  onSetActiveTab,
}: SidebarProps) {
  const width = 280

  const segments: { key: SidebarView; label: string; icon: typeof Folder }[] = [
    { key: 'tree', label: '目录', icon: Folder },
    { key: 'outline', label: '大纲', icon: ListTree },
    { key: 'tabs', label: '打开的文件', icon: FileStack },
  ]

  return (
    <div
      className="surface-sidebar flex flex-col h-full bg-[color:var(--color-sidebar)] border-[color:var(--color-border-base)] overflow-hidden"
      style={{
        width,
        borderRightWidth: sidebarPosition === 'left' ? 1 : 0,
        borderLeftWidth: sidebarPosition === 'right' ? 1 : 0,
      }}
    >
      {/* 头部 */}
      <div className="flex items-center justify-between px-2 py-2.5 border-b border-[color:var(--color-border-base)] bg-[color:var(--color-sidebar-header)]">
        <div className="flex items-center gap-2 min-w-0">
          <button
            className="icon-btn-28"
            onClick={onCollapse}
            title="折叠侧边栏"
          >
            {sidebarPosition === 'left' ? (
              <PanelLeftClose size={15} />
            ) : (
              <PanelLeftOpen size={15} />
            )}
          </button>
          <span className="text-sm font-semibold text-[color:var(--color-text-primary)] truncate">
            Ma读
          </span>
        </div>
        <div className="flex gap-1">
          <button className="icon-btn-28" onClick={onTogglePosition} title="切换侧边栏位置">
            <ArrowLeftRight size={14} />
          </button>
          <button className="icon-btn-28" onClick={onRefreshTree} title="刷新">
            <RefreshCw size={14} />
          </button>
        </div>
      </div>

      {/* 视图切换 — 分段控件 */}
      <div className="p-2 border-b border-[color:var(--color-border-base)]">
        <div className="flex p-0.5 rounded-lg bg-[color:var(--color-bg-tertiary)]">
          {segments.map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              className={cn(
                'flex-1 flex items-center justify-center gap-1 py-1.5 rounded-md text-[12px] transition-all',
                view === key
                  ? 'bg-[color:var(--color-sidebar)] shadow-sm font-medium text-[color:var(--color-text-primary)]'
                  : 'text-[color:var(--color-text-secondary)] hover:text-[color:var(--color-text-primary)]',
              )}
              onClick={() => onViewChange(key)}
            >
              <Icon size={13} />
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* 视图内容 */}
      <div className="flex-1 overflow-y-auto overflow-x-hidden">
        {view === 'tree' ? (
          <FileTree
            nodes={fileTree}
            workingDirectory={workingDirectory}
            activePath={activePath}
            onOpenFile={onOpenFile}
            onToggleNode={onToggleNode}
          />
        ) : view === 'outline' ? (
          <OutlineList source={tabs.find((t) => t.id === activeTabId)?.content ?? ''} />
        ) : (
          <TabList
            tabs={tabs}
            activeTabId={activeTabId}
            onCloseTab={onCloseTab}
            onSetActive={onSetActiveTab}
          />
        )}
      </div>
    </div>
  )
}
