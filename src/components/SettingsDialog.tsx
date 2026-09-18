import * as Dialog from '@radix-ui/react-dialog'
import { X } from 'lucide-react'
import { getSettingsStore } from '../bridge'

interface SettingsDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

const themeOptions = [
  { value: 'light', label: '亮色' },
  { value: 'dark', label: '暗色' },
  { value: 'system', label: '跟随系统' },
]

const codeThemeOptions = [
  { value: 'github', label: 'GitHub' },
  { value: 'atom-one-dark', label: 'Atom One Dark' },
  { value: 'monokai', label: 'Monokai' },
  { value: 'solarized-dark', label: 'Solarized Dark' },
  { value: 'solarized-light', label: 'Solarized Light' },
  { value: 'vs2015', label: 'Visual Studio' },
  { value: 'xcode', label: 'Xcode' },
]

const fontSizeOptions = [
  { value: 12, label: '12px - 小' },
  { value: 14, label: '14px - 较小' },
  { value: 16, label: '16px - 中等' },
  { value: 18, label: '18px - 较大' },
  { value: 20, label: '20px - 大' },
]

const zoomOptions = [
  { value: 50, label: '50%' },
  { value: 75, label: '75%' },
  { value: 100, label: '100%' },
  { value: 125, label: '125%' },
  { value: 150, label: '150%' },
  { value: 200, label: '200%' },
]

const mermaidThemeOptions = [
  { value: 'default', label: '默认' },
  { value: 'base', label: '基础' },
  { value: 'dark', label: '暗色' },
  { value: 'forest', label: '森林' },
  { value: 'neutral', label: '中性' },
]

