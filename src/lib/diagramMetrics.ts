import DOMPurify from 'dompurify'

export type MediaSource = 'mermaid' | 'plantuml' | 'image'

export interface DiagramMetrics {
  width: number
  height: number
  labelFontPx?: number
}

export function positive(value: number): boolean {
  return Number.isFinite(value) && value > 0
}

export function absoluteLength(value: string | null): number {
  const match = value?.trim().match(/^(\d+(?:\.\d+)?)(px|pt|pc|in|cm|mm)?$/i)
  if (!match) return 0
  const units: Record<string, number> = { px: 1, pt: 96 / 72, pc: 16, in: 96, cm: 96 / 2.54, mm: 96 / 25.4 }
  return Number(match[1]) * (units[match[2]?.toLowerCase() ?? 'px'] ?? 1)
}

export function svgSize(svg: Element): DiagramMetrics | null {
  const style = (svg as SVGSVGElement).style
  const width = absoluteLength(svg.getAttribute('width')) || absoluteLength(style?.width)
  const height = absoluteLength(svg.getAttribute('height')) || absoluteLength(style?.height)
  if (positive(width) && positive(height)) return { width, height }
  const box = (svg.getAttribute('viewBox') || '').trim().split(/[\s,]+/).map(Number)
  if (box.length === 4 && box.every(Number.isFinite) && positive(box[2]) && positive(box[3])) {
    return { width: box[2], height: box[3] }
  }
  return null
}

export function autoScaleLimit(source: MediaSource, metrics: DiagramMetrics | null, fontSize = 16): number {
  if (source === 'image') return Infinity
  if (!metrics?.labelFontPx || !positive(metrics.labelFontPx)) return 1
  return (positive(fontSize) ? fontSize : 16) * 1.25 / metrics.labelFontPx
}

type Matrix = { a: number; b: number; c: number; d: number }
const IDENTITY: Matrix = { a: 1, b: 0, c: 0, d: 1 }

function multiply(left: Matrix, right: Matrix): Matrix {
  return {
    a: left.a * right.a + left.c * right.b, b: left.b * right.a + left.d * right.b,
    c: left.a * right.c + left.c * right.d, d: left.b * right.c + left.d * right.d,
  }
}

function largestScale(m: Matrix): number {
  const trace = m.a ** 2 + m.b ** 2 + m.c ** 2 + m.d ** 2
  const det = (m.a * m.d - m.b * m.c) ** 2
  return Math.sqrt((trace + Math.sqrt(Math.max(0, trace ** 2 - 4 * det))) / 2)
}

function transformMatrix(value: string): Matrix {
  if (!value || value === 'none') return IDENTITY
  if (typeof DOMMatrix !== 'undefined') {
    try { return new DOMMatrix(value) } catch { /* SVG transform lists use a different syntax. */ }
  }
  let result = IDENTITY
  for (const match of value.matchAll(/(matrix|scale|rotate|skewX|skewY|translate)\s*\(([^)]*)\)/g)) {
    const v = match[2].trim().split(/[\s,]+/).map(Number)
    if (!v.every(Number.isFinite)) continue
    let next = IDENTITY
    if (match[1] === 'matrix' && v.length === 6) next = { a: v[0], b: v[1], c: v[2], d: v[3] }
    if (match[1] === 'scale' && v.length) next = { a: v[0], b: 0, c: 0, d: v[1] ?? v[0] }
    if (match[1] === 'rotate' && v.length) {
      const r = v[0] * Math.PI / 180
      next = { a: Math.cos(r), b: Math.sin(r), c: -Math.sin(r), d: Math.cos(r) }
    }
    if (match[1] === 'skewX' && v.length) next = { ...IDENTITY, c: Math.tan(v[0] * Math.PI / 180) }
    if (match[1] === 'skewY' && v.length) next = { ...IDENTITY, b: Math.tan(v[0] * Math.PI / 180) }
    result = multiply(result, next)
  }
  return result
}

function inheritedFontSize(el: Element): number {
  const computed = getComputedStyle(el).fontSize
  // DOMs without an SVG layout engine report the host's inherited font even for explicit
  // presentation attributes. Browsers use resolved cascade values; tests use declarations.
  const declared = (el as SVGElement).style?.fontSize || el.getAttribute('font-size') || ''
  const value = typeof SVGSVGElement.prototype.getScreenCTM === 'function'
    ? computed || declared : declared || computed
  const absolute = absoluteLength(value)
  if (positive(absolute)) return absolute
  const parent = el.parentElement ? inheritedFontSize(el.parentElement) : 16
  const relative = value.match(/^([\d.]+)(em|%)$/)
  if (relative) return parent * Number(relative[1]) / (relative[2] === '%' ? 100 : 1)
  return parent
}

function foreignObjectOf(el: Element): SVGGraphicsElement | null {
  for (let parent: Element | null = el; parent; parent = parent.parentElement) {
    if (parent.namespaceURI === 'http://www.w3.org/2000/svg' && parent.localName.toLowerCase() === 'foreignobject') {
      return parent as SVGGraphicsElement
    }
  }
  return null
}

