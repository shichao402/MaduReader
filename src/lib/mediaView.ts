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
}

export interface PreparedSvg {
  markup: string
  width: number
  height: number
}

export const MIN_VIEW_SCALE = 0.2
export const MAX_VIEW_SCALE = 8

const EXPAND_ICON = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 3h6v6"/><path d="M9 21H3v-6"/><path d="M21 3l-7 7"/><path d="M3 21l7-7"/></svg>`

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
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
): ViewTransform {
  if (!Number.isFinite(factor) || factor <= 0) return transform
  const nextScale = clamp(transform.scale * factor, MIN_VIEW_SCALE, MAX_VIEW_SCALE)
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
): ViewTransform {
  if (deltaY === 0) return transform
  const factor = Math.exp(-deltaY * 0.0015)
  return zoomBy(transform, factor, cursorX, cursorY)
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
): ViewTransform {
  const availW = Math.max(1, viewportW - padding * 2)
  const availH = Math.max(1, viewportH - padding * 2)
  const fit = Math.min(availW / Math.max(contentW, 1), availH / Math.max(contentH, 1))
  const scale = clamp(Math.min(fit, 1), MIN_VIEW_SCALE, MAX_VIEW_SCALE)
  return {
    scale,
    x: (viewportW - contentW * scale) / 2,
    y: (viewportH - contentH * scale) / 2,
  }
}

function readSvgSize(svg: Element): { width: number; height: number } {
  const viewBox = svg.getAttribute('viewBox')
  if (viewBox) {
    const parts = viewBox.trim().split(/[\s,]+/).map(Number)
    if (parts.length === 4 && parts[2] > 0 && parts[3] > 0) {
      return { width: parts[2], height: parts[3] }
    }
  }
  const width = parseFloat(svg.getAttribute('width') || '')
  const height = parseFloat(svg.getAttribute('height') || '')
  if (width > 0 && height > 0) return { width, height }
  return { width: 800, height: 600 }
}

function namespaceSvgIds(svg: Element, prefix: string): void {
  const map = new Map<string, string>()
  svg.querySelectorAll('[id]').forEach((el) => {
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
}

export function prepareSvgMarkup(svg: string): PreparedSvg {
  const parsed = new DOMParser().parseFromString(svg, 'image/svg+xml')
  const root = parsed.documentElement
  if (!root || root.tagName.toLowerCase() !== 'svg') {
    return { markup: svg, width: 800, height: 600 }
  }
  namespaceSvgIds(root, `lb${Math.random().toString(36).slice(2, 8)}`)
  const size = readSvgSize(root)
  root.setAttribute('width', String(size.width))
  root.setAttribute('height', String(size.height))
  const style = root.getAttribute('style') || ''
  root.setAttribute(
    'style',
    `${style}${style && !style.endsWith(';') ? ';' : ''}width:${size.width}px;height:${size.height}px;max-width:none;`,
  )
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
    wrapElement(doc, svg, 'mermaid')
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
  if (kind === 'mermaid') {
    const svg = frame.querySelector('svg')
    if (!svg) return null
    return { kind: 'svg', svg: svg.outerHTML, label: '流程图' }
  }
  const img = frame.querySelector('img')
  const src = img?.getAttribute('src') || ''
  if (!img || !src) return null
  const alt = img.getAttribute('alt') || ''
  return {
    kind: 'image',
    src,
    alt,
    label: kind === 'plantuml' ? 'PlantUML' : alt || '图片',
  }
}

export function mediaPayloadFromEventTarget(target: EventTarget | null): MediaPayload | null {
  if (!(target instanceof Element)) return null
  const frame = target.closest('.media-frame')
  if (!(frame instanceof HTMLElement)) return null
  return payloadFromFrame(frame)
}
