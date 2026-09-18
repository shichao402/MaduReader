// Use dynamic import to allow mocking in tests
let mermaidInstance: any = null

async function getMermaid(): Promise<any> {
  if (!mermaidInstance) {
    // Check if we're in a browser environment
    if (typeof window !== 'undefined' && typeof window.document !== 'undefined') {
      try {
        mermaidInstance = (await import('mermaid')).default
      } catch (e) {
        console.warn('Mermaid could not be loaded:', e)
        mermaidInstance = {
          initialize: async () => {},
          render: async () => ({ svg: '' })
        }
      }
    } else {
      // Non-browser environment, return a stub
      mermaidInstance = {
        initialize: async () => {},
        render: async () => ({ svg: '' })
      }
    }
  }
  return mermaidInstance
}

export interface MermaidDiagram {
  id: string
  code: string
  type: string
  svg?: string
}

let initialized = false
let renderCounter = 0

function nextMermaidId(): string {
  renderCounter += 1
  return `mermaid-${Date.now()}-${renderCounter}`
}

export async function initMermaid(): Promise<void> {
  if (initialized) return

  try {
    const mermaid = await getMermaid()
    await mermaid.initialize({
      startOnLoad: false,
      theme: 'default',
      securityLevel: 'loose',
      logLevel: 'error',
      fontFamily: 'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
      themeVariables: {
        primaryColor: '#e3f2fd',
        primaryTextColor: '#1565c0',
        primaryBorderColor: '#90caf9',
        lineColor: '#78909c',
        secondaryColor: '#f3e5f5',
        tertiaryColor: '#e0f2f1'
      }
    })
    initialized = true
  } catch (e) {
    console.error('Failed to initialize mermaid:', e)
    throw e
  }
}

export async function renderMermaidCode(html: string): Promise<string> {
  await initMermaid()
  
  const parser = new DOMParser()
  const doc = parser.parseFromString(html, 'text/html')
  
  const codeBlocks = doc.querySelectorAll('pre code.language-mermaid, pre code[class*="mermaid"]')
  
  const mermaid = await getMermaid()
  
  for (const code of codeBlocks) {
    const pre = code.parentElement
    if (!pre) continue
    
    const codeContent = code.textContent || ''
    
    try {
      const { svg } = await mermaid.render(nextMermaidId(), codeContent)
      const svgElement = parser.parseFromString(svg, 'text/html').body.firstChild
      if (svgElement) {
        pre.replaceWith(svgElement)
      }
    } catch (e) {
      console.error('Mermaid render error:', e)
      pre.innerHTML = `<div class="mermaid-error">图表渲染失败: ${e}</div>`
    }
  }
  
  return doc.body.innerHTML
}

export async function renderMermaidElement(element: Element): Promise<void> {
  await initMermaid()
  
  const code = element.querySelector('code')
  if (!code) return
  
  const codeContent = code.textContent || ''
  
  const mermaid = await getMermaid()
  
  try {
    const { svg } = await mermaid.render(nextMermaidId(), codeContent)
    const parser = new DOMParser()
    const svgElement = parser.parseFromString(svg, 'text/html').body.firstChild
    if (svgElement) {
      element.replaceWith(svgElement)
    }
  } catch (e) {
    console.error('Mermaid render error:', e)
    element.innerHTML = `<div class="mermaid-error">图表渲染失败</div>`
  }
}

export async function renderAllMermaid(): Promise<void> {
  await initMermaid()
  
  const elements = document.querySelectorAll('pre code.language-mermaid, pre code[class*="mermaid"]')
  
  const mermaid = await getMermaid()
  
  for (const code of elements) {
    const pre = code.parentElement
    if (!pre) continue
    
    const codeContent = code.textContent || ''
    
    try {
      const { svg } = await mermaid.render(nextMermaidId(), codeContent)
      const parser = new DOMParser()
      const svgElement = parser.parseFromString(svg, 'text/html').body.firstChild
      if (svgElement) {
        pre.replaceWith(svgElement)
      }
    } catch (e) {
      console.error('Mermaid render error:', e)
      pre.innerHTML = `<div class="mermaid-error">图表渲染失败</div>`
    }
  }
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
