import { mediaPayloadFromEventTarget, type MediaPayload } from './mediaView'
import { autoScaleLimit, measureDiagramSvg, loadPlantUmlMetrics, svgSize, absoluteLength, type DiagramMetrics, type MediaSource } from './diagramMetrics'

interface DiagramSize {
  width: number
  height: number
}

export interface InlineDiagramLayout extends DiagramSize {
  limit: number
  overflows: boolean
}

export interface InlineDiagramsController {
  refresh: () => void
  handleToggle: (event: Event) => boolean
  payloadFromTarget: (target: EventTarget | null) => MediaPayload | null
  dispose: () => void
}

interface DiagramState {
  frame: HTMLElement
  media: SVGSVGElement | HTMLImageElement
  content: Element
  viewport: HTMLDivElement
  toggle: HTMLButtonElement
  payload: MediaPayload | null
  originalStyle: string | null
  originalViewBox: string | null
  originalAspect: string | null
  styled: boolean
  failed: boolean
  expanded: boolean
  layout: InlineDiagramLayout | null
  metrics: DiagramMetrics | null
  source: MediaSource
  removeListeners: () => void
}

const controllers = new WeakMap<HTMLElement, InlineDiagramsController>()
const expandedFrames = new WeakMap<HTMLElement, boolean>()
let viewportId = 0

function originalPayload(media: SVGSVGElement | HTMLImageElement): MediaPayload | null {
  const payload = mediaPayloadFromEventTarget(media)
  if (payload?.kind !== 'svg' || !(media instanceof SVGSVGElement)) return payload
  const size = svgSize(media)
  if (!size || media.hasAttribute('viewBox') ||
    (positive(absoluteLength(media.getAttribute('width'))) && positive(absoluteLength(media.getAttribute('height'))))) {
    return payload
  }
  // Full-screen inference reads viewBox/attributes. Retain ALL original content and inline styling;
  // only carry original absolute CSS dimensions into the snapshot when attributes were missing.
  const snapshot = media.cloneNode(true) as SVGSVGElement
  snapshot.setAttribute('width', String(size.width))
  snapshot.setAttribute('height', String(size.height))
  return { ...payload, svg: snapshot.outerHTML }
}

function positive(value: number): boolean {
  return Number.isFinite(value) && value > 0
}

// displayScale accounts for the reader's existing CSS transform without changing its zoom.
export function inlineDiagramLayout(
  size: DiagramSize,
  availableWidth: number,
  viewportHeight: number,
  displayScale = 1,
  maxAutoScale = Infinity,
): InlineDiagramLayout | null {
  if (![size.width, size.height, availableWidth, viewportHeight, displayScale].every(positive)) {
    return null
  }
  const width = size.width * Math.min(availableWidth / size.width, maxAutoScale)
  const height = width * (size.height / size.width)
  const limit = Math.min(viewportHeight * 7 / 10, 600) / displayScale
  if (!positive(height) || !positive(limit)) return null
  return { width, height, limit, overflows: height > limit + 1 / displayScale }
}

function sizeOf(state: DiagramState): DiagramSize | null {
  if (state.failed) return null
  if (state.media instanceof SVGSVGElement) return state.metrics
  const img = state.media
  // Lazy/loading/error images must not be collapsed using stale attributes or a browser placeholder.
  if (!img.complete || !positive(img.naturalWidth) || !positive(img.naturalHeight)) return null
  return state.source === 'plantuml' && state.metrics
    ? state.metrics : { width: img.naturalWidth, height: img.naturalHeight }
}

function restoreAttribute(element: Element, name: string, value: string | null): void {
  if (value === null) element.removeAttribute(name)
  else element.setAttribute(name, value)
}

function restoreMedia(state: DiagramState): void {
  if (!state.styled) return
  restoreAttribute(state.media, 'style', state.originalStyle)
  if (state.media instanceof SVGSVGElement) {
    restoreAttribute(state.media, 'viewBox', state.originalViewBox)
    restoreAttribute(state.media, 'preserveAspectRatio', state.originalAspect)
  }
  state.styled = false
}

