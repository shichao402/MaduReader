<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount, watch, nextTick } from 'vue'
import { useTabStore } from '../stores/tabs'
import { useSettingsStore } from '../stores/settings'
import { renderMarkdown, initCodeCopy } from '../composables/useMarkdown'
import { renderMermaidCode } from '../composables/useMermaid'
import { renderPlantUmlCode } from '../composables/usePlantUml'
import { useFind } from '../composables/useFind'
import { attachLinkHandler, detachLinkHandler } from '../composables/useLinkHandler'
import ExportDialog from './ExportDialog.vue'

console.log('[ContentArea] Component loaded')

const tabStore = useTabStore()
const settingsStore = useSettingsStore()

console.log('[ContentArea] Stores obtained, tabStore:', !!tabStore, 'settingsStore:', !!settingsStore)

const contentRef = ref<HTMLElement | null>(null)
const containerRef = ref<HTMLElement | null>(null)
const exportDialogRef = ref<InstanceType<typeof ExportDialog> | null>(null)
const renderedContent = ref('')
const slideMode = ref(false)
const currentSlide = ref(0)

const zoom = computed(() => settingsStore.currentZoom / 100)
const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window

const slides = computed(() => splitMarkdownSlides(tabStore.activeContent))
const hasSlides = computed(() => slides.value.length > 1)

// 查找功能
const { 
  findText, 
  closeFind, 
  findBoxVisible,
  matchCount,
  currentIndex,
  searchQuery,
  caseSensitive,
  useRegex
} = useFind(containerRef)

console.log('[ContentArea] useFind initialized')

// 渲染内容
async function renderContent() {
  console.log('[ContentArea] renderContent called, activeTab:', !!tabStore.activeTab, 'activeContent length:', tabStore.activeContent.length)
  
  if (!tabStore.activeTab) {
    console.log('[ContentArea] No active tab, showing placeholder')
    renderedContent.value = '<p style="color: var(--text-secondary);">打开一个 Markdown 文件开始阅读</p>'
    return
  }

  try {
    console.log('[ContentArea] Rendering markdown...')
    const source = slideMode.value && hasSlides.value
      ? slides.value[currentSlide.value] || slides.value[0]
      : tabStore.activeContent
    let html = renderMarkdown(source)
    html = await renderMermaidCode(html)
    html = renderPlantUmlCode(html, settingsStore.settings.plantUmlServer)
    html = await resolveLocalImageSources(html, tabStore.activeTab.path)
    renderedContent.value = html
    console.log('[ContentArea] Content rendered, length:', renderedContent.value.length)
    
    // 渲染完成后重新绑定链接处理器
    await nextTick()
    if (contentRef.value) {
      detachLinkHandler(contentRef.value)
      attachLinkHandler(contentRef.value)
    }
  } catch (e) {
    console.error('[ContentArea] Render error:', e)
    renderedContent.value = `<p style="color: var(--danger-color);">渲染错误: ${e}</p>`
  }
}

function splitMarkdownSlides(content: string): string[] {
  const parts = content.split(/^---\s*$/m).map(part => part.trim()).filter(Boolean)
  return parts.length > 1 ? parts : [content]
}

async function resolveLocalImageSources(html: string, documentPath: string): Promise<string> {
  if (!isTauri || !documentPath) return html

  try {
    const { convertFileSrc } = await import('@tauri-apps/api/core')
    const parser = new DOMParser()
    const doc = parser.parseFromString(html, 'text/html')
    const baseDir = documentPath.replace(/\\/g, '/').replace(/\/[^/]*$/, '')

    doc.querySelectorAll('img').forEach(img => {
      const src = img.getAttribute('src') || ''
      if (!src || src.startsWith('#') || /^[a-z][a-z0-9+.-]*:/i.test(src)) return

      const normalizedSrc = src.replace(/\\/g, '/')
      const filePath = /^[A-Za-z]:\//.test(normalizedSrc)
        ? normalizedSrc
        : `${baseDir}/${normalizedSrc}`
      img.setAttribute('src', convertFileSrc(filePath))
    })

    return doc.body.innerHTML
  } catch (e) {
    console.error('[ContentArea] Failed to resolve local images:', e)
    return html
  }
}

// 监听内容变化
watch(() => tabStore.activeContent, () => {
  console.log('[ContentArea] Watch: activeContent changed')
  currentSlide.value = 0
  renderContent()
}, { immediate: true })

watch(() => tabStore.activeTabId, () => {
  console.log('[ContentArea] Watch: activeTabId changed to:', tabStore.activeTabId)
  currentSlide.value = 0
  renderContent()
})

