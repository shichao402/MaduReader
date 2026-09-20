import { useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import {
  Search,
  FileText,
  FileJson,
  FileCode,
  Image as ImageIcon,
  Hash,
  FolderOpen,
  Download,
  Presentation,
  Settings,
  PanelLeft,
  ZoomIn,
  ZoomOut,
  RotateCcw,
  Sun,
  Moon,
  type LucideIcon,
} from 'lucide-react'
import { useStores } from '../hooks/useStores'
import type { FileNode } from './FileTree'
import { cn } from '../lib/utils'

interface CommandItem {
  id: string
  section: '文件' | '大纲' | '命令'
  label: string
  hint?: string
  kbd?: string
  icon: LucideIcon
  action: () => void
}

const SECTION_ORDER: CommandItem['section'][] = ['文件', '大纲', '命令']

function flattenFiles(nodes: FileNode[], out: FileNode[] = []): FileNode[] {
  for (const node of nodes) {
    if (node.isDir) flattenFiles(node.children || [], out)
    else out.push(node)
  }
  return out
}

function extractHeadings(source: string): { level: number; text: string }[] {
  const headings: { level: number; text: string }[] = []
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

function fileIcon(name: string): LucideIcon {
  if (/\.(png|jpg|jpeg|gif|svg)$/i.test(name)) return ImageIcon
  if (name.endsWith('.json')) return FileJson
  if (/\.(py|js|ts|tsx|rs)$/.test(name)) return FileCode
  return FileText
}

function Kbd({ children }: { children: string }) {
  return (
    <span className="inline-flex h-5 min-w-5 items-center justify-center rounded border border-[color:var(--color-border-base)] bg-[color:var(--color-content)] px-1.5 font-mono text-[10px] text-[color:var(--color-text-secondary)]">
      {children}
    </span>
  )
}

export default function CommandPalette({
  open,
  onOpenChange,
  onToggleSidebar,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onToggleSidebar: () => void
}) {
  const { tabStore, settingsStore } = useStores()
  const [query, setQuery] = useState('')
  const [sel, setSel] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (open) {
      setQuery('')
      setSel(0)
      requestAnimationFrame(() => inputRef.current?.focus())
    }
  }, [open])

  const items = useMemo<CommandItem[]>(() => {
    const files = flattenFiles(tabStore.fileTree || [])
      .slice(0, 40)
      .map<CommandItem>((f) => ({
        id: `file:${f.path}`,
        section: '文件',
        label: f.name,
        hint: f.path,
        icon: fileIcon(f.name),
        action: () => void tabStore.openFile(f.path),
      }))

    const headings = extractHeadings(tabStore.activeContent || '')
      .slice(0, 30)
      .map<CommandItem>((h, i) => ({
        id: `heading:${i}`,
        section: '大纲',
        label: h.text,
        hint: `H${h.level}`,
        icon: Hash,
        action: () =>
          window.dispatchEvent(
            new CustomEvent('scroll-to-heading', { detail: { index: i, text: h.text } }),
          ),
      }))

    const commands: CommandItem[] = [
      {
        id: 'cmd:open',
        section: '命令',
        label: '打开文件…',
        kbd: 'Ctrl O',
        icon: FolderOpen,
        action: () => window.dispatchEvent(new Event('trigger-open-file')),
      },
      {
        id: 'cmd:find',
        section: '命令',
        label: '页面内查找',
        kbd: 'Ctrl F',
        icon: Search,
        action: () => window.dispatchEvent(new Event('trigger-find')),
      },
      {
        id: 'cmd:export',
        section: '命令',
        label: '导出 HTML / PDF',
        icon: Download,
        action: () => window.dispatchEvent(new Event('trigger-export')),
      },
      {
        id: 'cmd:slideshow',
        section: '命令',
        label: '幻灯片模式',
        icon: Presentation,
        action: () => window.dispatchEvent(new Event('trigger-slideshow')),
      },
      {
        id: 'cmd:theme',
        section: '命令',
        label: settingsStore.isDark ? '切换到浅色主题' : '切换到深色主题',
        icon: settingsStore.isDark ? Sun : Moon,
        action: () => settingsStore.toggleTheme(),
      },
      {
        id: 'cmd:zoom-in',
        section: '命令',
        label: '放大',
        kbd: 'Ctrl =',
        icon: ZoomIn,
        action: () => settingsStore.increaseZoom(),
      },
      {
        id: 'cmd:zoom-out',
        section: '命令',
        label: '缩小',
        kbd: 'Ctrl -',
        icon: ZoomOut,
        action: () => settingsStore.decreaseZoom(),
      },
      {
        id: 'cmd:zoom-reset',
        section: '命令',
        label: '重置缩放',
        kbd: 'Ctrl 0',
        icon: RotateCcw,
        action: () => settingsStore.resetZoom(),
      },
      {
        id: 'cmd:sidebar',
        section: '命令',
        label: '切换侧边栏',
        kbd: 'Ctrl B',
        icon: PanelLeft,
        action: onToggleSidebar,
      },
      {
        id: 'cmd:settings',
        section: '命令',
        label: '打开设置',
        icon: Settings,
        action: () => window.dispatchEvent(new Event('open-settings')),
      },
    ]

    return [...files, ...headings, ...commands]
  }, [
    tabStore.fileTree,
    tabStore.activeContent,
    settingsStore.isDark,
    tabStore,
    settingsStore,
    onToggleSidebar,
  ])

  const q = query.trim().toLowerCase()
  const visible = useMemo(
    () =>
      items.filter(
        (it) =>
          !q ||
          it.label.toLowerCase().includes(q) ||
          (it.hint ?? '').toLowerCase().includes(q),
      ),
    [items, q],
  )

  useEffect(() => {
    setSel((s) => Math.min(s, Math.max(0, visible.length - 1)))
  }, [visible.length])

  useEffect(() => {
    const el = listRef.current?.querySelector(`[data-idx="${sel}"]`)
    el?.scrollIntoView({ block: 'nearest' })
  }, [sel])

  function execute(item: CommandItem) {
    onOpenChange(false)
    item.action()
  }

  const grouped = SECTION_ORDER.map((section) => ({
    section,
    items: visible.filter((it) => it.section === section),
  })).filter((g) => g.items.length > 0)

  let flatIndex = -1

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.12 }}
          className="fixed inset-0 z-[2000] flex items-start justify-center bg-black/25 pt-[12vh] backdrop-blur-[2px]"
          onClick={() => onOpenChange(false)}
        >
          <motion.div
            initial={{ opacity: 0, y: -8, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.98 }}
            transition={{ duration: 0.15, ease: 'easeOut' }}
            className="w-[560px] max-w-[92vw] overflow-hidden rounded-xl border border-[color:var(--color-border-base)] bg-[color:var(--color-find-box)] shadow-lg"
            onClick={(e) => e.stopPropagation()}
          >
            {/* 输入行 */}
            <div className="flex items-center gap-3 border-b border-[color:var(--color-border-base)] px-4">
              <Search size={16} className="shrink-0 text-[color:var(--color-text-tertiary)]" />
              <input
                ref={inputRef}
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value)
                  setSel(0)
                }}
                onKeyDown={(e) => {
                  if (e.key === 'ArrowDown') {
                    e.preventDefault()
                    setSel((s) => Math.min(s + 1, visible.length - 1))
                  } else if (e.key === 'ArrowUp') {
                    e.preventDefault()
                    setSel((s) => Math.max(s - 1, 0))
                  } else if (e.key === 'Enter') {
                    e.preventDefault()
                    const item = visible[sel]
                    if (item) execute(item)
                  } else if (e.key === 'Escape') {
                    e.preventDefault()
                    onOpenChange(false)
                  }
                }}
                placeholder="搜索文件、大纲或命令…"
                className="w-full bg-transparent py-3.5 text-sm text-[color:var(--color-text-primary)] outline-none placeholder:text-[color:var(--color-text-tertiary)]"
              />
              <Kbd>esc</Kbd>
            </div>

            {/* 结果列表 */}
            <div ref={listRef} className="max-h-[360px] overflow-y-auto py-1.5">
              {grouped.length === 0 ? (
                <div className="px-4 py-8 text-center text-sm text-[color:var(--color-text-tertiary)]">
                  没有匹配的结果
                </div>
              ) : (
                grouped.map((group) => (
                  <div key={group.section}>
                    <div className="px-4 pb-1 pt-2 text-[11px] font-medium uppercase tracking-wider text-[color:var(--color-text-tertiary)]">
                      {group.section}
                    </div>
                    {group.items.map((item) => {
                      flatIndex += 1
                      const idx = flatIndex
                      const Icon = item.icon
                      const selected = idx === sel
                      return (
                        <div
                          key={item.id}
                          data-idx={idx}
                          className={cn(
                            'mx-1.5 flex cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-2 text-sm transition-colors',
                            selected
                              ? 'bg-[color:var(--color-sidebar-active)] text-[color:var(--color-text-primary)]'
                              : 'hover:bg-[color:var(--color-sidebar-hover)]',
                          )}
                          onMouseEnter={() => setSel(idx)}
                          onClick={() => execute(item)}
                        >
                          <Icon
                            size={16}
                            className={cn(
                              'shrink-0',
                              selected
                                ? 'text-[color:var(--color-accent)]'
                                : 'text-[color:var(--color-text-tertiary)]',
                            )}
                          />
                          <span className="flex-1 truncate text-[color:var(--color-text-primary)]">
                            {item.label}
                          </span>
                          {item.hint && (
                            <span className="max-w-[200px] truncate text-xs text-[color:var(--color-text-tertiary)]">
                              {item.hint}
                            </span>
                          )}
                          {item.kbd && (
                            <span className="flex gap-1">
                              {item.kbd.split(' ').map((k) => (
                                <Kbd key={k}>{k}</Kbd>
                              ))}
                            </span>
                          )}
                        </div>
                      )
                    })}
                  </div>
                ))
              )}
            </div>

            {/* 底部快捷键提示 */}
            <div className="flex items-center gap-4 border-t border-[color:var(--color-border-base)] px-4 py-2 text-[11px] text-[color:var(--color-text-tertiary)]">
              <span className="flex items-center gap-1">
                <Kbd>↑</Kbd>
                <Kbd>↓</Kbd>
                选择
              </span>
              <span className="flex items-center gap-1">
                <Kbd>↵</Kbd>
                执行
              </span>
              <span className="flex items-center gap-1">
                <Kbd>esc</Kbd>
                关闭
              </span>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
