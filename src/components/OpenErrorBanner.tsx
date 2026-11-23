import { AlertCircle, X } from 'lucide-react'
import type { OpenErrorNotice } from '../lib/openPaths'

export default function OpenErrorBanner({ notice, onDismiss, onRetry }: {
  notice: OpenErrorNotice
  onDismiss: () => void
  onRetry: () => void
}) {
  return (
    <div role="alert" className="shrink-0 flex items-start gap-2 border-b border-[color:var(--color-border-base)] bg-[color:var(--color-warning-bg)] text-[color:var(--color-text-primary)] px-4 py-3 text-sm">
      <AlertCircle size={18} className="shrink-0 mt-0.5 text-[color:var(--color-warning)]" aria-hidden="true" />
      <div className="flex-1 min-w-0">
        <div className="font-medium">{notice.title}{notice.requestId !== undefined ? `（请求 ${notice.requestId}）` : ''}</div>
        <div className="whitespace-pre-wrap break-all max-h-32 overflow-auto mt-1 text-xs">{notice.details}</div>
      </div>
      {notice.retry && <button type="button" className="shrink-0 underline" onClick={onRetry}>重试处理</button>}
      <button type="button" className="shrink-0 p-1" aria-label="关闭打开错误提示" onClick={onDismiss}><X size={16} /></button>
    </div>
  )
}