watch([slideMode, currentSlide], () => {
  renderContent()
})

// 应用缩放
function applyZoom() {
  console.log('[ContentArea] applyZoom called, zoom:', zoom.value)
  if (contentRef.value) {
    contentRef.value.style.transform = `scale(${zoom.value})`
    contentRef.value.style.transformOrigin = 'top left'
  }
}

watch(zoom, applyZoom, { immediate: true })

// 处理拖拽
async function handleDrop(e: DragEvent) {
  e.preventDefault()
  
  if (e.dataTransfer?.files && e.dataTransfer.files.length > 0) {
    const file = e.dataTransfer.files[0]
    // Tauri 文件对象有 path 属性
    const filePath = (file as File & { path?: string }).path
    console.log('[ContentArea] Drop event, file path:', filePath)
    if (filePath) {
      await tabStore.openFile(filePath)
    }
  }
}

function handleDragOver(e: DragEvent) {
  e.preventDefault()
}

// 快捷键
function handleKeydown(e: KeyboardEvent) {
  if (slideMode.value && hasSlides.value) {
    if (e.key === 'ArrowRight' || e.key === 'PageDown' || e.key === ' ') {
      e.preventDefault()
      nextSlide()
      return
    }
    if (e.key === 'ArrowLeft' || e.key === 'PageUp') {
      e.preventDefault()
      prevSlide()
      return
    }
    if (e.key === 'Escape') {
      e.preventDefault()
      slideMode.value = false
      return
    }
  }

  if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
    e.preventDefault()
    findText()
  }
  
  if ((e.ctrlKey || e.metaKey) && (e.key === '+' || e.key === '=')) {
    e.preventDefault()
    settingsStore.increaseZoom()
  }
  
  if ((e.ctrlKey || e.metaKey) && e.key === '-') {
    e.preventDefault()
    settingsStore.decreaseZoom()
  }
  
  if ((e.ctrlKey || e.metaKey) && e.key === '0') {
    e.preventDefault()
    settingsStore.resetZoom()
  }
}

onMounted(async () => {
  console.log('[ContentArea] onMounted started')
  console.log('[ContentArea] containerRef:', containerRef.value)
  console.log('[ContentArea] contentRef:', contentRef.value)
  
  initCodeCopy()
  applyZoom()
  
  document.addEventListener('keydown', handleKeydown)
  
  if (containerRef.value) {
    containerRef.value.addEventListener('drop', handleDrop)
    containerRef.value.addEventListener('dragover', handleDragOver)
  }
  
  // 为内容区域添加链接点击处理
  if (contentRef.value) {
    attachLinkHandler(contentRef.value)
  }
  
  console.log('[ContentArea] onMounted completed')
})

onBeforeUnmount(() => {
  console.log('[ContentArea] onBeforeUnmount')
  document.removeEventListener('keydown', handleKeydown)
  
  if (contentRef.value) {
    detachLinkHandler(contentRef.value)
  }
})

// 打开文件
async function openFile() {
  console.log('[ContentArea] openFile called')
  if (!isTauri) {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.md,.markdown,text/markdown,text/plain'
    input.onchange = async () => {
      const file = input.files?.[0]
      if (!file) return
      const content = await file.text()
      await tabStore.setVirtualWorkspace('browser-files', [{ path: `browser-files/${file.name}`, content }])
    }
    input.click()
    return
  }

  const dialog = await import('@tauri-apps/plugin-dialog')
  const path = await dialog.open({
    filters: [
      { name: 'Markdown', extensions: ['md', 'markdown'] }
    ],
    multiple: false
  })
  
  if (path) {
    console.log('[ContentArea] Opening file:', path)
    await tabStore.openFile(path)
  }
}

function openExportDialog() {
  exportDialogRef.value?.open()
}

function toggleSlideMode() {
  if (!hasSlides.value) return
  slideMode.value = !slideMode.value
  currentSlide.value = 0
}

function nextSlide() {
  if (!hasSlides.value) return
  currentSlide.value = Math.min(currentSlide.value + 1, slides.value.length - 1)
}

function prevSlide() {
  if (!hasSlides.value) return
  currentSlide.value = Math.max(currentSlide.value - 1, 0)
}
</script>

