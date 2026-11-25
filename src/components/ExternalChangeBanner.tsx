import { RefreshCw, X } from 'lucide-react'

/** 正在阅读的文件在外部被修改：只提示，是否换成最新版本由用户决定。 */
export default function ExternalChangeBanner({ modified, onReload, onDismiss }: {
  modified: boolean
  onReload: () => void
  onDismiss: () => void
}) {
  return (
    <div role="status" className="shrink-0 flex items-center gap-2 border-b border-[color:var(--color-border-base)] bg-[color:var(--color-accent-soft)] dark:bg-[color:var(--color-accent-soft-dark)] text-[color:var(--color-text-primary)] px-4 py-2 text-sm">
      <RefreshCw size={15} className="shrink-0 text-[color:var(--color-accent)]" aria-hidden="true" />
      <span className="flex-1 min-w-0">
        文件已在外部修改{modified ? '，刷新将丢弃当前未保存的修改' : ''}
      </span>
      <button
        type="button"
        className="shrink-0 px-2.5 py-1 rounded-md text-[13px] font-medium text-white bg-[color:var(--color-accent)] hover:bg-[color:var(--color-accent-hover)] transition-colors"
        onClick={onReload}
      >
        刷新查看最新版本
      </button>
      <button type="button" className="shrink-0 p-1 rounded-md hover:bg-[color:var(--color-sidebar-hover)]" aria-label="忽略外部修改提示" title="忽略，继续阅读当前版本" onClick={onDismiss}>
        <X size={15} />
      </button>
    </div>
  )
}
