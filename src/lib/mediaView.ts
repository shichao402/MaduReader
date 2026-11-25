import { svgSize, type DiagramMetrics, type MediaSource } from './diagramMetrics'

export interface ViewTransform {
  scale: number
  x: number
  y: number
}

export interface MediaPayload {
  kind: 'image' | 'svg'
  src?: string
  alt?: string
  svg?: string
  label: string
  allowUpscale?: boolean
  source?: MediaSource
  diagramMetrics?: DiagramMetrics
  diagramTheme?: 'light' | 'dark'
}

export interface PreparedSvg {
  markup: string
  width: number
  height: number
}

// 宽松交互边界必须覆盖适配比例与原始 100%，不限制首次完整适配。
export const MIN_VIEW_SCALE = 0.2
export const MAX_VIEW_SCALE = 1000

const EXPAND_ICON = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 3h6v6"/><path d="M9 21H3v-6"/><path d="M21 3l-7 7"/><path d="M3 21l7-7"/></svg>`

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

export function canUpscaleMedia(_payload: MediaPayload): boolean {
  return true
}

export function mediaSource(payload: MediaPayload): MediaSource {
  return payload.source ?? (payload.kind === 'svg' ? 'mermaid' : 'image')
}


export function relativeScalePercent(scale: number, _fitScale = 1): number {
  const percent = scale * 100
  return percent < 1 ? Number(percent.toPrecision(3)) : Math.round(percent)
}

export function wheelZoomDelta(deltaY: number, deltaMode = 0): number {
  if (deltaMode === 1) return deltaY * 100
  if (deltaMode === 2) return deltaY * 400
  return deltaY
}

export function zoomBy(
  transform: ViewTransform,
  factor: number,
  originX: number,
  originY: number,
  fitScale = 1,
): ViewTransform {
  if (!Number.isFinite(factor) || factor <= 0 || !Number.isFinite(fitScale) || fitScale <= 0) {
    return transform
  }
  const nextScale = clamp(
    transform.scale * factor,
    Math.min(fitScale * MIN_VIEW_SCALE, transform.scale, MIN_VIEW_SCALE),
    Math.max(fitScale * MAX_VIEW_SCALE, transform.scale, MAX_VIEW_SCALE),
  )
  if (nextScale === transform.scale) return transform
  const contentX = (originX - transform.x) / transform.scale
  const contentY = (originY - transform.y) / transform.scale
  return {
    scale: nextScale,
    x: originX - contentX * nextScale,
    y: originY - contentY * nextScale,
  }
}

export function zoomAtPoint(
  transform: ViewTransform,
  cursorX: number,
  cursorY: number,
  deltaY: number,
  fitScale = 1,
): ViewTransform {
  if (deltaY === 0) return transform
  const factor = Math.exp(-deltaY * 0.0015)
  return zoomBy(transform, factor, cursorX, cursorY, fitScale)
}

export function panBy(transform: ViewTransform, dx: number, dy: number): ViewTransform {
  return { ...transform, x: transform.x + dx, y: transform.y + dy }
}

export function fitTransform(
  viewportW: number,
  viewportH: number,
  contentW: number,
  contentH: number,
  padding = 48,
  allowUpscale = true,
  maxAutoScale = Infinity,
): ViewTransform {
  const availW = Math.max(1, viewportW - padding * 2)
  const availH = Math.max(1, viewportH - padding * 2)
  const fit = Math.min(availW / Math.max(contentW, 1), availH / Math.max(contentH, 1))
  // 适配不设最小比例；所有图片允许放大，渲染图另受自动字号上限约束。
  const scale = Math.min(fit, allowUpscale ? Infinity : 1, maxAutoScale)
  return {
    scale,
    x: (viewportW - contentW * scale) / 2,
    y: (viewportH - contentH * scale) / 2,
  }
}

function readSvgSize(svg: Element): { width: number; height: number } {
  return svgSize(svg) ?? { width: 800, height: 600 }
}

function namespaceSvgIds(svg: Element, prefix: string): void {
  const map = new Map<string, string>()
  ;[svg, ...svg.querySelectorAll('[id]')].forEach((el) => {
    const id = el.getAttribute('id')
    if (!id) return
    const next = `${prefix}-${id}`
    map.set(id, next)
    el.setAttribute('id', next)
  })
  if (map.size === 0) return

  const rewrite = (value: string) => {
    let out = value
    for (const [id, next] of map) {
      out = out.split(`url(#${id})`).join(`url(#${next})`)
      out = out.split(`url("#${id}")`).join(`url("#${next}")`)
      if (out === `#${id}`) out = `#${next}`
    }
    return out
  }

  const visit = (el: Element) => {
    for (const attr of Array.from(el.attributes)) {
      if (attr.name === 'id') continue
      const next = rewrite(attr.value)
      if (next !== attr.value) el.setAttribute(attr.name, next)
    }
    for (const child of Array.from(el.children)) visit(child)
  }
  visit(svg)
  // Mermaid scopes renderer CSS to its SVG root ID. Keep those selectors valid too.
  svg.querySelectorAll('style').forEach((style) => {
    let css = style.textContent || ''
    for (const [id, next] of map) {
      const escaped = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      css = css.replace(new RegExp(`#${escaped}(?![\\w-])`, 'g'), `#${next}`)
    }
    style.textContent = css
  })
}