<template>
  <div 
    ref="containerRef"
    class="content-area"
    :class="{ 'find-active': findBoxVisible }"
  >
    <div class="content-wrapper">
      <div 
        ref="contentRef"
        class="markdown-content"
        :class="{ 'slide-mode': slideMode }"
        v-html="renderedContent"
      ></div>
    </div>
    <div v-if="slideMode && hasSlides" class="slide-controls">
      <button @click="prevSlide" :disabled="currentSlide === 0">上一页</button>
      <span>{{ currentSlide + 1 }} / {{ slides.length }}</span>
      <button @click="nextSlide" :disabled="currentSlide === slides.length - 1">下一页</button>
      <button @click="slideMode = false">退出</button>
    </div>
    
    <!-- 查找框 -->
    <div v-if="findBoxVisible" class="find-box">
      <input
        v-model="searchQuery"
        type="text"
        placeholder="查找..."
        @keyup.enter="findText"
      />
      <label class="checkbox">
        <input type="checkbox" v-model="caseSensitive" />
        区分大小写
      </label>
      <label class="checkbox">
        <input type="checkbox" v-model="useRegex" />
        正则表达式
      </label>
      <button @click="findText" :disabled="!searchQuery">查找</button>
      <button @click="closeFind" class="secondary">关闭</button>
      <span class="match-info">{{ currentIndex + 1 }} / {{ matchCount }}</span>
    </div>
    
    <!-- 工具栏 -->
    <div class="content-toolbar">
      <button @click="openFile" title="打开文件 (Ctrl+O)">
        📂 打开
      </button>
      <button @click="settingsStore.increaseZoom" title="放大 (Ctrl+)">
        🔲
      </button>
      <button @click="settingsStore.decreaseZoom" title="缩小 (Ctrl-)">
        🔳
      </button>
      <button @click="settingsStore.resetZoom" title="重置缩放 (Ctrl+0)">
        {{ settingsStore.currentZoom }}%
      </button>
      <button @click="findText" title="查找 (Ctrl+F)">
        🔍
      </button>
      <button @click="openExportDialog" title="导出 HTML/PDF">
        导出
      </button>
      <button
        :disabled="!hasSlides"
        @click="toggleSlideMode"
        title="幻灯片模式"
      >
        幻灯片
      </button>
      <button @click="settingsStore.toggleTheme" title="切换主题">
        {{ settingsStore.isDark ? '☀️' : '🌙' }}
      </button>
      <button @click="settingsStore.openSettings" title="设置">
        ⚙️
      </button>
    </div>

    <ExportDialog ref="exportDialogRef" :rendered-html="renderedContent" />
  </div>
</template>

<style scoped>
.content-area {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: var(--content-bg);
  position: relative;
}

.content-wrapper {
  flex: 1;
  overflow: auto;
  padding: 32px 48px;
}

.markdown-content {
  max-width: 800px;
  margin: 0 auto;
  line-height: 1.8;
  font-size: v-bind('settingsStore.settings.fontSize + "px"');
  color: var(--text-primary);
}

.markdown-content :deep(h1) {
  font-size: 2.5em;
  margin: 1em 0 0.5em;
  padding-bottom: 0.3em;
  border-bottom: 2px solid var(--border-color);
}

.markdown-content :deep(h2) {
  font-size: 2em;
  margin: 1em 0 0.5em;
  padding-bottom: 0.2em;
  border-bottom: 1px solid var(--border-color);
}

.markdown-content :deep(h3) {
  font-size: 1.5em;
  margin: 1em 0 0.5em;
}

.markdown-content :deep(h4),
.markdown-content :deep(h5),
.markdown-content :deep(h6) {
  margin: 0.8em 0 0.4em;
}

.markdown-content :deep(p) {
  margin: 1em 0;
}

.markdown-content :deep(code) {
  background: var(--code-bg);
  padding: 0.2em 0.4em;
  border-radius: 4px;
  font-family: 'Fira Code', 'Consolas', monospace;
  font-size: 0.9em;
}

.markdown-content :deep(pre) {
  background: var(--code-bg);
  padding: 1em;
  border-radius: 8px;
  overflow-x: auto;
  margin: 1em 0;
}

.markdown-content :deep(pre code) {
  background: none;
  padding: 0;
}

.markdown-content :deep(ul),
.markdown-content :deep(ol) {
  margin: 1em 0;
  padding-left: 2em;
}

.markdown-content :deep(li) {
  margin: 0.5em 0;
}

.markdown-content :deep(blockquote) {
  border-left: 4px solid var(--primary-color);
  padding-left: 1em;
  margin: 1em 0;
  color: var(--text-secondary);
  background: var(--blockquote-bg);
  padding: 0.5em 1em;
  border-radius: 0 8px 8px 0;
}

