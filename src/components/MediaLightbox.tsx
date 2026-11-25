import { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'
import { X, ZoomIn, ZoomOut } from 'lucide-react'
import { settingsStore } from '../stores/settings'
import { autoScaleLimit, measureDiagramSvg, loadPlantUmlMetrics } from '../lib/diagramMetrics'
import {
  mediaSource,
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
  useSyncExternalStore(settingsStore.subscribe, () => settingsStore.version)
  const closeOnBlankDoubleClick = settingsStore.settings.closePreviewOnBlankDoubleClick === true
  const modifierWheelPan = settingsStore.settings.previewModifierWheelPan === true
  const prepared = useMemo(
    () => (payload.kind === 'svg' && payload.svg ? prepareSvgMarkup(payload.svg) : null),
    [payload.kind, payload.svg],
  )
  const source = mediaSource(payload)
  const diagramTheme = source === 'image' ? undefined
    : payload.diagramTheme ?? (settingsStore.isDark ? 'dark' : 'light')
  const [metrics, setMetrics] = useState(() => payload.diagramMetrics ??
    (source !== 'image' && payload.svg ? measureDiagramSvg(payload.svg) : null))
  const maxAutoScale = autoScaleLimit(source, metrics, settingsStore.settings.fontSize)
  useEffect(() => {
    if (source !== 'plantuml' || !payload.src) return
    let active = true
    void loadPlantUmlMetrics(payload.src).then(value => { if (active) setMetrics(value) })
    return () => { active = false }
  }, [source, payload.src])
  useEffect(() => {
    if (payload.diagramMetrics) setMetrics(payload.diagramMetrics)
  }, [payload.diagramMetrics])
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
  const originalSize = source === 'plantuml' && natural && metrics
    ? { w: metrics.width, h: metrics.height } : natural

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
      true,
      maxAutoScale,
    )
    fitScaleRef.current = next.scale
    setFitScale(next.scale)
    commit(next)
  }

  function resetFit() {
    if (!originalSize) return
    autoFitRef.current = true
    dragRef.current = null
    setPanning(false)
    fitTo(originalSize)
  }

  useEffect(() => {
    closeRef.current?.focus()
  }, [])

  useLayoutEffect(() => {
    const viewport = viewportRef.current
    if (!originalSize || !viewport) return
    const refit = () => {
      if (autoFitRef.current) fitTo(originalSize)
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
  }, [natural, metrics?.width, metrics?.height, maxAutoScale])

  useEffect(() => {
    const root = rootRef.current
    const viewport = viewportRef.current
    if (!root || !viewport) return
    const onWheel = (event: WheelEvent) => {
      event.preventDefault()
      const baseScale = fitScaleRef.current
      if (baseScale === null || !viewport.contains(event.target as Node)) return
      if (modifierWheelPan && (event.ctrlKey || event.shiftKey)) {
        // Ctrl 优先上下滚动；部分浏览器会将 Shift + 滚轮转成 deltaX。
        const horizontal = !event.ctrlKey && event.shiftKey
        const delta = horizontal ? event.deltaX || event.deltaY : event.deltaY
        if (delta === 0) return
        const unit = event.deltaMode === 1 ? 16
          : event.deltaMode === 2 ? (horizontal ? viewport.clientWidth : viewport.clientHeight)
          : 1
        // 距离按屏幕像素计算，不随图片缩放变化；方向与普通滚动一致。
        commitUserTransform(panBy(
          transformRef.current,
          horizontal ? -delta * unit : 0,
          horizontal ? 0 : -delta * unit,
        ))
        return
      }
      if (event.deltaY === 0) return
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
  }, [modifierWheelPan])

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
    if (event.button !== 0 || event.isPrimary === false || fitScaleRef.current === null) return
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

  const percent = fitScale === null ? null : relativeScalePercent(transform.scale)
  const ready = fitScale !== null && !failed

  function onBlankDoubleClick(event: React.MouseEvent<HTMLDivElement>) {
    if (!closeOnBlankDoubleClick || event.button !== 0) return
    if (event.target instanceof Element && event.target.closest('.media-lightbox-plate')) return
    const plate = viewportRef.current?.querySelector('.media-lightbox-plate')
    if (ready && plate) {
      // Pointer capture can retarget a double-click on the image to the viewport.
      // Check the transformed content bounds as well as the event target.
      const rect = plate.getBoundingClientRect()
      if (event.clientX >= rect.left && event.clientX <= rect.right &&
          event.clientY >= rect.top && event.clientY <= rect.bottom) return
    }
    event.preventDefault()
    event.stopPropagation()
    onClose()
  }

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
        <span className="media-lightbox-hint">
          滚轮缩放 · 按住拖动
          {modifierWheelPan ? ' · Ctrl+滚轮上下 · Shift+滚轮左右' : ''}
          {closeOnBlankDoubleClick ? ' · 双击空白关闭' : ''}
        </span>
        <div className="media-lightbox-actions">
          <button type="button" disabled={!ready} onClick={() => zoomTowardCenter(1 / 1.2)} title="缩小">
            <ZoomOut size={15} />
            缩小
          </button>
          <button
            type="button"
            disabled={!ready}
            onClick={() => {
              const viewport = viewportRef.current
              if (!originalSize || !viewport) return
              dragRef.current = null
              setPanning(false)
              commitUserTransform({ scale: 1, x: (viewport.clientWidth - originalSize.w) / 2, y: (viewport.clientHeight - originalSize.h) / 2 })
            }}
            title="相对原始尺寸，点击恢复 100% 并居中"
          >
            {percent === null ? (failed ? '未加载' : '加载中') : `${percent}%`}
          </button>
          <button type="button" disabled={!ready} onClick={() => zoomTowardCenter(1.2)} title="放大">
            <ZoomIn size={15} />
            放大
          </button>
          <button type="button" disabled={!ready} onClick={resetFit} title="适应窗口">适应窗口</button>
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
        onDoubleClick={onBlankDoubleClick}
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
                style={originalSize ? { width: originalSize.w, height: originalSize.h } : undefined}
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
