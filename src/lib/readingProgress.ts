import { invoke } from '@tauri-apps/api/core'
import { filePathKey } from './fileActivity'

export interface ReadingPosition {
  top: number
  ratio: number
  signature: string
  anchorText: string
  anchorIndex: number
  anchorOffset: number
  updatedAt: number
}

const MAX_RECORDS = 1000
const STORAGE_KEY = 'madureader-reading-progress'
const FILE_NAME = 'reading-progress.json'
const BLOCKS = 'h1,h2,h3,h4,h5,h6,p,li,pre,table,blockquote'

export function contentSignature(source: string): string {
  let hash = 2166136261
  for (let i = 0; i < source.length; i++) hash = Math.imul(hash ^ source.charCodeAt(i), 16777619)
  return `${source.length}:${hash >>> 0}`
}

function finite(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

export function sanitizeReadingPosition(raw: unknown): ReadingPosition | null {
  if (!raw || typeof raw !== 'object') return null
  const value = raw as Partial<ReadingPosition>
  if (typeof value.signature !== 'string' || value.signature.length > 64) return null
  return {
    top: Math.max(0, finite(value.top)),
    ratio: Math.max(0, Math.min(1, finite(value.ratio))),
    signature: value.signature,
    anchorText: typeof value.anchorText === 'string' ? value.anchorText.slice(0, 160) : '',
    anchorIndex: Math.max(0, Math.round(finite(value.anchorIndex))),
    anchorOffset: finite(value.anchorOffset),
    updatedAt: Math.max(0, Math.min(Date.now(), finite(value.updatedAt))),
  }
}

function blocks(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(BLOCKS)].filter(el => !el.closest('svg, .katex, .media-view-actions'))
}

function textOf(el: HTMLElement): string {
  return (el.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 160)
}

export function maxScrollTop(scroll: HTMLElement): number {
  return Math.max(0, scroll.scrollHeight - scroll.clientHeight)
}

export function captureReadingPosition(scroll: HTMLElement, root: HTMLElement, signature: string): ReadingPosition {
  const top = Math.max(0, Math.min(finite(scroll.scrollTop), maxScrollTop(scroll)))
  const edge = scroll.getBoundingClientRect().top + scroll.clientTop
  const items = blocks(root)
  let index = items.findIndex(el => el.getBoundingClientRect().bottom > edge + 1)
  if (index < 0) index = Math.max(0, items.length - 1)
  const anchor = items[index]
  return {
    top, ratio: maxScrollTop(scroll) > 0 ? top / maxScrollTop(scroll) : 0,
    signature, anchorIndex: index, anchorText: anchor ? textOf(anchor) : '',
    anchorOffset: anchor ? anchor.getBoundingClientRect().top - edge : 0,
    updatedAt: Date.now(),
  }
}

/** 首次打开必须是 0；原内容用像素位置，编辑后优先定位仍存在的段落，否则按进度安全夹取。 */
export function readingPositionTop(scroll: HTMLElement, root: HTMLElement, signature: string, saved?: ReadingPosition, forceAnchor = false): number {
  if (!saved || saved.top === 0) return 0
  const max = maxScrollTop(scroll)
  if (!forceAnchor && saved.signature === signature) return Math.max(0, Math.min(saved.top, max))
  const edge = scroll.getBoundingClientRect().top + scroll.clientTop
  const candidates = blocks(root).map((el, index) => ({ el, index })).filter(({ el }) => textOf(el) === saved.anchorText)
  candidates.sort((a, b) => Math.abs(a.index - saved.anchorIndex) - Math.abs(b.index - saved.anchorIndex))
  const match = saved.anchorText ? candidates[0]?.el : undefined
  const target = match
    ? scroll.scrollTop + match.getBoundingClientRect().top - edge - saved.anchorOffset
    : saved.ratio * max
  return Math.max(0, Math.min(finite(target), max))
}

function inTauri(): boolean {
  return typeof (window as { __TAURI_INTERNALS__?: { invoke?: unknown } }).__TAURI_INTERNALS__?.invoke === 'function'
}

export class ReadingProgressStore {
  private positions = new Map<string, ReadingPosition>()
  private timer: ReturnType<typeof setTimeout> | undefined
  private writes: Promise<void> = Promise.resolve()
  private generation = 0

  get(path: string): ReadingPosition | undefined { return this.positions.get(filePathKey(path)) }

  record(path: string, position: ReadingPosition): void {
    if (!path) return
    this.positions.delete(filePathKey(path))
    this.positions.set(filePathKey(path), position)
    while (this.positions.size > MAX_RECORDS) this.positions.delete(this.positions.keys().next().value!)
    clearTimeout(this.timer)
    this.timer = setTimeout(() => { void this.flush() }, 500)
  }

  async load(): Promise<void> {
    const generation = this.generation
    try {
      const data = inTauri()
        ? await invoke<string>('read_data_file', { fileName: FILE_NAME })
        : window.localStorage.getItem(STORAGE_KEY)
      if (!data || generation !== this.generation) return
      const parsed: unknown = JSON.parse(data)
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return
      const entries = Object.entries(parsed).map(([path, raw]) => ({ path, position: sanitizeReadingPosition(raw) }))
        .filter(entry => entry.path && entry.path.length <= 32768 && entry.position !== null)
        .sort((a, b) => a.position!.updatedAt - b.position!.updatedAt).slice(-MAX_RECORDS)
      for (const { path, position } of entries) {
        const current = this.get(path)
        if (!current || current.updatedAt < position!.updatedAt) this.positions.set(filePathKey(path), position!)
      }
    } catch { /* 首次启动、旧版本没有此文件或坏缓存不妨碍阅读。 */ }
  }

  flush(): Promise<void> {
    clearTimeout(this.timer)
    const content = JSON.stringify(Object.fromEntries(this.positions))
    this.writes = this.writes.then(async () => {
      try {
        if (inTauri()) await invoke('write_data_file', { fileName: FILE_NAME, content })
        else window.localStorage.setItem(STORAGE_KEY, content)
      } catch (error) { console.error('[ReadingProgress] Failed to save:', error) }
    })
    return this.writes
  }

  reset(): void { clearTimeout(this.timer); this.generation++; this.positions.clear() }
}

export const readingProgress = new ReadingProgressStore()
