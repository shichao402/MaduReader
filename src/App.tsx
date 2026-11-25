import { useEffect, useRef, useState } from 'react'
import { getSettingsStore, getTabStore, useStores } from './hooks/useStores'
import Sidebar from './components/Sidebar'
import SidebarIconBar from './components/SidebarIconBar'
import ContentArea from './components/ContentArea'
import CommandPalette from './components/CommandPalette'
import SettingsDialog from './components/SettingsDialog'
import { startDirectorySync } from './lib/directorySync'
import { openPaths, openUserPaths, type OpenErrorNotice } from './lib/openPaths'
import { createOpenRequestReceiver } from './lib/openRequestReceiver'
import OpenErrorBanner from './components/OpenErrorBanner'
import { readingProgress } from './lib/readingProgress'

const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window

if (isTauri) document.documentElement.classList.add('tauri')

const demoFiles = [
  {
    path: 'web-demo/README.md',
    content: `# MaduReader Web 示例

这是一个可直接在浏览器预览的 Markdown 阅读器示例工作区，用于验证 Markdown 渲染、目录树、多标签、查找、主题、导出、Mermaid、KaTeX、PlantUML、幻灯片和链接处理。

## Markdown 基础

- **粗体文本**
- *斜体文本*
- ==高亮文本==
- ~~删除线~~
- [外部链接](https://example.com)
- [自定义协议](myapp://open/demo)

<img alt="内联图片" src="data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyNDAiIGhlaWdodD0iODAiPjxyZWN0IHdpZHRoPSIyNDAiIGhlaWdodD0iODAiIHJ4PSIxMiIgZmlsbD0iIzNiODJmNiIvPjx0ZXh0IHg9IjEyMCIgeT0iNDgiIGZvbnQtc2l6ZT0iMjIiIHRleHQtYW5jaG9yPSJtaWRkbGUiIGZpbGw9IndoaXRlIj5NYWR1UmVhZGVyPC90ZXh0Pjwvc3ZnPg==">

| 功能 | 状态 |
| --- | --- |
| Markdown | 可用 |
| Mermaid | 可用 |
| KaTeX | 可用 |

## 代码高亮

\`\`\`ts
export function greet(name: string) {
  return \`Hello, \${name}\`
}
\`\`\`

## Mermaid

\`\`\`mermaid
flowchart TD
  A[打开 Markdown] --> B[渲染内容]
  B --> C{包含图表?}
  C -->|是| D[渲染 Mermaid]
  C -->|否| E[显示文档]
\`\`\`

## PlantUML

\`\`\`plantuml
@startuml
Alice -> Bob: Markdown
Bob --> Alice: HTML
@enduml
\`\`\`

## KaTeX

行内公式 $E = mc^2$，块级公式：

$$
\\int_0^1 x^2 dx = \\frac{1}{3}
$$

---

# 幻灯片第一页

使用单独一行 \`---\` 分隔幻灯片。

---

# 幻灯片第二页

方向键或工具栏按钮可切换页。`,
  },
  {
    path: 'web-demo/docs/advanced.md',
    content: `# 进阶示例

这个文件用于验证目录树打开文件、多标签切换和页面内查找。

## 查找目标

Agent e2e 验证时会搜索这个文档中的关键字：navigation-target。

> 引用块内容也会参与渲染和查找。
`,
  },
  {
    path: 'web-demo/notes.md',
    content: `# 同名文件演示（根目录）

本文件与 \`web-demo/docs/notes.md\` **文件名相同、目录不同**。

## 用途

用于复现「已打开」分组中的同名冲突场景：同时打开这两个文件时，分组内每个条目下方会显示所属目录（\`docs\` / \`.\`），以便区分。若不同时出现同名，则不显示副标题。

## 验证步骤

1. 在目录树中打开「notes.md」（本文件，位于工作区根）
2. 展开 docs 目录，打开其中的「notes.md」
3. 侧边栏「已打开」分组应出现两个「notes.md」，分别带目录副标题
`,
  },
  {
    path: 'web-demo/docs/notes.md',
    content: `# 同名文件演示（docs 目录）

本文件与 \`web-demo/notes.md\` **文件名相同、目录不同**。

## 用途

用于复现「已打开」分组中的同名冲突场景：同时打开这两个文件时，分组内每个条目下方会显示所属目录（\`docs\` / \`.\`），以便区分。若不同时出现同名，则不显示副标题。

## 验证步骤

1. 在目录树中打开根目录下的「notes.md」
2. 展开 docs 目录，打开其中的「notes.md」（本文件）
3. 侧边栏「已打开」分组应出现两个「notes.md」，分别带目录副标题
`,
  },
]