function fillMedia(state: DiagramState, size: DiagramSize, layout: InlineDiagramLayout): void {
  const media = state.media
  if (media instanceof SVGSVGElement) {
    const parts = (media.getAttribute('viewBox') || '').trim().split(/[\s,]+/).map(Number)
    if (parts.length !== 4 || !parts.every(Number.isFinite) || !positive(parts[2]) || !positive(parts[3])) {
      // SVGs with only width/height need a viewBox to scale their contents, not just their viewport.
      media.setAttribute('viewBox', `0 0 ${size.width} ${size.height}`)
    }
    if (media.getAttribute('preserveAspectRatio') !== 'xMidYMin meet') {
      media.setAttribute('preserveAspectRatio', 'xMidYMin meet')
    }
  }
  // Mermaid emits inline max-width (sometimes !important). Only normalize the actual diagram root,
  // never nested icons/text, and keep the original markup for full-screen size inference.
  // Use CSSOM's serialized zero lengths so an unchanged layout does not rewrite these styles.
  const sizing: Record<string, string> = {
    display: 'block', width: `${layout.width}px`, height: `${layout.height}px`,
    'max-width': 'none', 'max-height': 'none', 'min-width': '0px', 'min-height': '0px',
    'aspect-ratio': `${size.width} / ${size.height}`, margin: '0px auto', 'object-fit': 'contain',
  }
  for (const [name, value] of Object.entries(sizing)) {
    if (media.style.getPropertyValue(name) !== value || media.style.getPropertyPriority(name) !== 'important') {
      media.style.setProperty(name, value, 'important')
    }
  }
  state.styled = true
}

