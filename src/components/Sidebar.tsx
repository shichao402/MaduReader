import {
  PanelLeftClose,
  PanelLeftOpen,
  ArrowLeftRight,
  RefreshCw,
  Folder,
  FileStack,
  Settings,
} from 'lucide-react'
import { cn } from '../lib/utils'
import FileTree, { type FileNode } from './FileTree'
import TabList, { type Tab } from './TabList'

interface SidebarProps {
  view: 'tree' | 'tabs'
  fileTree: FileNode[]
  tabs: Tab[]
  activeTabId: string | null
  workingDirectory: string
  activePath: string | null
  sidebarPosition: 'left' | 'right'
  onViewChange: (view: 'tree' | 'tabs') => void
  onCollapse: () => void
  onTogglePosition: () => void
  onRefreshTree: () => void
  onOpenFile: (path: string) => void
  onToggleNode: (path: string) => void
  onCloseTab: (id: string) => void
  onSetActiveTab: (id: string) => void
  onNewTab: () => void
  onOpenSettings: () => void
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
  onNewTab,
  onOpenSettings,
}: SidebarProps) {
  const width = 280

  return (
    <div
      className="flex flex-col h-full bg-[color:var(--color-sidebar)] border-[color:var(--color-border-base)] overflow-hidden"
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

      {/* 视图切换 */}
      <div className="flex gap-1 p-2 border-b border-[color:var(--color-border-base)]">
        <button
          className={cn(
            'flex-1 flex items-center justify-center gap-1.5 py-2 rounded-md text-[13px] transition-colors',
            'text-[color:var(--color-text-secondary)] hover:bg-[color:var(--color-sidebar-hover)]',
            view === 'tree' &&
              'bg-[color:var(--color-sidebar-active)] border border-[color:var(--color-primary)] text-[color:var(--color-text-primary)]',
          )}
          onClick={() => onViewChange('tree')}
        >
          <Folder size={14} />
          目录
        </button>
        <button
          className={cn(
            'flex-1 flex items-center justify-center gap-1.5 py-2 rounded-md text-[13px] transition-colors',
            'text-[color:var(--color-text-secondary)] hover:bg-[color:var(--color-sidebar-hover)]',
            view === 'tabs' &&
              'bg-[color:var(--color-sidebar-active)] border border-[color:var(--color-primary)] text-[color:var(--color-text-primary)]',
          )}
          onClick={() => onViewChange('tabs')}
        >
          <FileStack size={14} />
          页签
        </button>
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
        ) : (
          <TabList
            tabs={tabs}
            activeTabId={activeTabId}
            onCloseTab={onCloseTab}
            onSetActive={onSetActiveTab}
            onNewTab={onNewTab}
          />
        )}
      </div>

      {/* 底部 */}
      <div className="p-2 border-t border-[color:var(--color-border-base)]">
        <button
          className="flex w-full items-center gap-2 px-3 py-2 rounded-md text-sm text-[color:var(--color-text-secondary)] hover:bg-[color:var(--color-sidebar-hover)] hover:text-[color:var(--color-text-primary)] transition-colors"
          onClick={onOpenSettings}
        >
          <Settings size={15} />
          设置
        </button>
      </div>
    </div>
  )
}