export default function SettingsDialog({ open, onOpenChange }: SettingsDialogProps) {
  const settingsStore = getSettingsStore()
  const s = settingsStore.settings

  const label = 'block text-sm text-[color:var(--color-text-primary)] mb-1.5'
  const input =
    'w-full px-3 py-2 text-sm bg-[color:var(--color-bg-secondary)] border border-[color:var(--color-border-base)] rounded-md text-[color:var(--color-text-primary)] focus:outline-none focus:border-[color:var(--color-primary)]'
  const section = 'mb-6'
  const sectionTitle =
    'text-xs font-semibold uppercase tracking-wide text-[color:var(--color-text-secondary)] mb-3'

  function save() {
    settingsStore.applyTheme()
    settingsStore.saveSettings()
  }

  function resetToDefaults() {
    if (confirm('确定要重置所有设置为默认值吗？')) {
      Object.assign(s, {
        theme: 'light',
        fontSize: 16,
        zoom: 100,
        sidebarCollapsed: false,
        sidebarPosition: 'left',
        sidebarView: 'tree',
        codeHighlightTheme: 'github',
        showLineNumbers: false,
        autoSave: false,
        mermaidConfig: {
          theme: 'default',
          securityLevel: 'loose',
          startOnLoad: true,
        },
        plantUmlServer: 'https://www.plantuml.com/plantuml',
        proxyEnabled: false,
        proxyServer: '',
      })
      settingsStore.applyTheme()
      save()
    }
  }

  function exportSettings() {
    const data = JSON.stringify(s, null, 2)
    const blob = new Blob([data], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'madureader-settings.json'
    a.click()
    URL.revokeObjectURL(url)
  }

  function importSettings() {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.json'
    input.onchange = (e: Event) => {
      const file = (e.target as HTMLInputElement).files?.[0]
      if (!file) return
      const reader = new FileReader()
      reader.onload = (ev) => {
        try {
          const data = JSON.parse(ev.target?.result as string)
          Object.assign(s, data)
          settingsStore.applyTheme()
          save()
          alert('设置导入成功')
        } catch {
          alert('导入失败：文件格式不正确')
        }
      }
      reader.readAsText(file)
    }
    input.click()
  }

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/50 z-[9999] animate-fade-in" />
        <Dialog.Content className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[90%] max-w-[600px] max-h-[80vh] overflow-y-auto bg-[color:var(--color-bg-primary)] rounded-lg shadow-xl border border-[color:var(--color-border-base)] animate-fade-in">
          <div className="flex items-center justify-between px-5 py-4 border-b border-[color:var(--color-border-base)] bg-[color:var(--color-sidebar-header)]">
            <Dialog.Title className="text-lg font-semibold text-[color:var(--color-text-primary)]">
              设置
            </Dialog.Title>
            <Dialog.Close asChild>
              <button className="w-8 h-8 flex items-center justify-center rounded-md text-[color:var(--color-text-secondary)] hover:bg-[color:var(--color-bg-hover)] transition-colors">
                <X size={18} />
              </button>
            </Dialog.Close>
          </div>

          <div className="p-5">
            <div className={section}>
              <h3 className={sectionTitle}>通用设置</h3>
              <div className="mb-3">
                <label className={label}>主题模式</label>
                <select
                  className={input}
                  value={s.theme}
                  onChange={(e) => {
                    s.theme = e.target.value as 'light' | 'dark' | 'system'
                    save()
                  }}
                >
                  {themeOptions.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="mb-3">
                <label className={label}>字体大小</label>
                <select
                  className={input}
                  value={s.fontSize}
                  onChange={(e) => {
                    s.fontSize = Number(e.target.value)
                    save()
                  }}
                >
                  {fontSizeOptions.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className={label}>默认缩放</label>
                <select
                  className={input}
                  value={s.zoom}
                  onChange={(e) => {
                    s.zoom = Number(e.target.value)
                    save()
                  }}
                >
                  {zoomOptions.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className={section}>
              <h3 className={sectionTitle}>外观设置</h3>
              <div className="mb-3">
                <label className={label}>代码高亮主题</label>
                <select
                  className={input}
                  value={s.codeHighlightTheme}
                  onChange={(e) => {
                    s.codeHighlightTheme = e.target.value
                    save()
                  }}
                >
                  {codeThemeOptions.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>
              <label className="flex items-center gap-2 cursor-pointer text-sm">
                <input
                  type="checkbox"
                  checked={s.showLineNumbers}
                  onChange={(e) => {
                    s.showLineNumbers = e.target.checked
                    save()
                  }}
                />
                显示代码行号
              </label>
            </div>

            <div className={section}>
              <h3 className={sectionTitle}>图表设置</h3>
              <div className="mb-3">
                <label className={label}>Mermaid 主题</label>
                <select
                  className={input}
                  value={s.mermaidConfig.theme}
                  onChange={(e) => {
                    s.mermaidConfig.theme = e.target.value
                    save()
                  }}
                >
                  {mermaidThemeOptions.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className={label}>PlantUML 服务器</label>
                <input
                  type="text"
                  className={input}
                  value={s.plantUmlServer}
                  onChange={(e) => {
                    s.plantUmlServer = e.target.value
                  }}
                  onBlur={save}
                  placeholder="https://www.plantuml.com/plantuml"
                />
              </div>
            </div>

            <div className={section}>
              <h3 className={sectionTitle}>代理设置</h3>
              <label className="flex items-center gap-2 cursor-pointer text-sm mb-3">
                <input
                  type="checkbox"
                  checked={s.proxyEnabled}
                  onChange={(e) => {
                    s.proxyEnabled = e.target.checked
                    save()
                  }}
                />
                启用代理
              </label>
              {s.proxyEnabled && (
                <div>
                  <label className={label}>代理服务器</label>
                  <input
                    type="text"
                    className={input}
                    value={s.proxyServer}
                    onChange={(e) => {
                      s.proxyServer = e.target.value
                    }}
                    onBlur={save}
                    placeholder="http://proxy.example.com:8080"
                  />
                </div>
              )}
            </div>

            <div className="flex flex-wrap gap-3 pt-5 border-t border-[color:var(--color-border-base)]">
              <button
                className="px-4 py-2 text-sm font-medium rounded-md bg-[color:var(--color-primary)] text-white hover:bg-[color:var(--color-primary-hover)] transition-colors"
                onClick={save}
              >
                保存设置
              </button>
              <button
                className="px-4 py-2 text-sm font-medium rounded-md bg-[color:var(--color-bg-secondary)] border border-[color:var(--color-border-base)] text-[color:var(--color-text-primary)] hover:bg-[color:var(--color-bg-hover)] transition-colors"
                onClick={resetToDefaults}
              >
                重置为默认
              </button>
              <button
                className="px-4 py-2 text-sm font-medium rounded-md bg-[color:var(--color-bg-secondary)] border border-[color:var(--color-border-base)] text-[color:var(--color-text-primary)] hover:bg-[color:var(--color-bg-hover)] transition-colors"
                onClick={exportSettings}
              >
                导出设置
              </button>
              <button
                className="px-4 py-2 text-sm font-medium rounded-md bg-[color:var(--color-bg-secondary)] border border-[color:var(--color-border-base)] text-[color:var(--color-text-primary)] hover:bg-[color:var(--color-bg-hover)] transition-colors"
                onClick={importSettings}
              >
                导入设置
              </button>
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