export function attachInlineDiagrams(
  root: HTMLElement,
  scrollContainer: HTMLElement,
): InlineDiagramsController {
  const existing = controllers.get(root)
  if (existing) return existing

  let disposed = false
  let pendingFrame: number | null = null
  const states = new Map<HTMLElement, DiagramState>()
  const doc = root.ownerDocument
  root.querySelectorAll<HTMLElement>(
    '.media-frame[data-media-kind="plantuml"], .media-frame[data-media-kind="mermaid"], .media-frame[data-media-kind="image"]',
  ).forEach((frame) => {
    const media = Array.from(frame.querySelectorAll<SVGSVGElement | HTMLImageElement>('svg, img'))
      .find((node) => !node.closest('button') && !node.parentElement?.closest('svg'))
    if (!media) return
    let content: Element = media
    while (content.parentElement && content.parentElement !== frame) content = content.parentElement
    if (content.parentElement !== frame) return

    const payload = originalPayload(media)
    const source = frame.dataset.mediaKind as MediaSource
    const metrics = media instanceof SVGSVGElement
      ? measureDiagramSvg(payload?.svg ?? media.outerHTML) ?? svgSize(media) : null
    if (payload && metrics) payload.diagramMetrics = metrics
    const viewport = doc.createElement('div')
    viewport.className = 'inline-diagram-viewport'
    viewport.id = `inline-diagram-${++viewportId}`
    frame.insertBefore(viewport, content)
    viewport.appendChild(content)
    const toggle = doc.createElement('button')
    toggle.type = 'button'
    toggle.className = 'inline-diagram-toggle'
    toggle.textContent = '展开完整图表'
    toggle.setAttribute('aria-controls', viewport.id)
    toggle.setAttribute('aria-expanded', 'false')
    toggle.hidden = true
    frame.appendChild(toggle)
    frame.classList.add('inline-diagram')
    const state: DiagramState = {
      frame, media, content, viewport, toggle, payload, metrics, source,
      originalStyle: media.getAttribute('style'),
      originalViewBox: media.getAttribute('viewBox'),
      originalAspect: media.getAttribute('preserveAspectRatio'),
      styled: false, failed: false, expanded: expandedFrames.get(frame) ?? false, layout: null,
      removeListeners: () => {},
    }
    if (media instanceof HTMLImageElement) {
      const onLoad = () => { state.failed = false; refresh() }
      const onError = () => { state.failed = true; refresh() }
      media.addEventListener('load', onLoad)
      media.addEventListener('error', onError)
      state.removeListeners = () => {
        media.removeEventListener('load', onLoad)
        media.removeEventListener('error', onError)
      }
    }
    states.set(frame, state)
    if (source === 'plantuml' && payload?.src) {
      void loadPlantUmlMetrics(media instanceof HTMLImageElement ? media.src : payload.src).then(metrics => {
        if (disposed || !states.has(frame)) return
        state.metrics = metrics
        if (state.payload && metrics) state.payload.diagramMetrics = metrics
        scheduleRefresh()
      })
    }
  })

  function cancelScheduledRefresh() {
    if (pendingFrame === null) return
    window.cancelAnimationFrame(pendingFrame)
    pendingFrame = null
  }

  function scheduleRefresh() {
    if (disposed || pendingFrame !== null) return
    // RO delivery must not resize its own observed targets. Coalesce notifications into a later
    // frame, and measure there rather than retaining sizes from the delivery that queued it.
    pendingFrame = window.requestAnimationFrame(() => {
      pendingFrame = null
      refresh()
    })
  }

  function refresh() {
    if (disposed) return
    // Explicit refresh remains synchronous for initial binding and transform-only reader zoom.
    cancelScheduledRefresh()
    for (const state of states.values()) {
      const size = sizeOf(state)
      const width = state.viewport.clientWidth
      const screenWidth = state.viewport.getBoundingClientRect().width
      const scale = positive(screenWidth) && positive(width) ? screenWidth / width : 1
      state.layout = size ? inlineDiagramLayout(size, width, scrollContainer.clientHeight, scale,
        autoScaleLimit(state.source, state.metrics, parseFloat(getComputedStyle(root).fontSize) || 16)) : null
      if (size && state.layout) fillMedia(state, size, state.layout)
      else restoreMedia(state)
      const overflows = state.layout?.overflows ?? false
      const collapsed = overflows && !state.expanded
      const expanded = overflows && state.expanded
      const maxHeight = collapsed ? `${state.layout!.limit}px` : ''
      if (state.viewport.style.maxHeight !== maxHeight) state.viewport.style.maxHeight = maxHeight
      // Stable feedback frames must not rewrite attributes or replace the button's text node.
      if (state.frame.classList.contains('is-collapsed') !== collapsed) state.frame.classList.toggle('is-collapsed', collapsed)
      if (state.frame.classList.contains('is-expanded') !== expanded) state.frame.classList.toggle('is-expanded', expanded)
      if (state.toggle.hidden !== !overflows) state.toggle.hidden = !overflows
      const noun = state.source === 'image' ? '图片' : '图表'
      const text = state.expanded ? `收起${noun}` : `展开完整${noun}`
      if (state.toggle.textContent !== text) state.toggle.textContent = text
      const ariaExpanded = String(state.expanded)
      if (state.toggle.getAttribute('aria-expanded') !== ariaExpanded) state.toggle.setAttribute('aria-expanded', ariaExpanded)
    }
  }

  function stateFromTarget(target: EventTarget | null): DiagramState | undefined {
    if (!(target instanceof Element) || !root.contains(target)) return undefined
    const frame = target.closest<HTMLElement>('.media-frame')
    return frame ? states.get(frame) : undefined
  }

  const controller: InlineDiagramsController = {
    refresh,
    handleToggle(event) {
      if (disposed || !(event.target instanceof Element)) return false
      const state = stateFromTarget(event.target)
      if (!state || event.target.closest('.inline-diagram-toggle') !== state.toggle) return false
      // Must run in ContentArea's capture handler before any full-screen payload lookup.
      event.preventDefault()
      event.stopPropagation()
      if (!state.layout?.overflows) return true
      const scrollTop = scrollContainer.scrollTop
      const visibleTop = scrollContainer.getBoundingClientRect().top + scrollContainer.clientTop
      const frameTop = state.frame.getBoundingClientRect().top
      const clipRect = state.viewport.getBoundingClientRect()
      const scale = positive(clipRect.width) && positive(state.viewport.clientWidth)
        ? clipRect.width / state.viewport.clientWidth : 1
      const readingPastClip = state.expanded && clipRect.top + state.layout.limit * scale <= visibleTop
      state.expanded = !state.expanded
      refresh()
      // Only an explicit collapse can restore the chart top; loads/resizes/expansion never auto-scroll.
      if (readingPastClip) {
        scrollContainer.scrollTo({ top: Math.max(0, scrollTop + frameTop - visibleTop), behavior: 'auto' })
      }
      return true
    },
    payloadFromTarget(target) {
      if (disposed) return null
      return stateFromTarget(target)?.payload ?? null
    },
    dispose() {
      if (disposed) return
      disposed = true
      cancelScheduledRefresh()
      observer?.disconnect()
      if (states.size) window.removeEventListener('resize', refresh)
      for (const state of states.values()) {
        expandedFrames.set(state.frame, state.expanded)
        state.removeListeners()
        restoreMedia(state)
        state.viewport.parentNode?.insertBefore(state.content, state.viewport)
        state.viewport.remove()
        state.toggle.remove()
        state.frame.classList.remove('inline-diagram', 'is-collapsed', 'is-expanded')
      }
      states.clear()
      if (controllers.get(root) === controller) controllers.delete(root)
    },
  }
  const observer = states.size && typeof ResizeObserver !== 'undefined'
    ? new ResizeObserver(scheduleRefresh) : null
  if (states.size) {
    observer?.observe(root)
    observer?.observe(scrollContainer)
    for (const state of states.values()) observer?.observe(state.media)
    window.addEventListener('resize', refresh)
  }
  controllers.set(root, controller)
  refresh()
  return controller
}
