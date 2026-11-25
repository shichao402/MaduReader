import { captureReadingPosition, contentSignature, readingPositionTop } from './readingProgress'

export const MIN_PAGE_WIDTH = 800
export function sanitizePageWidth(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= MIN_PAGE_WIDTH ? value : MIN_PAGE_WIDTH
}
export function columnGeometry(viewport: number, preference: number, zoom = 1) {
  const available = Math.max(1, (Number.isFinite(viewport) ? viewport : 0) - 96)
  const width = Math.min(sanitizePageWidth(preference), available)
  const scale = Number.isFinite(zoom) && zoom > 0 ? zoom : 1
  return { available, width, layoutWidth: width / scale, left: (viewport - width) / 2 }
}
export function draggedPageWidth(startWidth: number, delta: number, side: 'left' | 'right', available: number): number {
  return Math.max(MIN_PAGE_WIDTH, Math.min(available, startWidth + 2 * delta * (side === 'right' ? 1 : -1)))
}

interface ColumnOptions {
  width: number
  zoom: number
  source: string
  loaded: boolean
  onWidth: (width: number) => void
  onFlush: () => void
  onLayout: () => void
}
export interface ReadingColumnController {
  update: (options: ColumnOptions) => void
  dispose: () => void
}

export function attachReadingColumn(
  surface: HTMLElement, scroll: HTMLElement, column: HTMLElement, root: HTMLElement, initial: ColumnOptions,
): ReadingColumnController {
  const doc = root.ownerDocument
  const win = doc.defaultView!
  let options = initial
  let disposed = false
  let frame: number | null = null
  let restoreFrame: number | null = null
  let drag: { id: number; x: number; width: number; side: 'left' | 'right'; handle: HTMLElement; nextX: number } | null = null
  let previous: { width: number; layoutWidth: number; available: number; zoom: number } | null = null
  let oldCursor = ''
  let oldSelect = ''
  let userIntent = 0
  let layoutIntent = 0
  const handles = (['left', 'right'] as const).map(side => {
    const handle = doc.createElement('div')
    handle.className = 'reading-column-handle'
    handle.dataset.side = side
    handle.setAttribute('role', 'separator')
    handle.setAttribute('aria-orientation', 'vertical')
    handle.setAttribute('aria-label', `调整正文${side === 'left' ? '左' : '右'}边缘宽度`)
    handle.tabIndex = 0
    handle.appendChild(doc.createElement('span'))
    surface.appendChild(handle)
    const down = (event: PointerEvent) => {
      if (event.button !== 0 || event.isPrimary === false || handle.hidden || !options.loaded) return
      event.preventDefault(); event.stopPropagation()
      endDrag()
      const geometry = columnGeometry(scroll.clientWidth, options.width, options.zoom)
      drag = { id: event.pointerId, x: event.clientX, nextX: event.clientX, width: geometry.width, side, handle }
      oldCursor = doc.body.style.cursor; oldSelect = doc.body.style.userSelect
      doc.body.style.cursor = 'col-resize'; doc.body.style.userSelect = 'none'
      handle.classList.add('is-dragging')
      try { handle.setPointerCapture?.(event.pointerId) } catch { endDrag() }
    }
    const move = (event: PointerEvent) => {
      if (!drag || drag.id !== event.pointerId || drag.handle !== handle) return
      event.preventDefault(); event.stopPropagation()
      drag.nextX = event.clientX
      schedule()
    }
    const up = (event: PointerEvent) => {
      if (!drag || drag.id !== event.pointerId || drag.handle !== handle) return
      event.preventDefault(); event.stopPropagation()
      drag.nextX = event.type === 'pointerup' ? event.clientX : drag.nextX
      applyDrag()
      endDrag()
    }
    const click = (event: Event) => { event.preventDefault(); event.stopPropagation() }
    const reset = (event: MouseEvent) => {
      click(event); endDrag(); setWidth(MIN_PAGE_WIDTH, true); options.onFlush()
    }
    const key = (event: KeyboardEvent) => {
      if (handle.hidden || (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight')) return
      event.preventDefault(); event.stopPropagation()
      const geometry = columnGeometry(scroll.clientWidth, options.width, options.zoom)
      const distance = (event.key === 'ArrowRight' ? 1 : -1) * (event.shiftKey ? 50 : 10)
      setWidth(draggedPageWidth(geometry.width, distance, side, geometry.available))
    }
    handle.addEventListener('pointerdown', down)
    handle.addEventListener('pointermove', move)
    handle.addEventListener('pointerup', up)
    handle.addEventListener('pointercancel', up)
    handle.addEventListener('lostpointercapture', up)
    handle.addEventListener('click', click)
    handle.addEventListener('dblclick', reset)
    handle.addEventListener('keydown', key)
    return { handle, cleanup: () => {
      handle.removeEventListener('pointerdown', down); handle.removeEventListener('pointermove', move)
      handle.removeEventListener('pointerup', up); handle.removeEventListener('pointercancel', up)
      handle.removeEventListener('lostpointercapture', up); handle.removeEventListener('click', click)
      handle.removeEventListener('dblclick', reset); handle.removeEventListener('keydown', key)
      handle.remove()
    } }
  })
  function endDrag() {
    if (!drag) return
    const active = drag; drag = null
    active.handle.classList.remove('is-dragging')
    try {
      if (active.handle.hasPointerCapture?.(active.id)) active.handle.releasePointerCapture(active.id)
    } catch { /* A detached document may have already lost capture. */ }
    doc.body.style.cursor = oldCursor; doc.body.style.userSelect = oldSelect
    options.onFlush()
  }
  function setWidth(width: number, reset = false) {
    if (disposed || !options.loaded) return
    const current = columnGeometry(scroll.clientWidth, options.width, options.zoom).width
    if ((!reset && width === current) || width === options.width) return
    options = { ...options, width }
    options.onWidth(width)
    layout()
  }
  function applyDrag() {
    if (!drag) return
    const geometry = columnGeometry(scroll.clientWidth, options.width, options.zoom)
    if (previous && (geometry.available !== previous.available || options.zoom !== previous.zoom)) { endDrag(); return }
    setWidth(draggedPageWidth(drag.width, drag.nextX - drag.x, drag.side, geometry.available))
  }
  function style(el: HTMLElement, property: string, value: string) {
    if (el.style.getPropertyValue(property) !== value) el.style.setProperty(property, value)
  }
  function layout() {
    if (disposed || scroll.clientWidth <= 0) return
    const geometry = columnGeometry(scroll.clientWidth, options.width, options.zoom)
    const changed = previous && (previous.layoutWidth !== geometry.layoutWidth || previous.width !== geometry.width)
    const saved = changed ? captureReadingPosition(scroll, root, contentSignature(options.source)) : null
    if (drag && previous && (previous.available !== geometry.available || previous.zoom !== options.zoom)) endDrag()
    if (changed) {
      layoutIntent++
      scroll.dispatchEvent(new Event('madu:reading-reflow'))
    }
    style(column, 'width', `${geometry.width}px`)
    style(root, 'width', `${geometry.layoutWidth}px`)
    style(root, 'transform', `scale(${options.zoom})`)
    options.onLayout()
    style(column, 'height', `${Math.max(root.scrollHeight, root.offsetHeight) * options.zoom}px`)
    const surfaceRect = surface.getBoundingClientRect()
    const scrollRect = scroll.getBoundingClientRect()
    for (const { handle } of handles) {
      handle.hidden = !options.loaded || geometry.available <= MIN_PAGE_WIDTH
      style(handle, 'left', `${scrollRect.left - surfaceRect.left + geometry.left + (handle.dataset.side === 'right' ? geometry.width : 0) - 3}px`)
      style(handle, 'top', `${scrollRect.top - surfaceRect.top}px`)
      style(handle, 'height', `${scroll.clientHeight}px`)
      if (handle.getAttribute('aria-valuenow') !== String(geometry.width)) handle.setAttribute('aria-valuenow', String(geometry.width))
      if (handle.getAttribute('aria-valuemax') !== String(Math.max(MIN_PAGE_WIDTH, geometry.available))) {
        handle.setAttribute('aria-valuemax', String(Math.max(MIN_PAGE_WIDTH, geometry.available)))
      }
      handle.setAttribute('aria-valuemin', String(MIN_PAGE_WIDTH))
    }
    previous = { ...geometry, zoom: options.zoom }
    if (saved) {
      if (restoreFrame !== null) win.cancelAnimationFrame(restoreFrame)
      scroll.scrollTop = readingPositionTop(scroll, root, saved.signature, saved, true)
      const intent = userIntent
      const revision = layoutIntent
      restoreFrame = win.requestAnimationFrame(() => {
        restoreFrame = null
        if (!disposed && revision === layoutIntent && intent === userIntent) {
          scroll.scrollTop = readingPositionTop(scroll, root, saved.signature, saved, true)
        }
      })
    }
  }
  function schedule() {
    if (disposed || frame !== null) return
    frame = win.requestAnimationFrame(() => { frame = null; applyDrag(); layout() })
  }
  const intent = (event: Event) => {
    if (event.target instanceof Element && event.target.closest('.reading-column-handle')) return
    userIntent++
  }
  const blur = () => { applyDrag(); endDrag() }
  const visibility = () => { if (doc.visibilityState === 'hidden') blur() }
  const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(schedule)
  observer?.observe(scroll); observer?.observe(root)
  win.addEventListener('resize', schedule)
  win.addEventListener('blur', blur)
  win.addEventListener('madu:hide-before-close', blur)
  doc.addEventListener('visibilitychange', visibility)
  for (const event of ['wheel', 'touchstart', 'pointerdown', 'keydown']) scroll.addEventListener(event, intent, { passive: true })
  win.addEventListener('scroll-to-heading', intent)
  win.addEventListener('trigger-find', intent)
  layout()
  return {
    update(next) {
      if (disposed) return
      if (next.zoom !== options.zoom || next.source !== options.source || !next.loaded) {
        endDrag()
        layoutIntent++
        if (restoreFrame !== null) { win.cancelAnimationFrame(restoreFrame); restoreFrame = null }
      }
      options = next; layout()
    },
    dispose() {
      if (disposed) return
      blur(); disposed = true
      if (frame !== null) win.cancelAnimationFrame(frame)
      if (restoreFrame !== null) win.cancelAnimationFrame(restoreFrame)
      observer?.disconnect()
      win.removeEventListener('resize', schedule); win.removeEventListener('blur', blur)
      win.removeEventListener('madu:hide-before-close', blur)
      doc.removeEventListener('visibilitychange', visibility)
      for (const event of ['wheel', 'touchstart', 'pointerdown', 'keydown']) scroll.removeEventListener(event, intent)
      win.removeEventListener('scroll-to-heading', intent)
      win.removeEventListener('trigger-find', intent)
      handles.forEach(({ cleanup }) => cleanup())
      column.style.removeProperty('width'); column.style.removeProperty('height')
      root.style.removeProperty('width'); root.style.removeProperty('transform')
    },
  }
}
