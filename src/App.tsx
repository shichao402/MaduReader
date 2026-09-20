import { useEffect, useState } from 'react'
import { getSettingsStore, getTabStore, useStores } from './hooks/useStores'
import Sidebar from './components/Sidebar'
import SidebarIconBar from './components/SidebarIconBar'
import ContentArea from './components/ContentArea'
import CommandPalette from './components/CommandPalette'
import SettingsDialog from './components/SettingsDialog'

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
]

export default function App() {
  const { tabStore, settingsStore } = useStores()
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [sidebarPosition, setSidebarPosition] = useState<'left' | 'right'>('left')
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [sidebarView, setSidebarView] = useState<'tree' | 'outline'>('outline')

  // 初始化
  useEffect(() => {
    let cancelled = false
    async function init() {
      const settingsStore = getSettingsStore()
      const tabStore = getTabStore()
      try {
        await settingsStore.loadSettings()
        if (cancelled) return
        setSidebarCollapsed(settingsStore.settings.sidebarCollapsed)
        setSidebarPosition(settingsStore.settings.sidebarPosition)
        if (isTauri) {
          try {
            const { invoke } = await import('@tauri-apps/api/core')
            const args = await invoke<string[]>('get_args')
            if (args && args.length > 0 && args[0]) {
              const path = args[0]
              const fs = await import('@tauri-apps/plugin-fs')
              let isDir = false
              try {
                await fs.readDir(path)
                isDir = true
              } catch {
                isDir = false
              }
              if (isDir) {
                tabStore.setWorkingDirectory(path)
                const files = await fs.readDir(path)
                const mdFiles = files.filter((f: { name: string }) => f.name.endsWith('.md'))
                if (mdFiles.length > 0) {
                  const readme = mdFiles.find(
                    (f: { name: string }) => f.name.toLowerCase() === 'readme.md',
                  )
                  const target = readme || mdFiles[0]
                  const fullPath = path.endsWith('/')
                    ? `${path}${target.name}`
                    : `${path}/${target.name}`
                  await tabStore.openFile(fullPath)
                }
              } else {
                await tabStore.openFile(path)
                const lastSlash = path.lastIndexOf('/')
                tabStore.setWorkingDirectory(lastSlash > 0 ? path.substring(0, lastSlash) : '')
              }
            }
          } catch (e) {
            console.error('[MaduReader] Failed to process args:', e)
          }
        } else {
          await tabStore.setVirtualWorkspace('web-demo', demoFiles)
        }
      } catch (e) {
        console.error('[MaduReader] init error:', e)
      }
    }
    init()
    return () => {
      cancelled = true
    }
  }, [])

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
            tabs={tabStore.tabs}
            activeTabId={tabStore.activeTabId}
            activePath={tabStore.tabs.find((t) => t.id === tabStore.activeTabId)?.path ?? null}
            workingDirectory={tabStore.workingDirectory}
            sidebarPosition={sidebarPosition}
            onViewChange={setSidebarView}
            onCollapse={toggleSidebar}
            onTogglePosition={toggleSidebarPosition}
            onRefreshTree={() => tabStore.refreshFileTree()}
            onOpenFile={(path) => tabStore.openFile(path)}
            onToggleNode={(path) => tabStore.toggleFileNode(path)}
            onCloseTab={(id) => tabStore.closeTab(id)}
            onSetActiveTab={(id) => tabStore.setActiveTab(id)}
          />
        </div>
      )}

      <div className="flex-1 flex flex-col overflow-hidden min-w-0">
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
