import { useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { X } from 'lucide-react'
import { getTabStore, getSettingsStore } from '../bridge'
import { renderMarkdown } from '../composables/useMarkdown'

interface ExportDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  renderedHtml: string
}

export default function ExportDialog({ open, onOpenChange, renderedHtml }: ExportDialogProps) {
  const [exportFormat, setExportFormat] = useState<'html' | 'pdf'>('html')
  const [includeStyles, setIncludeStyles] = useState(true)
  const [pageFormat, setPageFormat] = useState<'A4' | 'A3' | 'Letter'>('A4')
  const [pageOrientation, setPageOrientation] = useState<'portrait' | 'landscape'>('portrait')

  const tabStore = getTabStore()
  const settingsStore = getSettingsStore()

  function buildExportHtml(htmlContent: string, printable = false): string {
    const isDark = settingsStore.isDark
    const bgColor = isDark ? '#0f172a' : '#ffffff'
    const textColor = isDark ? '#f9fafb' : '#1f2927'
    const borderColor = isDark ? '#374151' : '#e5e7eb'
    const codeBg = isDark ? '#1f2937' : '#f3f4f6'
    const linkColor = isDark ? '#60a5fa' : '#3b82f6'

    const styles = includeStyles
      ? `
    body { background-color: ${bgColor}; color: ${textColor}; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; line-height: 1.8; padding: 40px; margin: 0; }
    .markdown-content { max-width: 800px; margin: 0 auto; }
    h1, h2, h3, h4, h5, h6 { color: ${textColor}; margin: 1.5em 0 0.5em; }
    h1 { font-size: 2.5em; border-bottom: 2px solid ${borderColor}; padding-bottom: 0.3em; }
    h2 { font-size: 2em; border-bottom: 1px solid ${borderColor}; padding-bottom: 0.2em; }
    h3 { font-size: 1.5em; }
    p { margin: 1em 0; }
    code { background-color: ${codeBg}; padding: 0.2em 0.4em; border-radius: 4px; font-family: 'Fira Code', 'Consolas', monospace; font-size: 0.9em; }
    pre { background-color: ${codeBg}; padding: 1em; border-radius: 8px; overflow-x: auto; margin: 1em 0; }
    pre code { background: none; padding: 0; }
    ul, ol { margin: 1em 0; padding-left: 2em; }
    blockquote { border-left: 4px solid ${borderColor}; padding-left: 1em; margin: 1em 0; color: ${textColor}; background-color: ${codeBg}; padding: 0.5em 1em; border-radius: 0 8px 8px 0; }
    table { border-collapse: collapse; width: 100%; margin: 1em 0; }
    th, td { border: 1px solid ${borderColor}; padding: 0.5em 1em; text-align: left; }
    th { background-color: ${codeBg}; font-weight: 600; }
    img { max-width: 100%; border-radius: 8px; margin: 1em 0; }
    a { color: ${linkColor}; text-decoration: none; }
    hr { border: none; border-top: 1px solid ${borderColor}; margin: 2em 0; }
      `
      : ''

    const printStyles = printable
      ? `
    @page { size: ${pageFormat} ${pageOrientation}; margin: 16mm; }
    @media print { body { padding: 0; } .markdown-content { max-width: none; } pre, blockquote, table, img, svg { break-inside: avoid; } }
      `
      : ''

    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <title>${tabStore.activeTab?.name || 'MaduReader Export'}</title>
  <style>${styles}${printStyles}</style>
</head>
<body>
  <div class="markdown-content">${htmlContent}</div>
</body>
</html>`
  }

  function downloadFile(filename: string, content: string) {
    const blob = new Blob([content], { type: 'text/html;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  async function handleExport() {
    if (!tabStore.activeTab) return

    const htmlContent = renderedHtml || renderMarkdown(tabStore.activeContent)

    if (exportFormat === 'html') {
      const fullHtml = buildExportHtml(htmlContent)
      downloadFile(`${tabStore.activeTab.name.replace('.md', '')}.html`, fullHtml)
    } else {
      const printWindow = window.open('', '_blank')
      if (!printWindow) {
        alert('无法打开打印窗口，请检查浏览器弹窗设置')
        return
      }
      printWindow.document.open()
      printWindow.document.write(buildExportHtml(htmlContent, true))
      printWindow.document.close()
      printWindow.focus()
      setTimeout(() => printWindow.print(), 100)
    }
    onOpenChange(false)
  }

  const label = 'block text-sm text-[color:var(--color-text-primary)] mb-1.5'
  const input =
    'w-full px-3 py-2 text-sm bg-[color:var(--color-bg-secondary)] border border-[color:var(--color-border-base)] rounded-md text-[color:var(--color-text-primary)] focus:outline-none focus:border-[color:var(--color-primary)]'

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/50 z-[9999] animate-fade-in" />
        <Dialog.Content className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[90%] max-w-[500px] max-h-[80vh] overflow-y-auto bg-[color:var(--color-bg-primary)] rounded-lg shadow-xl border border-[color:var(--color-border-base)] animate-fade-in">
          <div className="flex items-center justify-between px-5 py-4 border-b border-[color:var(--color-border-base)] bg-[color:var(--color-sidebar-header)]">
            <Dialog.Title className="text-lg font-semibold text-[color:var(--color-text-primary)]">
              导出文档
            </Dialog.Title>
            <Dialog.Close asChild>
              <button className="w-8 h-8 flex items-center justify-center rounded-md text-[color:var(--color-text-secondary)] hover:bg-[color:var(--color-bg-hover)] transition-colors">
                <X size={18} />
              </button>
            </Dialog.Close>
          </div>

          <div className="p-5">
            <div className="mb-6">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-[color:var(--color-text-secondary)] mb-3">
                导出格式
              </h3>
              <div className="flex gap-4">
                {(['html', 'pdf'] as const).map((f) => (
                  <label key={f} className="flex items-center gap-2 cursor-pointer text-sm">
                    <input
                      type="radio"
                      name="export-format"
                      checked={exportFormat === f}
                      onChange={() => setExportFormat(f)}
                    />
                    <span className="uppercase">{f}</span>
                  </label>
                ))}
              </div>
            </div>

            <div className="mb-6">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-[color:var(--color-text-secondary)] mb-3">
                导出选项
              </h3>
              <label className="flex items-center gap-2 cursor-pointer text-sm mb-2">
                <input
                  type="checkbox"
                  checked={includeStyles}
                  onChange={(e) => setIncludeStyles(e.target.checked)}
                />
                包含样式
              </label>
            </div>

            {exportFormat === 'pdf' && (
              <div className="mb-6">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-[color:var(--color-text-secondary)] mb-3">
                  页面设置
                </h3>
                <div className="mb-3">
                  <label className={label}>页面格式</label>
                  <select
                    className={input}
                    value={pageFormat}
                    onChange={(e) => setPageFormat(e.target.value as 'A4' | 'A3' | 'Letter')}
                  >
                    <option value="A4">A4</option>
                    <option value="A3">A3</option>
                    <option value="Letter">Letter</option>
                  </select>
                </div>
                <div>
                  <label className={label}>页面方向</label>
                  <select
                    className={input}
                    value={pageOrientation}
                    onChange={(e) =>
                      setPageOrientation(e.target.value as 'portrait' | 'landscape')
                    }
                  >
                    <option value="portrait">纵向</option>
                    <option value="landscape">横向</option>
                  </select>
                </div>
              </div>
            )}

            <div className="flex gap-3 pt-5 border-t border-[color:var(--color-border-base)]">
              <button
                className="px-4 py-2 text-sm font-medium rounded-md bg-[color:var(--color-primary)] text-white hover:bg-[color:var(--color-primary-hover)] transition-colors"
                onClick={handleExport}
              >
                开始导出
              </button>
              <Dialog.Close asChild>
                <button className="px-4 py-2 text-sm font-medium rounded-md bg-[color:var(--color-bg-secondary)] border border-[color:var(--color-border-base)] text-[color:var(--color-text-primary)] hover:bg-[color:var(--color-bg-hover)] transition-colors">
                  取消
                </button>
              </Dialog.Close>
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