export function prepareSvgMarkup(svg: string): PreparedSvg {
  // 载荷来自 HTML DOM 的 outerHTML：Mermaid foreignObject 内的 <br> 等
  // HTML 空元素不一定序列化为 XML 的 <br/>，不能用 XML 解析后误走兜底尺寸。
  const parsed = new DOMParser().parseFromString(svg, 'text/html')
  const root = parsed.body.firstElementChild
  if (!root || root.tagName.toLowerCase() !== 'svg') {
    return { markup: svg, width: 800, height: 600 }
  }
  namespaceSvgIds(root, `lb${Math.random().toString(36).slice(2, 8)}`)
  const size = readSvgSize(root)
  root.setAttribute('width', String(size.width))
  root.setAttribute('height', String(size.height))
  const style = (root as SVGSVGElement).style
  // 通过 CSSOM 替换原属性，不靠拼接重复的 important 声明覆盖。
  style.setProperty('width', `${size.width}px`, 'important')
  style.setProperty('height', `${size.height}px`, 'important')
  style.setProperty('max-width', 'none', 'important')
  style.setProperty('max-height', 'none', 'important')
  style.setProperty('display', 'block')
  return { markup: root.outerHTML, width: size.width, height: size.height }
}

function ensureExpandButton(doc: Document, frame: Element): void {
  if (frame.querySelector(':scope > .media-expand')) return
  const button = doc.createElement('button')
  button.type = 'button'
  button.className = 'media-expand'
  button.setAttribute('aria-label', '全屏查看')
  button.innerHTML = `${EXPAND_ICON}<span>全屏</span>`
  frame.appendChild(button)
}

function wrapElement(doc: Document, node: Element, kind: string): HTMLElement {
  const frame = doc.createElement('span')
  frame.className = 'media-frame'
  frame.setAttribute('data-media-kind', kind)
  node.parentNode?.insertBefore(frame, node)
  frame.appendChild(node)
  ensureExpandButton(doc, frame)
  return frame
}

export function decorateViewableMedia(html: string): string {
  if (!html || typeof DOMParser === 'undefined') return html
  const doc = new DOMParser().parseFromString(html, 'text/html')

  doc.querySelectorAll('svg.mermaid-svg').forEach((svg) => {
    if (svg.closest('.media-frame')) return
    if (svg.parentElement?.closest('svg')) return
    const frame = wrapElement(doc, svg, 'mermaid')
    const theme = svg.getAttribute('data-diagram-theme')
    if (theme) frame.setAttribute('data-diagram-theme', theme)
  })

  doc.querySelectorAll('figure.plantuml-diagram').forEach((figure) => {
    figure.classList.add('media-frame')
    figure.setAttribute('data-media-kind', 'plantuml')
    ensureExpandButton(doc, figure)
  })

  doc.querySelectorAll('img').forEach((img) => {
    if (img.closest('.media-frame') || img.closest('svg')) return
    if (!img.getAttribute('src')) return
    img.setAttribute('draggable', 'false')
    wrapElement(doc, img, 'image')
  })

  doc.querySelectorAll('.media-frame img').forEach((img) => {
    img.setAttribute('draggable', 'false')
  })

  return doc.body.innerHTML
}

function payloadFromFrame(frame: HTMLElement): MediaPayload | null {
  const kind = frame.dataset.mediaKind
  const theme = frame.dataset.diagramTheme
  const diagramTheme = theme === 'light' || theme === 'dark' ? theme : undefined
  if (kind === 'mermaid') {
    const svg = frame.querySelector('svg')
    if (!svg) return null
    return { kind: 'svg', source: 'mermaid', svg: svg.outerHTML, label: '流程图', ...(diagramTheme ? { diagramTheme } : {}) }
  }
  const img = frame.querySelector('img')
  const src = img?.getAttribute('src') || ''
  if (!img || !src) return null
  const alt = img.getAttribute('alt') || ''
  return {
    kind: 'image',
    source: kind === 'plantuml' ? 'plantuml' : 'image',
    src,
    alt,
    label: kind === 'plantuml' ? 'PlantUML' : alt || '图片',
    // PlantUML 渲染器输出 /svg/<编码>，没有 .svg 扩展名但仍是矢量图。
    ...(kind === 'plantuml' ? { allowUpscale: true, ...(diagramTheme ? { diagramTheme } : {}) } : {}),
  }
}

export function mediaPayloadFromEventTarget(target: EventTarget | null): MediaPayload | null {
  if (!(target instanceof Element)) return null
  const frame = target.closest('.media-frame')
  if (!(frame instanceof HTMLElement)) return null
  return payloadFromFrame(frame)
}
