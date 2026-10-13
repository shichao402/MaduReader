import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { X, ZoomIn, ZoomOut } from 'lucide-react'
import {
  fitTransform,
  panBy,
  prepareSvgMarkup,
  wheelZoomDelta,
  zoomAtPoint,
  zoomBy,
  type MediaPayload,
  type ViewTransform,
} from '../lib/mediaView'

const IDENTITY: ViewTransform = { scale: 1, x: 0, y: 0 }

export default function MediaLightbox({
  payload,
  onClose,
}: {
  payload: MediaPayload
  onClose: () => void
}) {
  const rootRef = useRef<HTMLDivElement>(null)
  const viewportRef = useRef<HTMLDivElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  const transformRef = useRef<ViewTransform>(IDENTITY)
  const dragRef = useRef<{ id: number; x: number; y: number; origin: ViewTransform } | null>(null)
  const [transform, setTransform] = useState<ViewTransform>(IDENTITY)
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null)
  const [failed, setFailed] = useState(false)
  const [panning, setPanning] = useState(false)

  const prepared = useMemo(
    () => (payload.kind === 'svg' && payload.svg ? prepareSvgMarkup(payload.svg) : null),
    [payload],
  )

  function commit(next: ViewTransform) {
    transformRef.current = next
    setTransform(next)
  }

  function fitTo(size: { w: number; h: number }) {
    const viewport = viewportRef.current
    if (!viewport) return
    commit(fitTransform(viewport.clientWidth, viewport.clientHeight, size.w, size.h))
  }

  useEffect(() => {
    closeRef.current?.focus()
  }, [])

  useEffect(() => {
    if (prepared) setNatural({ w: prepared.width, h: prepared.height })
  }, [prepared])

  useEffect(() => {
    const viewport = viewportRef.current
    if (!natural || !viewport) return
    const next = fitTransform(viewport.clientWidth, viewport.clientHeight, natural.w, natural.h)
    transformRef.current = next
    setTransform(next)
  }, [natural])

  useEffect(() => {
    const root = rootRef.current
    const viewport = viewportRef.current
    if (!root || !viewport) return
    const onWheel = (event: WheelEvent) => {
      event.preventDefault()
      if (!viewport.contains(event.target as Node)) return
      const rect = viewport.getBoundingClientRect()
      const next = zoomAtPoint(
        transformRef.current,
        event.clientX - rect.left,
        event.clientY - rect.top,
        wheelZoomDelta(event.deltaY, event.deltaMode),
      )
      commit(next)
    }
    root.addEventListener('wheel', onWheel, { passive: false })
    return () => root.removeEventListener('wheel', onWheel)
  }, [])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopPropagation()
      onClose()
    }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [onClose])

  function zoomTowardCenter(factor: number) {
    const viewport = viewportRef.current
    if (!viewport) return
    commit(
      zoomBy(
        transformRef.current,
        factor,
        viewport.clientWidth / 2,
        viewport.clientHeight / 2,
      ),
    )
  }

  function onPointerDown(event: React.PointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return
    if ((event.target as Element).closest('button')) return
    event.currentTarget.setPointerCapture(event.pointerId)
    dragRef.current = {
      id: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      origin: transformRef.current,
    }
    setPanning(true)
  }

  function onPointerMove(event: React.PointerEvent<HTMLDivElement>) {
    const drag = dragRef.current
    if (!drag || drag.id !== event.pointerId) return
    commit(
      panBy(
        drag.origin,
        event.clientX - drag.x,
        event.clientY - drag.y,
      ),
    )
  }

  function endPan(event: React.PointerEvent<HTMLDivElement>) {
    if (dragRef.current?.id !== event.pointerId) return
    dragRef.current = null
    setPanning(false)
  }

  const percent = Math.round(transform.scale * 100)

  return createPortal(
    <div
      ref={rootRef}
      className="media-lightbox"
      role="dialog"
      aria-modal="true"
      aria-label={`全屏查看 ${payload.label}`}
    >
      <div className="media-lightbox-toolbar">
        <span className="media-lightbox-title">{payload.label}</span>
        <span className="media-lightbox-hint">滚轮缩放 · 按住拖动</span>
        <div className="media-lightbox-actions">
          <button type="button" onClick={() => zoomTowardCenter(1 / 1.2)} title="缩小">
            <ZoomOut size={15} />
            缩小
          </button>
          <button
            type="button"
            onClick={() => natural && fitTo(natural)}
            title="适应窗口"
          >
            {percent}%
          </button>
          <button type="button" onClick={() => zoomTowardCenter(1.2)} title="放大">
            <ZoomIn size={15} />
            放大
          </button>
          <button ref={closeRef} type="button" onClick={onClose} title="关闭 (Esc)">
            <X size={15} />
            关闭
          </button>
        </div>
      </div>
      <div
        ref={viewportRef}
        className={`media-lightbox-viewport${panning ? ' is-panning' : ''}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endPan}
        onPointerCancel={endPan}
      >
        {failed ? (
          <p className="media-lightbox-status">图片加载失败</p>
        ) : (
          <div
            className="media-lightbox-stage"
            style={{
              transform: `translate(${transform.x}px, ${transform.y}px) scale(${transform.scale})`,
              visibility: natural ? 'visible' : 'hidden',
            }}
          >
            {payload.kind === 'svg' && prepared ? (
              <div
                className="media-lightbox-plate"
                dangerouslySetInnerHTML={{ __html: prepared.markup }}
              />
            ) : (
              <img
                className="media-lightbox-plate"
                src={payload.src}
                alt={payload.alt || payload.label}
                draggable={false}
                onLoad={(event) => {
                  const img = event.currentTarget
                  if (img.naturalWidth > 0 && img.naturalHeight > 0) {
                    setNatural({ w: img.naturalWidth, h: img.naturalHeight })
                  }
                }}
                onError={() => setFailed(true)}
              />
            )}
          </div>
        )}
      </div>
    </div>,
    document.body,
  )
}
