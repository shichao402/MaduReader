import { useState, type CSSProperties } from 'react'
import {
  PanelLeftClose,
  PanelLeftOpen,
  ArrowLeftRight,
  RefreshCw,
  Folder,
  ListTree,
} from 'lucide-react'
import { cn } from '../lib/utils'
import FileTree, { type FileNode } from './FileTree'
import OpenFilesGroup, { type Tab } from './OpenFilesGroup'

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

type SidebarView = 'tree' | 'outline'

interface SidebarProps {
  view: SidebarView
  fileTree: FileNode[]
  tabs: Tab[]
  activeTabId: string | null
  workingDirectory: string
  activePath: string | null
  sidebarPosition: 'left' | 'right'
  sidebarWidth: number
  onSidebarWidthChange: (width: number) => void
  onViewChange: (view: SidebarView) => void
  onCollapse: () => void
  onTogglePosition: () => void
  onRefreshTree: () => void
  onOpenFile: (path: string) => void
  onToggleNode: (path: string) => void
  onCloseTab: (id: string) => void
  onSetActiveTab: (id: string) => void
}

const SIDEBAR_WIDTH_MIN = 200
const SIDEBAR_WIDTH_MAX = 480
const SIDEBAR_WIDTH_DEFAULT = 280

/** VS Code 式边缘拖拽手柄（sash）：悬停显示 3px accent 线，拖拽调宽，双击复位，聚焦后支持 ←/→ 微调 */
function Resizer({
  side,
  width,
  onResize,
  onReset,
}: {
  side: 'left' | 'right'
  width: number
  onResize: (width: number) => void
  onReset: () => void
}) {
  const [dragging, setDragging] = useState(false)
  const active = dragging
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="调整侧边栏宽度"
      aria-valuenow={width}
      aria-valuemin={SIDEBAR_WIDTH_MIN}
      aria-valuemax={SIDEBAR_WIDTH_MAX}
      tabIndex={0}
      className="group/sash absolute top-0 bottom-0 z-20 w-1.5 cursor-col-resize outline-none"
      style={{ [side]: -3 } as CSSProperties}
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => {
        e.stopPropagation()
        onReset()
      }}
      onMouseDown={(e) => {
        if (e.button !== 0) return
        e.preventDefault()
        e.stopPropagation()
        // preventDefault 会吞掉原生聚焦，显式聚焦保证点完手柄立即可用 ←/→ 微调
        ;(e.currentTarget as HTMLElement).focus()
        setDragging(true)
        const startX = e.clientX
        const startWidth = width
        const started = performance.now()
        const onMove = (ev: MouseEvent) => {
          // 双击由连续两次快速单击构成，若位移+时长都极小则视为双击的第一次按下，不调宽
          if (performance.now() - started < 150 && Math.abs(ev.clientX - startX) < 3) return
          // 手柄贴右缘（左栏）：右拖加宽；贴左缘（右栏）：左拖加宽
          const delta = (ev.clientX - startX) * (side === 'right' ? 1 : -1)
          const next = startWidth + delta
          if (next !== startWidth) {
            onResize(Math.max(SIDEBAR_WIDTH_MIN, Math.min(SIDEBAR_WIDTH_MAX, next)))
          }
        }
        const onUp = () => {
          setDragging(false)
          window.removeEventListener('mousemove', onMove)
          window.removeEventListener('mouseup', onUp)
          document.body.style.cursor = ''
          document.body.style.userSelect = ''
        }
        window.addEventListener('mousemove', onMove)
        window.addEventListener('mouseup', onUp)
        document.body.style.cursor = 'col-resize'
        document.body.style.userSelect = 'none'
      }}
      onKeyDown={(e) => {
        if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
          e.preventDefault()
          e.stopPropagation()
          const dir = e.key === 'ArrowLeft' ? -1 : 1
          const delta = dir * (e.shiftKey ? 50 : 10) * (side === 'right' ? 1 : -1)
          onResize(Math.max(SIDEBAR_WIDTH_MIN, Math.min(SIDEBAR_WIDTH_MAX, width + delta)))
        }
      }}
    >
      {/* 视觉指示线：悬停/拖拽/键盘聚焦时显示 */}
      <div
        className={cn(
          'absolute inset-y-0 transition-colors duration-150',
          side === 'left' ? 'left-0 right-auto w-[3px]' : 'right-0 left-auto w-[3px]',
          active
            ? 'bg-[color:var(--color-accent)] opacity-100'
            : 'bg-[color:var(--color-accent)] opacity-0 group-hover/sash:opacity-60 group-focus-within/sash:opacity-60 group-focus/sash:opacity-60',
        )}
      />
    </div>
  )
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
  sidebarWidth,
  onSidebarWidthChange,
  onViewChange,
  onCollapse,
  onTogglePosition,
  onRefreshTree,
  onOpenFile,
  onToggleNode,
  onCloseTab,
  onSetActiveTab,
}: SidebarProps) {
  const width = sidebarWidth

  const segments: { key: SidebarView; label: string; icon: typeof Folder }[] = [
    { key: 'tree', label: '目录', icon: Folder },
    { key: 'outline', label: '大纲', icon: ListTree },
  ]

  return (
    <div
      className="surface-sidebar relative flex flex-col h-full bg-[color:var(--color-sidebar)] border-[color:var(--color-border-base)]"
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
          <>
            <OpenFilesGroup
              tabs={tabs}
              activeTabId={activeTabId}
              workingDirectory={workingDirectory}
              onCloseTab={onCloseTab}
              onSetActive={onSetActiveTab}
            />
            <FileTree
              nodes={fileTree}
              workingDirectory={workingDirectory}
              activePath={activePath}
              onOpenFile={onOpenFile}
              onToggleNode={onToggleNode}
            />
          </>
        ) : (
          <OutlineList source={tabs.find((t) => t.id === activeTabId)?.content ?? ''} />
        )}
      </div>

      {/* 宽度拖拽手柄：贴侧栏外边缘，悬停/拖拽显示 accent 指示线 */}
      {/* side=手柄贴合的侧栏边缘（朝向内容区的一侧）：左栏贴右缘、右栏贴左缘 */}
      <Resizer
        side={sidebarPosition === 'left' ? 'right' : 'left'}
        width={width}
        onResize={onSidebarWidthChange}
        onReset={() => onSidebarWidthChange(SIDEBAR_WIDTH_DEFAULT)}
      />
    </div>
  )
}