export default function App() {
  const { tabStore, settingsStore } = useStores()
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [sidebarPosition, setSidebarPosition] = useState<'left' | 'right'>('left')
  const [sidebarWidth, setSidebarWidth] = useState(280)
  const widthLoadedRef = useRef(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [sidebarView, setSidebarView] = useState<'tree' | 'outline'>('outline')

  const [openError, setOpenError] = useState<OpenErrorNotice | null>(null)
  const receiverRef = useRef<ReturnType<typeof createOpenRequestReceiver> | null>(null)
  const bootReadyRef = useRef(false)

  // 初始化：页面先注册，再按既有规则恢复，最后开始处理队列。
  useEffect(() => {
    let cancelled = false
    let receiver: ReturnType<typeof createOpenRequestReceiver> | undefined
    async function init() {
      const bootT0 = performance.now()
      const settingsStore = getSettingsStore()
      const tabStore = getTabStore()
      try {
        await settingsStore.loadSettings()
        if (cancelled) return
        tabStore.applyFilePolicy(settingsStore.settings)
        await readingProgress.load()
        void import('./lib/perfLog').then(({ perfLog }) =>
          perfLog(`frontend: settings loaded in ${(performance.now() - bootT0).toFixed(0)}ms`),
        )
        if (cancelled) return
        setSidebarCollapsed(settingsStore.settings.sidebarCollapsed)
        setSidebarPosition(settingsStore.settings.sidebarPosition)
        setSidebarWidth(settingsStore.settings.sidebarWidth)
        widthLoadedRef.current = true
        if (isTauri) {
          const { invoke } = await import('@tauri-apps/api/core')
          const { listen } = await import('@tauri-apps/api/event')
          if (cancelled) return
          receiver = createOpenRequestReceiver({
            invoke,
            listen: (notify) => listen('madu:open-requests', notify),
            url: window.location.href,
            execute: (paths) => openPaths(paths),
            onError: (notice) => { if (!cancelled) setOpenError(notice) },
            initialize: async (hasRequests) => {
              if (hasRequests || !settingsStore.settings.restoreSession) return
              const { loadSession } = await import('./lib/session')
              const session = await loadSession()
              if (cancelled) return
              if (session.openPaths.length || session.workingDirectory) {
                const restoreT0 = performance.now()
                await tabStore.restoreSession(session)
                void import('./lib/perfLog').then(({ perfLog }) =>
                  perfLog(`frontend: session restored (${session.openPaths.length} tabs) in ${(performance.now() - restoreT0).toFixed(0)}ms`),
                )
              }
            },
            afterPaint: () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))),
          })
          receiverRef.current = receiver
          await receiver.start()
        } else {
          await tabStore.setVirtualWorkspace('web-demo', demoFiles)
          if (settingsStore.settings.restoreSession) {
            const { loadSession } = await import('./lib/session')
            const session = await loadSession()
            if (cancelled) return
            if (session.openPaths.length > 0 || session.workingDirectory) {
              await tabStore.restoreSession(session)
            }
          }
        }
      } catch (e) {
        console.error('[MaduReader] init error:', e)
      } finally {
        if (!cancelled) { bootReadyRef.current = true; window.dispatchEvent(new Event('madu:session-ready')) }
      }
    }
    init()
    return () => {
      cancelled = true
      receiver?.stop()
      if (receiverRef.current === receiver) receiverRef.current = null
    }
  }, [])

  // 设置立即生效；常驻页面每分钟/重新获得焦点时清理到期条目，不读取休眠正文。
  useEffect(() => {
    tabStore.applyFilePolicy(settingsStore.settings)
  }, [tabStore, settingsStore.settings.maxOpenFiles, settingsStore.settings.inactiveRetentionDays, settingsStore.settings.openFilesSort])

  useEffect(() => {
    const cleanup = () => getTabStore().cleanupInactiveFiles()
    const timer = window.setInterval(cleanup, 60000)
    window.addEventListener('focus', cleanup)
    document.addEventListener('visibilitychange', cleanup)
    return () => { window.clearInterval(timer); window.removeEventListener('focus', cleanup); document.removeEventListener('visibilitychange', cleanup) }
  }, [])

  // 所有目录入口、会话恢复共用同一监听生命周期；虚拟工作区不接触原生文件系统。
  // 目录树刷新后再核对已打开正文：当前阅读的文件只提示变更，不直接替换。
  useEffect(() => {
    const root = tabStore.workingDirectory
    if (!isTauri || !root || tabStore.isVirtualWorkspace) return
    return startDirectorySync(root, async () => {
      await tabStore.refreshFileTree()
      await tabStore.syncOpenFileContents()
    })
  }, [tabStore, tabStore.workingDirectory, tabStore.isVirtualWorkspace])

  // 工作目录之外打开的文件（参数/文件关联/拖拽）收不到目录事件，逐个文件非递归监听。
  const outsideFilesKey = (() => {
    const root = tabStore.workingDirectory.replace(/\\/g, '/').replace(/\/+$/, '')
    const rootKey = root.toLowerCase()
    const prefix = rootKey ? `${rootKey}/` : ''
    return tabStore.tabs
      .filter(tab => !tab.isUntitled && tab.path)
      .map(tab => tab.path.replace(/\\/g, '/'))
      .filter(path => !prefix || !path.toLowerCase().startsWith(prefix))
      .sort()
      .join('\n')
  })()
  useEffect(() => {
    if (!isTauri || !outsideFilesKey || tabStore.isVirtualWorkspace) return
    const stops = outsideFilesKey.split('\n').map(path =>
      startDirectorySync(path, () => tabStore.syncOpenFileContents(), { recursive: false }))
    return () => stops.forEach(stop => stop())
  }, [tabStore, outsideFilesKey, tabStore.isVirtualWorkspace])

  // 监听设置打开事件（icon bar 等触发）
  useEffect(() => {
    const open = () => setSettingsOpen(true)
    document.addEventListener('open-settings', open)
    window.addEventListener('open-settings', open)
    return () => {
      document.removeEventListener('open-settings', open)
      window.removeEventListener('open-settings', open)
    }
  }, [])

  // 会话持久化：打开/关闭/切换标签后防抖写入 session.json / localStorage
  useEffect(() => {
    let timer: number | undefined
    const persist = () => {
      if (!bootReadyRef.current) return
      window.clearTimeout(timer)
      timer = window.setTimeout(() => {
        const settingsStore = getSettingsStore()
        if (!settingsStore.settings.restoreSession) return
        void import('./lib/session').then(({ saveSession }) =>
          saveSession(getTabStore().snapshotSession()),
        )
      }, 500)
    }
    // 点 X 驻留托盘前，Rust 侧会立即触发本事件：不等防抖，马上落盘会话
    const flushNow = () => {
      window.dispatchEvent(new Event('madu:before-document-change'))
      void readingProgress.flush()
      if (!bootReadyRef.current) return
      window.clearTimeout(timer)
      const settingsStore = getSettingsStore()
      if (!settingsStore.settings.restoreSession) return
      void import('./lib/session').then(({ saveSession }) =>
        saveSession(getTabStore().snapshotSession()),
      )
    }
    window.addEventListener('madu:hide-before-close', flushNow)
    window.addEventListener('pagehide', flushNow)
    window.addEventListener('madu:session-ready', persist)
    const unsubscribe = getTabStore().subscribe(persist)
    return () => {
      window.removeEventListener('madu:hide-before-close', flushNow)
      window.removeEventListener('pagehide', flushNow)
      window.removeEventListener('madu:session-ready', persist)
      unsubscribe()
      window.clearTimeout(timer)
    }
  }, [])

  // 对话框、侧栏等用户交互与外部请求使用相同的错误反馈。
  useEffect(() => {
    const handler = (event: Event) => setOpenError((event as CustomEvent<OpenErrorNotice>).detail)
    window.addEventListener('madu:open-error', handler)
    return () => window.removeEventListener('madu:open-error', handler)
  }, [])

  // 拖拽打开：WebView2 新内核已移除 File.path，必须用 Tauri 的拖放事件拿真实路径
  useEffect(() => {
    if (!isTauri) return
    let unlisten: (() => void) | undefined
    let cancelled = false
    ;(async () => {
      try {
        const { getCurrentWebview } = await import('@tauri-apps/api/webview')
        const un = await getCurrentWebview().onDragDropEvent((event) => {
          if (event.payload.type === 'drop') {
            const paths = event.payload.paths
            if (paths.length > 0) {
              void openUserPaths(paths)
            }
          }
        })
        if (cancelled) {
          un()
        } else {
          unlisten = un
        }
      } catch (e) {
        console.error('[MaduReader] Failed to listen drag-drop events:', e)
      }
    })()
    return () => {
      cancelled = true
      unlisten?.()
    }
  }, [])

  // 侧栏宽度：拖拽中仅更新视图，停止 600ms 后写入设置，避免拖动过程高频落盘；
  // 用已加载标记守门，不能特判 280（否则双击复位到默认值反而不会持久化）
  useEffect(() => {
    if (!widthLoadedRef.current) return
    const settingsStore = getSettingsStore()
    const timer = window.setTimeout(() => {
      settingsStore.update({ sidebarWidth }, { save: false })
      settingsStore.saveSettings()
    }, 600)
    return () => window.clearTimeout(timer)
  }, [sidebarWidth])

  function toggleSidebar() {
    setSidebarCollapsed((v) => {
      settingsStore.update({ sidebarCollapsed: !v }, { save: false })
      settingsStore.saveSettings()
      return !v
    })
  }

  function toggleSidebarPosition() {
    setSidebarPosition((v) => {
      const next = v === 'left' ? 'right' : 'left'
      settingsStore.update({ sidebarPosition: next }, { save: false })
      settingsStore.saveSettings()
      return next
    })
  }

  useEffect(() => {
    function handleKeydown(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setPaletteOpen((v) => !v)
      }
    }
    const open = () => setPaletteOpen(true)
    document.addEventListener('keydown', handleKeydown)
    document.addEventListener('open-command-palette', open)
    window.addEventListener('open-command-palette', open)
    return () => {
      document.removeEventListener('keydown', handleKeydown)
      document.removeEventListener('open-command-palette', open)
      window.removeEventListener('open-command-palette', open)
    }
  }, [])

  return (
    <div className="flex w-screen h-screen overflow-hidden app-root">
      {sidebarCollapsed ? (
        <SidebarIconBar
          sidebarPosition={sidebarPosition}
          isDark={settingsStore.isDark}
          activeView={sidebarView}
          onSetView={(view) => {
            setSidebarView(view)
            tabStore.setSidebarView(view)
            toggleSidebar()
          }}
          onToggleTheme={() => settingsStore.toggleTheme()}
          onRefreshTree={() => tabStore.refreshFileTree()}
          onExpand={toggleSidebar}
        />
      ) : (
        <div
          className="h-full shrink-0 transition-all"
          style={{ order: sidebarPosition === 'right' ? 2 : 0 }}
        >
          <Sidebar
            view={sidebarView}
            fileTree={tabStore.fileTree}
            tabs={tabStore.sortedTabs}
            inactiveFiles={tabStore.inactiveFiles}
            openFilesSort={settingsStore.settings.openFilesSort}
            onSortFiles={sort => settingsStore.update({ openFilesSort: sort })}
            onCloseInactiveFile={path => tabStore.closeInactiveFile(path)}
            activeTabId={tabStore.activeTabId}
            activePath={tabStore.tabs.find((t) => t.id === tabStore.activeTabId)?.path ?? null}
            workingDirectory={tabStore.workingDirectory}
            directoryError={tabStore.directoryError}
            sidebarPosition={sidebarPosition}
            sidebarWidth={sidebarWidth}
            onSidebarWidthChange={setSidebarWidth}
            onViewChange={setSidebarView}
            onCollapse={toggleSidebar}
            onTogglePosition={toggleSidebarPosition}
            onRefreshTree={() => tabStore.refreshFileTree()}
            onOpenFile={(path) => { void openUserPaths([path], { updateWorkspace: false }) }}
            onToggleNode={(path) => tabStore.toggleFileNode(path)}
            onCloseTab={(id) => tabStore.closeTab(id)}
            onSetActiveTab={(id) => tabStore.setActiveTab(id)}
          />
        </div>
      )}

      <div className="flex-1 flex flex-col overflow-hidden min-w-0">
        {openError && <OpenErrorBanner
          notice={openError}
          onDismiss={() => setOpenError(null)}
          onRetry={() => { setOpenError(null); void receiverRef.current?.retry() }}
        />}
        <ContentArea onOpenSettings={() => setSettingsOpen(true)} />
      </div>

      <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
      <CommandPalette
        open={paletteOpen}
        onOpenChange={setPaletteOpen}
        onToggleSidebar={toggleSidebar}
      />
    </div>
  )
}
