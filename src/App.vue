<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { invoke } from '@tauri-apps/api/core'
import Sidebar from './components/Sidebar.vue'
import ContentArea from './components/ContentArea.vue'
import { useSettingsStore } from './stores/settings'
import { useTabStore } from './stores/tabs'

console.log('[MDReader] App.vue script loaded')

const settingsStore = useSettingsStore()
const tabStore = useTabStore()

console.log('[MDReader] Stores initialized')

const sidebarCollapsed = ref(false)
const sidebarPosition = ref<'left' | 'right'>('left')

const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
console.log('[MDReader] isTauri:', isTauri)

const demoFiles = [
  {
    path: 'web-demo/README.md',
    content: `# MDReader Web 示例

这是一个可直接在浏览器预览的 Markdown 阅读器示例工作区，用于验证 Markdown 渲染、目录树、多标签、查找、主题、导出、Mermaid、KaTeX、PlantUML、幻灯片和链接处理。

## Markdown 基础

- **粗体文本**
- *斜体文本*
- ==高亮文本==
- ~~删除线~~
- [外部链接](https://example.com)
- [自定义协议](myapp://open/demo)

<img alt="内联图片" src="data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyNDAiIGhlaWdodD0iODAiPjxyZWN0IHdpZHRoPSIyNDAiIGhlaWdodD0iODAiIHJ4PSIxMiIgZmlsbD0iIzNiODJmNiIvPjx0ZXh0IHg9IjEyMCIgeT0iNDgiIGZvbnQtc2l6ZT0iMjIiIHRleHQtYW5jaG9yPSJtaWRkbGUiIGZpbGw9IndoaXRlIj5NRFJlYWRlcjwvdGV4dD48L3N2Zz4=">

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

方向键或工具栏按钮可切换页。`
  },
  {
    path: 'web-demo/docs/advanced.md',
    content: `# 进阶示例

这个文件用于验证目录树打开文件、多标签切换和页面内查找。

## 查找目标

Agent e2e 验证时会搜索这个文档中的关键字：navigation-target。

> 引用块内容也会参与渲染和查找。
`
  }
]

onMounted(async () => {
  console.log('[MDReader] onMounted started')
  
  try {
    // 初始化设置
    await settingsStore.loadSettings()
    console.log('[MDReader] Settings loaded:', JSON.stringify(settingsStore.settings).substring(0, 100))
    
    // 从设置恢复侧边栏状态
    sidebarCollapsed.value = settingsStore.settings.sidebarCollapsed
    sidebarPosition.value = settingsStore.settings.sidebarPosition
    console.log('[MDReader] Sidebar state restored:', { collapsed: sidebarCollapsed.value, position: sidebarPosition.value })
    
    // 处理命令行参数
    if (isTauri) {
      console.log('[MDReader] Processing command line args...')
      try {
        const args = await invoke<string[]>('get_args')
        console.log('[MDReader] Command args:', args)
        if (args && args.length > 0) {
          const path = args[0]
          if (path) {
            console.log('[MDReader] Opening path:', path)
            // 判断是文件还是目录
            const fs = await import('@tauri-apps/plugin-fs')
            // 检查路径是否是目录（通过尝试读取目录）
            let isDir = false
            try {
              await fs.readDir(path)
              isDir = true
            } catch {
              isDir = false
            }
            
            console.log('[MDReader] Path is directory:', isDir)
            
            if (isDir) {
              tabStore.setWorkingDirectory(path)
              // 打开目录中的 README.md
              const files = await fs.readDir(path)
              const mdFiles = files.filter((f: { name: string }) => f.name.endsWith('.md'))
              console.log('[MDReader] Found md files:', mdFiles.length)
              if (mdFiles.length > 0) {
                const readme = mdFiles.find((f: { name: string }) => f.name.toLowerCase() === 'readme.md')
                const target = readme || mdFiles[0]
                const fullPath = path.endsWith('/') ? `${path}${target.name}` : `${path}/${target.name}`
                console.log('[MDReader] Opening file:', fullPath)
                await tabStore.openFile(fullPath)
              }
            } else {
              await tabStore.openFile(path)
              const lastSlash = path.lastIndexOf('/')
              tabStore.setWorkingDirectory(lastSlash > 0 ? path.substring(0, lastSlash) : '')
            }
          }
        }
      } catch (e) {
        console.error('[MDReader] Failed to process args:', e)
      }
    } else {
      console.log('[MDReader] Loading web demo workspace')
      await tabStore.setVirtualWorkspace('web-demo', demoFiles)
    }
    
    console.log('[MDReader] onMounted completed')
  } catch (e) {
    console.error('[MDReader] onMounted error:', e)
  }
})

