// Use dynamic import to allow mocking in tests
let mermaidInstance: any = null
let loadingMermaid: Promise<any> | null = null

async function getMermaid(): Promise<any> {
  if (mermaidInstance) return mermaidInstance
  if (!loadingMermaid) {
    loadingMermaid = (async () => {
      if (typeof window !== 'undefined' && typeof window.document !== 'undefined') {
        try {
          return (await import('mermaid')).default
        } catch (e) {
          console.warn('Mermaid could not be loaded:', e)
        }
      }
      return {
        initialize: async () => {},
        render: async () => ({ svg: '' }),
      }
    })()
  }
  mermaidInstance = await loadingMermaid
  return mermaidInstance
}

export interface MermaidDiagram {
  id: string
  code: string
  type: string
  svg?: string
}

export interface MermaidRenderOptions {
  dark?: boolean
  // The existing default setting now follows the reader's effective theme.
  theme?: string
}

let initializedTheme = ''
let renderCounter = 0
let renderQueue: Promise<unknown> = Promise.resolve()

// Mermaid owns global configuration. Keep initialization and a complete render batch atomic.
function enqueueRender<T>(work: () => Promise<T>): Promise<T> {
  const result = renderQueue.then(work)
  renderQueue = result.catch(() => {})
  return result
}

function resolveTheme(options: MermaidRenderOptions): string {
  const selected = options.theme ?? 'default'
  if (['base', 'dark', 'forest', 'neutral'].includes(selected)) return selected
  const dark = options.dark ?? document.documentElement.classList.contains('dark')
  return dark ? 'dark' : 'default'
}

function nextMermaidId(): string {
  renderCounter += 1
  return `mermaid-${Date.now()}-${renderCounter}`
}

function adoptMermaidSvg(svg: string, owner: Document, theme: string): Element | null {
  const parsed = new DOMParser().parseFromString(svg, 'text/html')
  const found = parsed.body.querySelector('svg')
  if (!found) return null
  const svgElement = owner.importNode(found, true)
  svgElement.classList.add('mermaid-svg')
  svgElement.setAttribute('data-diagram-theme', theme === 'dark' ? 'dark' : 'light')
  return svgElement
}

async function configureMermaid(theme: string): Promise<void> {
  if (initializedTheme === theme) return
  try {
    const mermaid = await getMermaid()
    await mermaid.initialize({
      startOnLoad: false,
      theme,
      securityLevel: 'loose',
      logLevel: 'error',
      fontFamily: 'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
      // Do not carry light-only overrides into Mermaid's complete dark palette.
      themeVariables: theme === 'default' ? {
        background: '#fafaf9',
        primaryColor: '#e3f2fd',
        primaryTextColor: '#1565c0',
        primaryBorderColor: '#90caf9',
        lineColor: '#78909c',
        secondaryColor: '#f3e5f5',
        tertiaryColor: '#e0f2f1',
      } : { background: theme === 'dark' ? '#1c1917' : '#fafaf9' },
    })
    initializedTheme = theme
  } catch (e) {
    console.error('Failed to initialize mermaid:', e)
    throw e
  }
}

export function initMermaid(options: MermaidRenderOptions = {}): Promise<void> {
  const theme = resolveTheme(options)
  return enqueueRender(() => configureMermaid(theme))
}

export function renderMermaidCode(html: string, options: MermaidRenderOptions = {}): Promise<string> {
  const theme = resolveTheme(options)
  return enqueueRender(async () => {
    const parser = new DOMParser()
    const doc = parser.parseFromString(html, 'text/html')
    const codeBlocks = doc.querySelectorAll('pre code.language-mermaid, pre code[class*="mermaid"]')
    if (codeBlocks.length === 0) return html
    await configureMermaid(theme)
    const mermaid = await getMermaid()
    for (const code of codeBlocks) {
      const pre = code.parentElement
      if (!pre) continue
      try {
        const { svg } = await mermaid.render(nextMermaidId(), code.textContent || '')
        const svgElement = adoptMermaidSvg(svg, doc, theme)
        if (svgElement) pre.replaceWith(svgElement)
      } catch (e) {
        console.error('Mermaid render error:', e)
        const error = doc.createElement('div')
        error.className = 'mermaid-error'
        error.textContent = `图表渲染失败: ${e}`
        pre.replaceChildren(error)
      }
    }
    return doc.body.innerHTML
  })
}

export function renderMermaidElement(element: Element, options: MermaidRenderOptions = {}): Promise<void> {
  const theme = resolveTheme(options)
  return enqueueRender(async () => {
    const code = element.querySelector('code')
    if (!code) return
    await configureMermaid(theme)
    const mermaid = await getMermaid()
    try {
      const { svg } = await mermaid.render(nextMermaidId(), code.textContent || '')
      const svgElement = adoptMermaidSvg(svg, element.ownerDocument, theme)
      if (svgElement) element.replaceWith(svgElement)
    } catch (e) {
      console.error('Mermaid render error:', e)
      element.innerHTML = '<div class="mermaid-error">图表渲染失败</div>'
    }
  })
}

export function renderAllMermaid(options: MermaidRenderOptions = {}): Promise<void> {
  const theme = resolveTheme(options)
  return enqueueRender(async () => {
    const elements = document.querySelectorAll('pre code.language-mermaid, pre code[class*="mermaid"]')
    if (elements.length === 0) return
    await configureMermaid(theme)
    const mermaid = await getMermaid()
    for (const code of elements) {
      const pre = code.parentElement
      if (!pre) continue
      try {
        const { svg } = await mermaid.render(nextMermaidId(), code.textContent || '')
        const svgElement = adoptMermaidSvg(svg, document, theme)
        if (svgElement) pre.replaceWith(svgElement)
      } catch (e) {
        console.error('Mermaid render error:', e)
        pre.innerHTML = '<div class="mermaid-error">图表渲染失败</div>'
      }
    }
  })
}

export function isMermaidCode(code: string): boolean {
  const trimmed = code.trim()
  return trimmed.startsWith('```mermaid') ||
         trimmed.includes('flowchart') ||
         trimmed.includes('sequenceDiagram') ||
         trimmed.includes('classDiagram') ||
         trimmed.includes('stateDiagram') ||
         trimmed.includes('gantt') ||
         trimmed.includes('pie')
}

export function getMermaidType(code: string): string {
  const trimmed = code.trim()
  if (trimmed.includes('flowchart')) return 'flowchart'
  if (trimmed.includes('sequenceDiagram')) return 'sequenceDiagram'
  if (trimmed.includes('classDiagram')) return 'classDiagram'
  if (trimmed.includes('stateDiagram')) return 'stateDiagram'
  if (trimmed.includes('gantt')) return 'gantt'
  if (trimmed.includes('pie')) return 'pie'
  return 'flowchart'
}
