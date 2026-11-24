import { useLayoutEffect, type RefObject } from 'react'
import { captureReadingPosition, contentSignature, readingPositionTop, readingProgress, type ReadingPosition } from '../lib/readingProgress'

export function attachReadingPosition(
  scroll: HTMLElement,
  root: HTMLElement,
  source: string,
  saved: ReadingPosition | undefined,
  onSave: (position: ReadingPosition) => void,
): () => void {
  const signature = contentSignature(source)
  let disposed = false
  let restoring = true
  let changedByUser = false
  let frame: number | undefined
  const save = () => { if (!disposed) onSave(captureReadingPosition(scroll, root, signature)) }
  const restore = () => {
    if (disposed || !restoring) return
    scroll.scrollTop = readingPositionTop(scroll, root, signature, saved)
  }
  const finish = () => {
    if (disposed || !restoring) return
    restore()
    restoring = false
    save()
  }
  const schedule = () => {
    if (frame !== undefined) cancelAnimationFrame(frame)
    frame = requestAnimationFrame(() => {
      frame = undefined
      restore()
      const pending = [...root.querySelectorAll('img')].some(image => !image.complete)
      if (!pending) finish()
    })
  }
  const intent = () => {
    changedByUser = true
    restoring = false
  }
  const onScroll = () => {
    if (!restoring || changedByUser) save()
  }
  // React 已提交正确正文后、首次绘制前恢复；旧内容绝不向新 path 写位置。
  restore()
  schedule()
  const timeout = setTimeout(finish, 5000)
  const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => {
    if (restoring) schedule()
  }) : null
  observer?.observe(root)
  observer?.observe(scroll)
  scroll.addEventListener('scroll', onScroll, { passive: true })
  for (const event of ['wheel', 'touchstart', 'pointerdown', 'keydown']) scroll.addEventListener(event, intent, { passive: true })
  root.addEventListener('load', schedule, true)
  root.addEventListener('error', schedule, true)
  window.addEventListener('scroll-to-heading', intent)
  window.addEventListener('trigger-find', intent)
  const beforeChange = () => { if (!restoring) save() }
  window.addEventListener('madu:before-document-change', beforeChange)
  const flush = () => { if (!restoring) save(); void readingProgress.flush() }
  window.addEventListener('madu:hide-before-close', flush)
  window.addEventListener('pagehide', flush)
  return () => {
    if (!restoring && scroll.isConnected) save()
    disposed = true
    clearTimeout(timeout)
    if (frame !== undefined) cancelAnimationFrame(frame)
    observer?.disconnect()
    scroll.removeEventListener('scroll', onScroll)
    for (const event of ['wheel', 'touchstart', 'pointerdown', 'keydown']) scroll.removeEventListener(event, intent)
    root.removeEventListener('load', schedule, true)
    root.removeEventListener('error', schedule, true)
    window.removeEventListener('scroll-to-heading', intent)
    window.removeEventListener('trigger-find', intent)
    window.removeEventListener('madu:before-document-change', beforeChange)
    window.removeEventListener('madu:hide-before-close', flush)
    window.removeEventListener('pagehide', flush)
  }
}

export function useReadingPosition(
  scrollRef: RefObject<HTMLDivElement | null>,
  contentRef: RefObject<HTMLDivElement | null>,
  path: string,
  source: string,
  revision: unknown,
  enabled: boolean,
): void {
  useLayoutEffect(() => {
    const scroll = scrollRef.current
    const content = contentRef.current
    if (!enabled || !path || !scroll || !content) return
    return attachReadingPosition(scroll, content, source, readingProgress.get(path), position => readingProgress.record(path, position))
  }, [scrollRef, contentRef, path, source, revision, enabled])
}
