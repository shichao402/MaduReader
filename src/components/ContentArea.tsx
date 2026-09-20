import { useEffect, useMemo, useRef, useState, useCallback } from 'react'
import { FolderOpen, ZoomIn, ZoomOut, Search, Download, Presentation, Sun, Moon, Settings, BookOpen, Command } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { getTabStore, getSettingsStore, useStores } from '../hooks/useStores'
import { renderMarkdown, initCodeCopy } from '../composables/useMarkdown'
import { renderMermaidCode } from '../composables/useMermaid'
import { renderPlantUmlCode } from '../composables/usePlantUml'
import { attachLinkHandler, detachLinkHandler } from '../composables/useLinkHandler'
import ExportDialog from './ExportDialog'
import { cn } from '../lib/utils'

const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window

function splitMarkdownSlides(content: string): string[] {
  const parts = content.split(/^---\s*$/m).map((part) => part.trim()).filter(Boolean)
  return parts.length > 1 ? parts : [content]
}

async function resolveLocalImageSources(html: string, documentPath: string): Promise<string> {
  if (!isTauri || !documentPath) return html
  try {
    const { convertFileSrc } = await import('@tauri-apps/api/core')
    const parser = new DOMParser()
    const doc = parser.parseFromString(html, 'text/html')
    const baseDir = documentPath.replace(/\\/g, '/').replace(/\/[^/]*$/, '')
    doc.querySelectorAll('img').forEach((img) => {
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

export default function ContentArea({
  onOpenSettings,
}: {
  onOpenSettings: () => void
}) {
  const { snapshot } = useStores()
  const containerRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const [renderedContent, setRenderedContent] = useState('')
  const [slideMode, setSlideMode] = useState(false)
  const [currentSlide, setCurrentSlide] = useState(0)
  const [exportOpen, setExportOpen] = useState(false)
  const [isEmpty, setIsEmpty] = useState(true)

  const zoom = (snapshot.currentZoom ?? 100) / 100
  const slides = useMemo(
    () => splitMarkdownSlides(snapshot.activeContent ?? ''),
    [snapshot.activeContent],
  )
  const hasSlides = slides.length > 1

  const {
    findText,
    closeFind,
    findBoxVisible,
    matchCount,
    currentIndex,
    searchQuery,
    setSearchQuery,
    caseSensitive,
    setCaseSensitive,
    useRegex,
    setUseRegex,
  } = useFindAdapter(containerRef)

  // 渲染管线：内容变化 → markdown → mermaid → plantuml → 本地图片
  useEffect(() => {
    let cancelled = false
    async function render() {
      const tabStore = getTabStore()
      const settingsStore = getSettingsStore()
      if (!tabStore.activeTab || !tabStore.activeContent) {
        setIsEmpty(true)
        setRenderedContent('')
        return
      }
      setIsEmpty(false)
      try {
        const source =
          slideMode && hasSlides
            ? slides[currentSlide] || slides[0]
            : tabStore.activeContent
        let html = renderMarkdown(source)
        html = await renderMermaidCode(html)
        html = renderPlantUmlCode(html, settingsStore.settings.plantUmlServer)
        html = await resolveLocalImageSources(html, tabStore.activeTab.path)
        if (!cancelled) setRenderedContent(html)
      } catch (e) {
        console.error('[ContentArea] Render error:', e)
        if (!cancelled)
          setRenderedContent(`<p style="color: var(--color-danger);">渲染错误: ${e}</p>`)
      }
    }
    render()
    return () => {
      cancelled = true
    }
  }, [snapshot.activeContent, slideMode, currentSlide, hasSlides, slides])

  // 渲染完成后重新绑定链接处理
  useEffect(() => {
    if (!contentRef.current) return
    const el = contentRef.current
    detachLinkHandler(el)
    attachLinkHandler(el)
  }, [renderedContent])

  // 缩放
  useEffect(() => {
    if (contentRef.current) {
      contentRef.current.style.transform = `scale(${zoom})`
      contentRef.current.style.transformOrigin = 'top left'
    }
  }, [zoom])

  // 快捷键
  useEffect(() => {
    function handleKeydown(e: KeyboardEvent) {
      const settingsStore = getSettingsStore()
      if (slideMode && hasSlides) {
        if (e.key === 'ArrowRight' || e.key === 'PageDown' || e.key === ' ') {
          e.preventDefault()
          setCurrentSlide((s) => Math.min(s + 1, slides.length - 1))
          return
        }
        if (e.key === 'ArrowLeft' || e.key === 'PageUp') {
          e.preventDefault()
          setCurrentSlide((s) => Math.max(s - 1, 0))
          return
        }
        if (e.key === 'Escape') {
          e.preventDefault()
          setSlideMode(false)
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
    document.addEventListener('keydown', handleKeydown)
    return () => document.removeEventListener('keydown', handleKeydown)
  }, [slideMode, hasSlides, slides.length, findText])

  // 幻灯片/页切换时重置页码
  useEffect(() => {
    setCurrentSlide(0)
  }, [snapshot.activeTabId])

  // 命令面板事件总线：open file / find / export / slideshow / scroll-to-heading
  useEffect(() => {
    const onOpenFile = () => void openFile()
    const onFind = () => findText()
    const onExport = () => setExportOpen(true)
    const onSlideshow = () => toggleSlideMode()
    const onScrollHeading = (e: Event) => {
      const detail = (e as CustomEvent<{ index: number; text?: string }>).detail
      if (!contentRef.current || !detail) return
      const headings = Array.from(
        contentRef.current.querySelectorAll('h1, h2, h3, h4, h5, h6'),
      )
      const target =
        headings.find((h) => h.textContent === detail.text) ?? headings[detail.index]
      if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
    document.addEventListener('trigger-open-file', onOpenFile)
    document.addEventListener('trigger-find', onFind)
    document.addEventListener('trigger-export', onExport)
    document.addEventListener('trigger-slideshow', onSlideshow)
    document.addEventListener('scroll-to-heading', onScrollHeading)
    return () => {
      document.removeEventListener('trigger-open-file', onOpenFile)
      document.removeEventListener('trigger-find', onFind)
      document.removeEventListener('trigger-export', onExport)
      document.removeEventListener('trigger-slideshow', onSlideshow)
      document.removeEventListener('scroll-to-heading', onScrollHeading)
    }
  }, [findText])

  useEffect(() => {
    if (!hasSlides) setSlideMode(false)
  }, [hasSlides])

  // 初始化代码复制 + 拖拽
  useEffect(() => {
    initCodeCopy()
    const container = containerRef.current
    if (!container) return
    const handleDrop = async (e: DragEvent) => {
      e.preventDefault()
      const file = e.dataTransfer?.files?.[0]
      const filePath = (file as File & { path?: string })?.path
      if (filePath) {
        getTabStore().openFile(filePath)
      }
    }
    const handleDragOver = (e: DragEvent) => e.preventDefault()
    container.addEventListener('drop', handleDrop)
    container.addEventListener('dragover', handleDragOver)
    return () => {
      container.removeEventListener('drop', handleDrop)
      container.removeEventListener('dragover', handleDragOver)
    }
  }, [])

  async function openFile() {
    const tabStore = getTabStore()
    if (!isTauri) {
      const input = document.createElement('input')
      input.type = 'file'
      input.accept = '.md,.markdown,text/markdown,text/plain'
      input.onchange = async () => {
        const file = input.files?.[0]
        if (!file) return
        const content = await file.text()
        await tabStore.setVirtualWorkspace('browser-files', [
          { path: `browser-files/${file.name}`, content },
        ])
      }
      input.click()
      return
    }
    const dialog = await import('@tauri-apps/plugin-dialog')
    const path = await dialog.open({
      filters: [{ name: 'Markdown', extensions: ['md', 'markdown'] }],
      multiple: false,
    })
    if (path) {
      await tabStore.openFile(path as string)
    }
  }

  function toggleSlideMode() {
    if (!hasSlides) return
    setSlideMode((v) => !v)
    setCurrentSlide(0)
  }

  const toolBtn =
    'flex items-center gap-1.5 px-3 py-1.5 text-[13px] rounded-md bg-transparent border border-transparent text-[color:var(--color-text-secondary)] hover:bg-[color:var(--color-sidebar-hover)] hover:border-[color:var(--color-border-base)] hover:text-[color:var(--color-text-primary)] transition-colors disabled:opacity-50 disabled:cursor-not-allowed'

  return (
    <div
      ref={containerRef}
      className="surface-content flex-1 flex flex-col overflow-hidden bg-[color:var(--color-content)] relative"
    >
      {/* 工具栏（顶部） */}
      <div className="surface-toolbar flex gap-1 items-center px-3 py-1.5 bg-[color:var(--color-toolbar)] border-b border-[color:var(--color-border-base)]">
        <button className={toolBtn} onClick={() => window.dispatchEvent(new Event('open-command-palette'))} title="命令面板 (Ctrl+K)" data-kbd="Ctrl K">
          <Command size={15} />
        </button>
        <div className="w-px h-5 bg-[color:var(--color-border-base)] mx-1" />
        <button className={toolBtn} onClick={openFile} title="打开文件 (Ctrl+O)" data-kbd="Ctrl O">
          <FolderOpen size={15} />
          打开
        </button>
        <div className="w-px h-5 bg-[color:var(--color-border-base)] mx-1" />
        <button
          className={toolBtn}
          onClick={() => getSettingsStore().increaseZoom()}
          title="放大 (Ctrl+=)"
          data-kbd="Ctrl ="
        >
          <ZoomIn size={15} />
        </button>
        <button
          className={toolBtn}
          onClick={() => getSettingsStore().decreaseZoom()}
          title="缩小 (Ctrl+-)"
          data-kbd="Ctrl -"
        >
          <ZoomOut size={15} />
        </button>
        <button
          className={toolBtn}
          onClick={() => getSettingsStore().resetZoom()}
          title="重置缩放 (Ctrl+0)"
          data-kbd="Ctrl 0"
        >
          {snapshot.currentZoom}%
        </button>
        <div className="w-px h-5 bg-[color:var(--color-border-base)] mx-1" />
        <button className={toolBtn} onClick={findText} title="查找 (Ctrl+F)" data-kbd="Ctrl F">
          <Search size={15} />
        </button>
        <button className={toolBtn} onClick={() => setExportOpen(true)} title="导出 HTML/PDF">
          <Download size={15} />
          导出
        </button>
        <button
          className={toolBtn}
          disabled={!hasSlides}
          onClick={toggleSlideMode}
          title="幻灯片模式"
        >
          <Presentation size={15} />
          幻灯片
        </button>
        <div className="flex-1" />
        <button
          className={toolBtn}
          onClick={() => getSettingsStore().toggleTheme()}
          title="切换主题"
        >
          {snapshot.isDark ? <Sun size={15} /> : <Moon size={15} />}
        </button>
        <button className={toolBtn} onClick={onOpenSettings} title="设置">
          <Settings size={15} />
        </button>
      </div>

      {/* 内容滚动区 / 空态 */}
      {isEmpty ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-5 p-8 animate-fade-in">
          <div className="w-20 h-20 rounded-2xl bg-[color:var(--color-accent-soft)] dark:bg-[color:var(--color-accent-soft-dark)] flex items-center justify-center shadow-md">
            <BookOpen size={40} className="text-[color:var(--color-accent)]" strokeWidth={1.5} />
          </div>
          <div className="text-center">
            <p className="text-lg font-semibold text-[color:var(--color-text-primary)]">
              打开一个 Markdown 文件开始阅读
            </p>
            <p className="mt-1.5 text-sm text-[color:var(--color-text-secondary)]">
              支持代码高亮、公式、流程图与幻灯片模式
            </p>
          </div>
          <button
            className="flex items-center gap-2 px-5 py-2.5 rounded-lg bg-[color:var(--color-accent)] hover:bg-[color:var(--color-accent-hover)] text-white text-sm font-medium shadow-md transition-colors"
            onClick={openFile}
          >
            <FolderOpen size={16} />
            打开文件
          </button>
          <p className="text-xs text-[color:var(--color-text-tertiary)]">
            也可以将 .md 文件拖拽到窗口
          </p>
        </div>
      ) : (
        <div className="flex-1 overflow-auto p-8 px-12">
          <div
            ref={contentRef}
            className={cn(
              'markdown-content max-w-[800px] mx-auto animate-fade-in',
              slideMode &&
                'min-h-[calc(100vh-180px)] p-12 border border-[color:var(--color-border-base)] rounded-2xl shadow-lg bg-[color:var(--color-content)]',
            )}
            style={{ fontSize: `${snapshot.settings?.fontSize ?? 16}px` }}
            dangerouslySetInnerHTML={{ __html: renderedContent }}
          />
        </div>
      )}

      {/* 幻灯片控制条 */}
      <AnimatePresence>
        {slideMode && hasSlides && (
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 12 }}
            className="absolute bottom-16 left-1/2 -translate-x-1/2 flex items-center gap-2 px-3 py-2 rounded-full border border-[color:var(--color-border-base)] bg-[color:var(--color-find-box)] shadow-md z-20"
          >
            <button
              className="px-2.5 py-1 rounded-full border border-[color:var(--color-border-base)] bg-[color:var(--color-content)] disabled:opacity-50"
              onClick={() => setCurrentSlide((s) => Math.max(s - 1, 0))}
              disabled={currentSlide === 0}
            >
              上一页
            </button>
            <span className="text-sm text-[color:var(--color-text-secondary)]">
              {currentSlide + 1} / {slides.length}
            </span>
            <button
              className="px-2.5 py-1 rounded-full border border-[color:var(--color-border-base)] bg-[color:var(--color-content)] disabled:opacity-50"
              onClick={() => setCurrentSlide((s) => Math.min(s + 1, slides.length - 1))}
              disabled={currentSlide === slides.length - 1}
            >
              下一页
            </button>
            <button
              className="px-2.5 py-1 rounded-full border border-[color:var(--color-border-base)] bg-[color:var(--color-content)]"
              onClick={() => setSlideMode(false)}
            >
              退出
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* 查找框 */}
      <AnimatePresence>
        {findBoxVisible && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            className="absolute top-4 right-4 flex items-center gap-2 p-2 rounded-lg border border-[color:var(--color-border-base)] bg-[color:var(--color-find-box)] shadow-lg z-[1000]"
          >
            <input
              type="text"
              defaultValue={searchQuery}
              key={String(findBoxVisible)}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && findText()}
              placeholder="查找..."
              className="flex-1 min-w-[160px] px-3 py-1.5 text-sm rounded-md border border-[color:var(--color-border-base)] bg-[color:var(--color-content)] focus:outline-none focus:border-[color:var(--color-primary)]"
            />
            <label className="flex items-center gap-1 text-xs whitespace-nowrap text-[color:var(--color-text-secondary)]">
              <input
                type="checkbox"
                checked={caseSensitive}
                onChange={(e) => setCaseSensitive(e.target.checked)}
              />
              区分大小写
            </label>
            <label className="flex items-center gap-1 text-xs whitespace-nowrap text-[color:var(--color-text-secondary)]">
              <input
                type="checkbox"
                checked={useRegex}
                onChange={(e) => setUseRegex(e.target.checked)}
              />
              正则
            </label>
            <button
              className="px-3 py-1.5 text-[13px] rounded-md bg-[color:var(--color-primary)] text-white disabled:opacity-50"
              onClick={findText}
              disabled={!searchQuery}
            >
              查找
            </button>
            <button
              className="px-3 py-1.5 text-[13px] rounded-md border border-[color:var(--color-border-base)] text-[color:var(--color-text-secondary)]"
              onClick={closeFind}
            >
              关闭
            </button>
            <span className="text-xs text-[color:var(--color-text-secondary)] min-w-[48px] text-right">
              {matchCount > 0 ? currentIndex + 1 : 0} / {matchCount}
            </span>
          </motion.div>
        )}
      </AnimatePresence>

      <ExportDialog open={exportOpen} onOpenChange={setExportOpen} renderedHtml={renderedContent} />
    </div>
  )
}

// 适配旧版 useFind（Vue ref 风格）到 React 状态
function useFindAdapter(containerRef: React.RefObject<HTMLDivElement | null>) {
  const [searchQuery, setSearchQuery] = useState('')
  const [caseSensitive, setCaseSensitive] = useState(false)
  const [useRegex, setUseRegex] = useState(false)
  const [findBoxVisible, setFindBoxVisible] = useState(false)
  const [matchCount, setMatchCount] = useState(0)
  const [currentIndex, setCurrentIndex] = useState(-1)
  const matchesRef = useRef<HTMLElement[]>([])

  const clearHighlight = useCallback(() => {
    document.querySelectorAll('.search-highlight').forEach((el) => {
      const text = el.textContent
      const parent = el.parentNode
      if (parent && text) {
        parent.insertBefore(document.createTextNode(text), el)
        parent.removeChild(el)
        parent.normalize()
      }
    })
    matchesRef.current = []
    setMatchCount(0)
    setCurrentIndex(-1)
  }, [])

  const highlightMatch = useCallback((index: number) => {
    if (index < 0 || index >= matchesRef.current.length) return
    matchesRef.current.forEach((m) => m.classList.remove('active'))
    const span = matchesRef.current[index]
    span.classList.add('active')
    span.scrollIntoView({ behavior: 'smooth', block: 'center' })
    window.getSelection()?.removeAllRanges()
  }, [])

  const findText = useCallback(() => {
    setFindBoxVisible(true)
    const container = containerRef.current
    if (!container || !searchQuery) return

    clearHighlight()

    try {
      let regex: RegExp
      if (useRegex) {
        regex = caseSensitive ? new RegExp(searchQuery, 'g') : new RegExp(searchQuery, 'gi')
      } else {
        const escaped = searchQuery.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        regex = caseSensitive ? new RegExp(escaped, 'g') : new RegExp(escaped, 'gi')
      }

      const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, {
        acceptNode: (node) => {
          const tag = node.parentElement?.tagName
          if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'NOSCRIPT') {
            return NodeFilter.FILTER_REJECT
          }
          if (node.parentElement?.closest('svg')) {
            return NodeFilter.FILTER_REJECT
          }
          return NodeFilter.FILTER_ACCEPT
        },
      })

      const textNodes: Text[] = []
      let textNode: Text | null
      while ((textNode = walker.nextNode() as Text)) textNodes.push(textNode)

      const matches: HTMLElement[] = []
      for (const node of textNodes) {
        const nodeText = node.textContent || ''
        const fragment = document.createDocumentFragment()
        let lastIndex = 0
        let foundInNode = false
        let match

        while ((match = regex.exec(nodeText)) !== null) {
          foundInNode = true
          fragment.appendChild(document.createTextNode(nodeText.slice(lastIndex, match.index)))
          const span = document.createElement('span')
          span.className = 'search-highlight'
          span.textContent = match[0]
          fragment.appendChild(span)
          matches.push(span)
          lastIndex = match.index + match[0].length
          if (match[0].length === 0) regex.lastIndex += 1
        }

        if (foundInNode && node.parentNode) {
          fragment.appendChild(document.createTextNode(nodeText.slice(lastIndex)))
          node.parentNode.replaceChild(fragment, node)
        }
      }

      matchesRef.current = matches
      setMatchCount(matches.length)
      if (matches.length > 0) {
        setCurrentIndex(0)
        highlightMatch(0)
      }
    } catch (e) {
      console.error('Search error:', e)
    }
  }, [searchQuery, caseSensitive, useRegex, containerRef, clearHighlight, highlightMatch])

  const closeFind = useCallback(() => {
    setFindBoxVisible(false)
    clearHighlight()
    setSearchQuery('')
  }, [clearHighlight])

  return {
    searchQuery,
    setSearchQuery,
    caseSensitive,
    setCaseSensitive,
    useRegex,
    setUseRegex,
    findBoxVisible,
    matchCount,
    currentIndex,
    findText,
    closeFind,
  }
}
