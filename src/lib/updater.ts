// 软件更新：前端只做展示与转发，检查 / 下载 / 安装全部由 Rust 侧 updater.rs 驱动 relkit-updater 引擎。
// 后端状态变化时推送 `update-status` 事件，载荷与命令返回值同为 UpdateView。

const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window

export type UpdatePhase =
  | 'disabled'
  | 'idle'
  | 'checking'
  | 'up-to-date'
  | 'available'
  | 'downloading'
  | 'downloaded'
  | 'applying'
  | 'fallback'
  | 'error'

export interface UpdateOffer {
  planId: string
  version: string
  code: number
  mandatory: boolean
  /** 空串表示无 */
  releaseNotes: string
  /** 空串表示无 */
  releaseNotesUrl: string
}

export interface UpdateProgress {
  received: number
  /** 0 表示总大小未知 */
  total: number
  bytesPerSecond: number
}

export interface UpdateView {
  enabled: boolean
  channel: string
  currentVersion: string
  currentCode: number
  phase: UpdatePhase
  message: string | null
  available: UpdateOffer | null
  progress: UpdateProgress | null
  manualUrl: string | null
  checkedAt: number | null
}

export function updatesSupported(): boolean {
  return isTauri
}

async function call(cmd: string): Promise<UpdateView | null> {
  if (!isTauri) return null
  const { invoke } = await import('@tauri-apps/api/core')
  return invoke<UpdateView>(cmd)
}

export const getUpdateStatus = () => call('update_status')
export const checkUpdate = () => call('update_check')
export const downloadUpdate = () => call('update_download')
export const applyUpdate = () => call('update_apply')

/** 订阅后端推送的更新状态；返回取消订阅函数。非桌面环境为空操作。 */
export async function onUpdateStatus(cb: (view: UpdateView) => void): Promise<() => void> {
  if (!isTauri) return () => {}
  const { listen } = await import('@tauri-apps/api/event')
  return listen<UpdateView>('update-status', (e) => cb(e.payload))
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

/** 进度百分比（0-100）；总大小未知时返回 null */
export function progressPercent(p: UpdateProgress | null): number | null {
  if (!p || !p.total || p.total <= 0) return null
  return Math.min(100, Math.round((p.received / p.total) * 100))
}

/** 状态的一行可读文案 */
export function describeUpdate(view: UpdateView): string {
  const v = view.available?.version
  switch (view.phase) {
    case 'disabled':
      return view.message ?? '此构建未接入自动更新'
    case 'idle':
      return '尚未检查更新'
    case 'checking':
      return '正在检查更新…'
    case 'up-to-date':
      return '已是最新版本'
    case 'available':
      return v ? `发现新版本 ${v}` : '发现新版本'
    case 'downloading': {
      const pct = progressPercent(view.progress)
      if (pct !== null) return `正在下载 ${v ?? ''} ${pct}%`.replace(/\s+/g, ' ')
      return view.progress ? `正在下载 ${formatBytes(view.progress.received)}` : '正在下载…'
    }
    case 'downloaded':
      return v ? `${v} 已就绪，重启即可完成安装` : '更新已就绪，重启即可完成安装'
    case 'applying':
      return '正在安装，应用即将重启…'
    case 'fallback':
      return view.message ?? '无法自动更新，请手动下载安装'
    case 'error':
      return view.message ? `更新失败：${view.message}` : '更新失败'
  }
}