const toggleSidebar = () => {
  sidebarCollapsed.value = !sidebarCollapsed.value
  settingsStore.settings.sidebarCollapsed = sidebarCollapsed.value
  settingsStore.saveSettings()
}

const toggleSidebarPosition = () => {
  sidebarPosition.value = sidebarPosition.value === 'left' ? 'right' : 'left'
  settingsStore.settings.sidebarPosition = sidebarPosition.value
  settingsStore.saveSettings()
}
</script>

<template>
  <div class="app-container">
    <!-- 侧边栏 -->
    <div 
      v-if="!sidebarCollapsed" 
      class="sidebar-wrapper"
      :class="sidebarPosition"
    >
      <Sidebar 
        :collapsed="false"
        @toggle="toggleSidebar"
        @toggle-position="toggleSidebarPosition"
      />
    </div>
    
    <!-- 折叠后的图标条 -->
    <div 
      v-else 
      class="sidebar-icon-bar"
      :class="sidebarPosition"
    >
      <button class="icon-btn" title="目录树" @click="tabStore.setSidebarView('tree')">
        📁
      </button>
      <button class="icon-btn" title="页签" @click="tabStore.setSidebarView('tabs')">
        📄
      </button>
      <button class="icon-btn" title="设置" @click="settingsStore.openSettings">
        ⚙️
      </button>
      <button class="icon-btn" title="切换主题" @click="settingsStore.toggleTheme">
        {{ settingsStore.isDark ? '☀️' : '🌙' }}
      </button>
      <button class="icon-btn" title="新建页签" @click="tabStore.newTab">
        ➕
      </button>
      <button class="icon-btn" title="刷新文件树" @click="tabStore.refreshFileTree">
        🔄
      </button>
      <button class="icon-btn toggle-btn" title="展开侧边栏" @click="toggleSidebar">
        {{ sidebarPosition === 'left' ? '◀' : '▶' }}
      </button>
    </div>
    
    <!-- 主内容区 -->
    <div class="main-content">
      <ContentArea />
    </div>
  </div>
</template>

<style scoped>
.app-container {
  display: flex;
  width: 100vw;
  height: 100vh;
  overflow: hidden;
}

.sidebar-wrapper {
  flex-shrink: 0;
  transition: all 0.2s ease;
}

.sidebar-wrapper.left {
  margin-left: 0;
}

.sidebar-wrapper.right {
  order: 2;
  margin-right: 0;
}

.sidebar-icon-bar {
  width: 48px;
  flex-shrink: 0;
  background: var(--sidebar-bg);
  border-right: 1px solid var(--border-color);
  display: flex;
  flex-direction: column;
  padding: 8px 0;
  gap: 4px;
  transition: all 0.2s ease;
}

.sidebar-icon-bar.right {
  order: 2;
  border-right: none;
  border-left: 1px solid var(--border-color);
}

.icon-btn {
  width: 36px;
  height: 36px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  font-size: 16px;
  color: var(--text-secondary);
  transition: all 0.15s ease;
}

.icon-btn:hover {
  background: var(--sidebar-hover);
  color: var(--text-primary);
}

.icon-btn.toggle-btn {
  margin-top: auto;
}

.main-content {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  min-width: 0;
}
</style>