function textScale(el: Element, root: SVGSVGElement, size: DiagramMetrics): number {
  const svgEl = el.namespaceURI === 'http://www.w3.org/2000/svg'
    ? el as SVGGraphicsElement : foreignObjectOf(el)
  const box = (root.getAttribute('viewBox') || '').trim().split(/[\s,]+/).map(Number)
  const base = box.length === 4 && positive(box[2]) && positive(box[3])
    ? { a: size.width / box[2], b: 0, c: 0, d: size.height / box[3] } : IDENTITY
  const preserve = root.getAttribute('preserveAspectRatio')
  const viewport = preserve === 'none' ? base : { a: Math.min(base.a, base.d), b: 0, c: 0, d: Math.min(base.a, base.d) }
  const screen = svgEl?.getScreenCTM?.()
  const rootScreen = root.getScreenCTM?.()
  const determinant = rootScreen ? rootScreen.a * rootScreen.d - rootScreen.b * rootScreen.c : 0
  let matrix: Matrix
  if (screen && rootScreen && Number.isFinite(determinant) && determinant !== 0) {
    // getScreenCTM includes browser page zoom on WebView2. Cancel the root's screen
    // transform, then map SVG coordinates back to the renderer's original CSS pixels.
    const inverse = { a: rootScreen.d / determinant, b: -rootScreen.b / determinant,
      c: -rootScreen.c / determinant, d: rootScreen.a / determinant }
    matrix = multiply(viewport, multiply(inverse, screen))
  } else {
    matrix = viewport
    const chain: Element[] = []
    for (let p: Element | null = svgEl; p && p !== root; p = p.parentElement) chain.unshift(p)
    for (const p of chain) matrix = multiply(matrix, transformMatrix(p.getAttribute('transform') || ''))
  }
  if (el !== svgEl) {
    const chain: Element[] = []
    for (let p: Element | null = el; p && p !== svgEl; p = p.parentElement) chain.unshift(p)
    for (const p of chain) matrix = multiply(matrix, transformMatrix(getComputedStyle(p).transform))
  }
  return largestScale(matrix)
}

const TITLE_SELECTOR = '.title, .flowchartTitleText, .sequenceTitle, .classTitle, .stateTitle, .diagram-title'

// The shadow tree isolates renderer CSS/IDs from the document and reader zoom. No source
// scripts, event handlers or external resources may enter this temporary measurement tree.
export function measureDiagramSvg(markup: string): DiagramMetrics | null {
  const clean = DOMPurify.sanitize(markup, {
    USE_PROFILES: { svg: true, svgFilters: true, html: true },
    ADD_TAGS: ['style', 'foreignObject'],
    HTML_INTEGRATION_POINTS: { foreignobject: true },
    FORBID_TAGS: ['script', 'iframe', 'object', 'embed', 'img', 'image', 'video', 'audio', 'link', 'animate', 'set'],
  })
  const parsed = new DOMParser().parseFromString(clean, 'text/html')
  const root = parsed.body.querySelector('svg') as SVGSVGElement | null
  const size = root ? svgSize(root) : null
  if (!root || !size) return null
  for (const el of [root, ...root.querySelectorAll('*')]) {
    for (const attr of Array.from(el.attributes)) {
      if (/^on/i.test(attr.name) || attr.name === 'src' ||
        (/href$/i.test(attr.name) && !attr.value.startsWith('#'))) el.removeAttribute(attr.name)
    }
    const scrubCss = (css: string) => /\\/.test(css) ? ''
      : css.replace(/@import[^;]*(;|$)/gi, '').replace(/@font-face\s*\{[^}]*\}/gi, '').replace(/(?:url|(?:-webkit-)?image-set)\s*\([^)]*\)/gi, 'none')
    if (el.hasAttribute('style')) el.setAttribute('style', scrubCss(el.getAttribute('style')!))
    if (el.tagName.toLowerCase() === 'style') el.textContent = scrubCss(el.textContent || '')
  }
  root.style.setProperty('width', `${size.width}px`, 'important')
  root.style.setProperty('height', `${size.height}px`, 'important')
  root.style.setProperty('max-width', 'none', 'important')
  root.style.setProperty('max-height', 'none', 'important')
  const host = document.createElement('div')
  host.style.cssText = `position:fixed;left:-100000px;top:0;opacity:0;pointer-events:none;width:${size.width}px;height:${size.height}px;contain:layout style paint;`
  host.setAttribute('aria-hidden', 'true')
  const shadow = host.attachShadow({ mode: 'closed' })
  const base = document.createElement('div')
  base.style.cssText = 'font-size:16px;font-family:system-ui;'
  base.append(root)
  shadow.append(base)
  document.body.append(host)
  try {
    let maxFont = 0
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const el = node.parentElement
      if (!node.textContent?.trim() || !el || el.closest('defs, style, title, desc') || el.closest(TITLE_SELECTOR)) continue
      if (!el.closest('text') && !foreignObjectOf(el)) continue
      let visible = true
      for (let p: Element | null = el; p; p = p.parentElement) {
        const style = getComputedStyle(p)
        if (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse') { visible = false; break }
      }
      if (!visible) continue
      const font = inheritedFontSize(el) * textScale(el, root, size)
      if (positive(font)) maxFont = Math.max(maxFont, font)
    }
    return { ...size, ...(positive(maxFont) ? { labelFontPx: maxFont } : {}) }
  } finally {
    host.remove()
  }
}

const requests = new Map<string, Promise<DiagramMetrics | null>>()

export function loadPlantUmlMetrics(url: string): Promise<DiagramMetrics | null> {
  let key: string
  try { key = new URL(url, document.baseURI).href } catch { return Promise.resolve(null) }
  const cached = requests.get(key)
  if (cached) return cached
  const request = (async () => {
    const abort = new AbortController()
    const timeout = setTimeout(() => abort.abort(), 5000)
    try {
      const response = await fetch(key, { credentials: 'omit', signal: abort.signal })
      if (!response.ok) return null
      const markup = await response.text()
      return measureDiagramSvg(markup)
    } catch {
      return null
    } finally {
      clearTimeout(timeout)
    }
  })()
  requests.set(key, request)
  // Bounded session cache; consumers own their DOM lifecycle, not this shared request.
  if (requests.size > 128) requests.delete(requests.keys().next().value!)
  return request
}
