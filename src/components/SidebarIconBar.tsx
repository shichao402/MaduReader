import { cn } from '../lib/utils'
import { Settings } from 'lucide-react'

export default function SidebarIconBar({
  sidebarPosition,
  isDark,
  onSetView,
  onOpenSettings,
  onToggleTheme,
  onNewTab,
  onRefreshTree,
  onExpand,
}: {
  sidebarPosition: 'left' | 'right'
  isDark: boolean
  onSetView: (view: 'tree' | 'tabs') => void
  onOpenSettings: () => void
  onToggleTheme: () => void
  onNewTab: () => void
  onRefreshTree: () => void
  onExpand: () => void
}) {
  const btn =
    'w-9 h-9 flex items-center justify-center rounded-md bg-transparent border-none text-[color:var(--color-text-secondary)] hover:bg-[color:var(--color-sidebar-hover)] hover:text-[color:var(--color-text-primary)] transition-colors'

  return (
    <div
      className={cn(
        'w-12 shrink-0 flex flex-col py-2 gap-1 bg-[color:var(--color-sidebar)] transition-all',
        sidebarPosition === 'left'
          ? 'border-r border-[color:var(--color-border-base)]'
          : 'order-2 border-l border-[color:var(--color-border-base)]',
      )}
    >
      <button className={btn} title="目录树" onClick={() => onSetView('tree')}>
        <FolderIcon />
      </button>
      <button className={btn} title="页签" onClick={() => onSetView('tabs')}>
        <TabsIcon />
      </button>
      <button className={btn} title="设置" onClick={onOpenSettings}>
        <Settings size={16} />
      </button>
      <button className={btn} title="切换主题" onClick={onToggleTheme}>
        {isDark ? <SunIcon /> : <MoonIcon />}
      </button>
      <button className={btn} title="新建页签" onClick={onNewTab}>
        <PlusIcon />
      </button>
      <button className={btn} title="刷新文件树" onClick={onRefreshTree}>
        <RefreshIcon />
      </button>
      <button className={cn(btn, 'mt-auto')} title="展开侧边栏" onClick={onExpand}>
        {sidebarPosition === 'left' ? <ChevronLeftIcon /> : <ChevronRightIcon />}
      </button>
    </div>
  )
}

function FolderIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
    </svg>
  )
}
function TabsIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
    </svg>
  )
}
function SunIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2m0 16v2M4.9 4.9l1.4 1.4m11.3 11.3 1.4 1.4M2 12h2m16 0h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </svg>
  )
}
function MoonIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
    </svg>
  )
}
function PlusIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M12 5v14M5 12h14" />
    </svg>
  )
}
function RefreshIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M21 12a9 9 0 1 1-2.6-6.4M21 3v6h-6" />
    </svg>
  )
}
function ChevronLeftIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="m15 18-6-6 6-6" />
    </svg>
  )
}
function ChevronRightIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="m9 18 6-6-6-6" />
    </svg>
  )
}