.markdown-content :deep(table) {
  border-collapse: collapse;
  width: 100%;
  margin: 1em 0;
}

.markdown-content :deep(th),
.markdown-content :deep(td) {
  border: 1px solid var(--border-color);
  padding: 0.5em 1em;
  text-align: left;
}

.markdown-content :deep(th) {
  background: var(--table-header-bg);
  font-weight: 600;
}

.markdown-content :deep(img) {
  max-width: 100%;
  border-radius: 8px;
  margin: 1em 0;
}

.markdown-content.slide-mode {
  min-height: calc(100vh - 180px);
  padding: 48px;
  border: 1px solid var(--border-color);
  border-radius: 16px;
  box-shadow: var(--shadow-lg);
  background: var(--content-bg);
}

.markdown-content :deep(a) {
  color: var(--primary-color);
  text-decoration: none;
}

.markdown-content :deep(a:hover) {
  text-decoration: underline;
}

.markdown-content :deep(hr) {
  border: none;
  border-top: 1px solid var(--border-color);
  margin: 2em 0;
}

.markdown-content :deep(.hljs) {
  background: var(--code-bg);
}

.markdown-content :deep(.code-header) {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0.5em 1em;
  background: var(--code-header-bg);
  border-radius: 8px 8px 0 0;
  border-bottom: 1px solid var(--border-color);
}

.markdown-content :deep(.language-label) {
  font-size: 0.85em;
  color: var(--text-secondary);
}

.markdown-content :deep(.copy-btn) {
  background: transparent;
  border: 1px solid var(--border-color);
  padding: 4px 8px;
  border-radius: 4px;
  cursor: pointer;
  font-size: 0.85em;
  color: var(--text-secondary);
}

.markdown-content :deep(.copy-btn:hover) {
  background: var(--sidebar-hover);
  color: var(--text-primary);
}

.markdown-content :deep(.mermaid) {
  margin: 1em 0;
}

.markdown-content :deep(.mermaid-error) {
  background: var(--danger-bg);
  color: var(--danger-color);
  padding: 1em;
  border-radius: 8px;
  text-align: center;
}

.markdown-content :deep(.plantuml-diagram) {
  margin: 1em 0;
  text-align: center;
}

.markdown-content :deep(.search-highlight) {
  background: #fef08a;
  color: #111827;
  padding: 2px;
  border-radius: 3px;
}

.markdown-content :deep(.search-highlight.active) {
  background: #f97316;
  color: #ffffff;
}

.slide-controls {
  position: absolute;
  bottom: 64px;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border: 1px solid var(--border-color);
  border-radius: 999px;
  background: var(--find-box-bg);
  box-shadow: var(--shadow-md);
  z-index: 20;
}

.slide-controls button {
  padding: 6px 10px;
  border: 1px solid var(--border-color);
  border-radius: 999px;
  background: var(--content-bg);
  color: var(--text-primary);
}

.find-box {
  position: absolute;
  top: 16px;
  right: 16px;
  background: var(--find-box-bg);
  border: 1px solid var(--border-color);
  border-radius: 8px;
  padding: 8px;
  display: flex;
  align-items: center;
  gap: 8px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  z-index: 1000;
}

.find-box input {
  flex: 1;
  padding: 6px 12px;
  border: 1px solid var(--border-color);
  border-radius: 6px;
  font-size: 14px;
  background: var(--content-bg);
}

.find-box .checkbox {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  color: var(--text-secondary);
  white-space: nowrap;
}

.find-box button {
  padding: 6px 12px;
  background: var(--primary-color);
  border: none;
  border-radius: 6px;
  color: white;
  cursor: pointer;
  font-size: 13px;
}

.find-box button.secondary {
  background: transparent;
  border: 1px solid var(--border-color);
  color: var(--text-secondary);
}

.find-box button:hover:not(:disabled) {
  opacity: 0.8;
}

.find-box button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.find-box .match-info {
  font-size: 12px;
  color: var(--text-secondary);
  min-width: 50px;
  text-align: right;
}

.content-toolbar {
  display: flex;
  gap: 8px;
  padding: 8px 16px;
  background: var(--toolbar-bg);
  border-bottom: 1px solid var(--border-color);
}

.content-toolbar button {
  padding: 6px 12px;
  background: transparent;
  border: 1px solid transparent;
  border-radius: 6px;
  cursor: pointer;
  font-size: 13px;
  color: var(--text-secondary);
  transition: all 0.15s ease;
}

.content-toolbar button:hover {
  background: var(--sidebar-hover);
  border-color: var(--border-color);
  color: var(--text-primary);
}
</style>
