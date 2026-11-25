import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { X, ZoomIn, ZoomOut } from 'lucide-react'
import {
  canUpscaleMedia,
  fitTransform,
  panBy,
  prepareSvgMarkup,
  relativeScalePercent,
  wheelZoomDelta,
  zoomAtPoint,
  zoomBy,
  type MediaPayload,
  type ViewTransform,
} from '../lib/mediaView'

const IDENTITY: ViewTransform = { scale: 1, x: 0, y: 0 }

interface MediaLightboxProps {
  payload: MediaPayload
  onClose: () => void
}

export default function MediaLightbox(props: MediaLightboxProps) {
  const { payload } = props
  // 换图时隔离加载状态，不能拿上一张图的尺寸先适配新图。
  return <MediaLightboxView key={`${payload.kind}:${payload.svg ?? payload.src ?? ''}`} {...props} />
}

function MediaLightboxView({ payload, onClose }: MediaLightboxProps) {
  const prepared = useMemo(
    () => (payload.kind === 'svg' && payload.svg ? prepareSvgMarkup(payload.svg) : null),
    [payload.kind, payload.svg],
  )
  const allowUpscale = canUpscaleMedia(payload)
  const diagramTheme = payload.diagramTheme
  const rootRef = useRef<HTMLDivElement>(null)
  const viewportRef = useRef<HTMLDivElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  const transformRef = useRef<ViewTransform>(IDENTITY)
  const fitScaleRef = useRef<number | null>(null)
  const autoFitRef = useRef(true)
  const dragRef = useRef<{ id: number; x: number; y: number; origin: ViewTransform } | null>(null)
  const [transform, setTransform] = useState<ViewTransform>(IDENTITY)
  const [fitScale, setFitScale] = useState<number | null>(null)
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(
    () => (prepared ? { w: prepared.width, h: prepared.height } : null),
  )
  const [failed, setFailed] = useState(false)
  const [panning, setPanning] = useState(false)

  function commit(next: ViewTransform) {
    transformRef.current = next
    setTransform(next)
  }

  function commitUserTransform(next: ViewTransform) {
    autoFitRef.current = false
    commit(next)
  }

  function fitTo(size: { w: number; h: number }) {
    const viewport = viewportRef.current
    if (!viewport || viewport.clientWidth <= 0 || viewport.clientHeight <= 0) return
    const next = fitTransform(
      viewport.clientWidth,
      viewport.clientHeight,
      size.w,
      size.h,
      48,
      allowUpscale,
    )
    fitScaleRef.current = next.scale
    setFitScale(next.scale)
    commit(next)
  }

  function resetFit() {
    if (!natural) return
    autoFitRef.current = true
    dragRef.current = null
    setPanning(false)
    fitTo(natural)
  }

  useEffect(() => {
    closeRef.current?.focus()
  }, [])

  useLayoutEffect(() => {
    const viewport = viewportRef.current
    if (!natural || !viewport) return
    const refit = () => {
      if (autoFitRef.current) fitTo(natural)
    }
    // 在首次可见之前完成适配；观察实际可用区域（不包含工具栏）。
    refit()
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(refit)
    observer?.observe(viewport)
    window.addEventListener('resize', refit)
    return () => {
      observer?.disconnect()
      window.removeEventListener('resize', refit)
    }
  }, [natural, allowUpscale])

  useEffect(() => {
    const root = rootRef.current
    const viewport = viewportRef.current
    if (!root || !viewport) return
    const onWheel = (event: WheelEvent) => {
      event.preventDefault()
      const baseScale = fitScaleRef.current
      if (baseScale === null || event.deltaY === 0 || !viewport.contains(event.target as Node)) return
      const rect = viewport.getBoundingClientRect()
      const next = zoomAtPoint(
        transformRef.current,
        event.clientX - rect.left,
        event.clientY - rect.top,
        wheelZoomDelta(event.deltaY, event.deltaMode),
        baseScale,
      )
      commitUserTransform(next)
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
    const baseScale = fitScaleRef.current
    if (!viewport || baseScale === null) return
    commitUserTransform(
      zoomBy(
        transformRef.current,
        factor,
        viewport.clientWidth / 2,
        viewport.clientHeight / 2,
        baseScale,
      ),
    )
  }

  function onPointerDown(event: React.PointerEvent<HTMLDivElement>) {
    if (event.button !== 0 || fitScaleRef.current === null) return
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
    const dx = event.clientX - drag.x
    const dy = event.clientY - drag.y
    if (dx === 0 && dy === 0) return
    commitUserTransform(panBy(drag.origin, dx, dy))
  }

  function endPan(event: React.PointerEvent<HTMLDivElement>) {
    if (dragRef.current?.id !== event.pointerId) return
    dragRef.current = null
    setPanning(false)
  }

  const percent = fitScale === null ? null : relativeScalePercent(transform.scale, fitScale)
  const ready = fitScale !== null && !failed

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
          <button type="button" disabled={!ready} onClick={() => zoomTowardCenter(1 / 1.2)} title="缩小">
            <ZoomOut size={15} />
            缩小
          </button>
          <button
            type="button"
            disabled={!ready}
            onClick={resetFit}
            title="缩放比例相对适应窗口，点击重新适配并居中（100%）"
          >
            {percent === null ? (failed ? '未加载' : '加载中') : `${percent}%`}
          </button>
          <button type="button" disabled={!ready} onClick={() => zoomTowardCenter(1.2)} title="放大">
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
        onLostPointerCapture={endPan}
      >
        {failed ? (
          <p className="media-lightbox-status">图片加载失败</p>
        ) : (
          <div
            className="media-lightbox-stage"
            style={{
              transform: `translate(${transform.x}px, ${transform.y}px) scale(${transform.scale})`,
              visibility: ready ? 'visible' : 'hidden',
            }}
          >
            {payload.kind === 'svg' && prepared ? (
              <div
                className="media-lightbox-plate"
                data-diagram-theme={diagramTheme}
                dangerouslySetInnerHTML={{ __html: prepared.markup }}
              />
            ) : (
              <img
                className="media-lightbox-plate"
                data-diagram-theme={diagramTheme}
                src={payload.src}
                alt={payload.alt || payload.label}
                style={natural ? { width: natural.w, height: natural.h } : undefined}
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
