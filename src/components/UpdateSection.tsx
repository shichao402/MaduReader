import { useCallback, useEffect, useState } from 'react'
import {
  applyUpdate,
  checkUpdate,
  describeUpdate,
  downloadUpdate,
  formatBytes,
  getUpdateStatus,
  onUpdateStatus,
  progressPercent,
  updatesSupported,
  type UpdateView,
} from '../lib/updater'
import { openUrl } from '../composables/useLinkHandler'

const btnPrimary =
  'px-3 py-1.5 text-xs rounded-md bg-[color:var(--color-primary)] text-white hover:bg-[color:var(--color-primary-hover)] transition-colors disabled:opacity-50 disabled:cursor-not-allowed'
const btnSecondary =
  'px-3 py-1.5 text-xs rounded-md bg-[color:var(--color-bg-secondary)] border border-[color:var(--color-border-base)] text-[color:var(--color-text-primary)] hover:bg-[color:var(--color-bg-hover)] transition-colors disabled:opacity-50 disabled:cursor-not-allowed'

const CHANNEL_LABEL: Record<string, string> = {
  stable: '正式版',
  dev: '开发版',
  local: '本地构建',
}

interface Props {
  open: boolean
  section: string
  sectionTitle: string
}

/** 设置页「软件更新」区块 */
export default function UpdateSection({ open, section, sectionTitle }: Props) {
  const [view, setView] = useState<UpdateView | null>(null)
  const [error, setError] = useState<string | null>(null)
  const supported = updatesSupported()

  useEffect(() => {
    if (!open || !supported) return
    let disposed = false
    let unlisten: (() => void) | undefined
    void getUpdateStatus()
      .then((v) => !disposed && v && setView(v))
      .catch((e) => setError(String(e)))
    void onUpdateStatus((v) => !disposed && setView(v)).then((fn) => {
      if (disposed) fn()
      else unlisten = fn
    })
    return () => {
      disposed = true
      unlisten?.()
    }
  }, [open, supported])

  const run = useCallback(async (action: () => Promise<UpdateView | null>) => {
    setError(null)
    try {
      const v = await action()
      if (v) setView(v)
    } catch (e) {
      setError(String(e))
    }
  }, [])

  const hint = 'text-xs text-[color:var(--color-text-secondary)]'

  if (!supported) {
    return (
      <div className={section}>
        <h3 className={sectionTitle}>软件更新</h3>
        <p className={hint}>当前环境不支持（Web 预览）。</p>
      </div>
    )
  }

  const phase = view?.phase
  const busy = phase === 'checking' || phase === 'downloading' || phase === 'applying'
  const pct = view ? progressPercent(view.progress) : null
  const notes = view?.available?.releaseNotes
  const notesUrl = view?.available?.releaseNotesUrl
  const manualUrl = view?.manualUrl

  return (
    <div className={section} data-testid="update-section">
      <h3 className={sectionTitle}>软件更新</h3>
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm text-[color:var(--color-text-primary)]">
            当前版本 {view?.currentVersion ?? '…'}
            {view && (
              <span className="ml-2 text-xs text-[color:var(--color-text-secondary)]">
                {CHANNEL_LABEL[view.channel] ?? view.channel}
              </span>
            )}
          </div>
          <div
            className={`text-xs truncate ${phase === 'error' ? 'text-red-500' : 'text-[color:var(--color-text-secondary)]'}`}
          >
            {view ? describeUpdate(view) : '正在读取更新状态…'}
          </div>
        </div>
        {view?.enabled && (
          <div className="flex items-center gap-2 shrink-0">
            {(phase === 'available' || (phase === 'error' && view.available)) && (
              <button className={btnPrimary} onClick={() => void run(downloadUpdate)}>
                下载更新
              </button>
            )}
            {phase === 'downloaded' && (
              <button className={btnPrimary} onClick={() => void run(applyUpdate)}>
                重启并安装
              </button>
            )}
            <button className={btnSecondary} disabled={busy} onClick={() => void run(checkUpdate)}>
              检查更新
            </button>
          </div>
        )}
      </div>

      {phase === 'downloading' && (
        <div className="mt-2">
          <div className="h-1.5 rounded-full bg-[color:var(--color-bg-secondary)] overflow-hidden">
            <div
              className="h-full bg-[color:var(--color-primary)] transition-all"
              style={{ width: `${pct ?? 0}%` }}
            />
          </div>
          {view?.progress && view.progress.bytesPerSecond > 0 && (
            <div className={`${hint} mt-1`}>{formatBytes(view.progress.bytesPerSecond)}/s</div>
          )}
        </div>
      )}

      {notes && (phase === 'available' || phase === 'downloading' || phase === 'downloaded') && (
        <pre className="mt-2 max-h-32 overflow-y-auto whitespace-pre-wrap text-xs p-2 rounded-md bg-[color:var(--color-bg-secondary)] text-[color:var(--color-text-primary)]">
          {notes}
        </pre>
      )}
      {notesUrl && (
        <a className="text-xs text-[color:var(--color-primary)] hover:underline" href={notesUrl} onClick={(e) => { e.preventDefault(); void openUrl(notesUrl) }}>
          查看更新说明
        </a>
      )}
      {phase === 'fallback' && manualUrl && (
        <a className="text-xs text-[color:var(--color-primary)] hover:underline" href={manualUrl} onClick={(e) => { e.preventDefault(); void openUrl(manualUrl) }}>
          前往下载页手动安装
        </a>
      )}
      {error && <p className="text-xs text-red-500 mt-2">{error}</p>}
    </div>
  )
}
