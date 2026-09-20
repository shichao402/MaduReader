// Vanilla store：框架无关的单例状态 + 手动通知。
// React 侧通过 useSyncExternalStore 订阅，不再依赖任何响应式框架。

import { invoke } from '@tauri-apps/api/core'

export interface MermaidConfig {
  theme: string
  securityLevel: string
  startOnLoad: boolean
}

export interface Settings {
  theme: 'light' | 'dark' | 'system'
  fontSize: number
  zoom: number
  sidebarCollapsed: boolean
  sidebarPosition: 'left' | 'right'
  sidebarView: 'tree' | 'outline'
  codeHighlightTheme: string
  showLineNumbers: boolean
  autoSave: boolean
  mermaidConfig: MermaidConfig
  plantUmlServer: string
  proxyEnabled: boolean
  proxyServer: string
  windowMaterial: 'off' | 'mica' | 'acrylic'
}

export const DEFAULT_SETTINGS: Settings = {
  theme: 'system',
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
  windowMaterial: 'mica',
}

const STORAGE_KEY = 'madureader-settings'

function isTauriRuntime(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}

type Listener = () => void

class SettingsStore {
  private _settings: Settings = { ...DEFAULT_SETTINGS }
  private _isLoaded = false

  private _version = 0
  private _listeners = new Set<Listener>()

  subscribe = (listener: Listener): (() => void) => {
    this._listeners.add(listener)
    return () => {
      this._listeners.delete(listener)
    }
  }

  private emit(): void {
    this._version += 1
    this._listeners.forEach((listener) => listener())
  }

  get version(): number {
    return this._version
  }

  /** 测试隔离用：恢复默认设置 */
  reset(): void {
    this._settings = { ...DEFAULT_SETTINGS }
    this._isLoaded = false
    this.emit()
  }

  get settings(): Settings {
    return this._settings
  }

  /** 显式更新入口：合并部分字段后通知并持久化 */
  update(patch: Partial<Settings>, options: { save?: boolean } = {}): void {
    this._settings = { ...this._settings, ...patch }
    if (options.save !== false) {
      this.saveSettings()
    }
    this.emit()
  }

  get isLoaded(): boolean {
    return this._isLoaded
  }

  get isDark(): boolean {
    if (this._settings.theme === 'system') {
      return window.matchMedia('(prefers-color-scheme: dark)').matches
    }
    return this._settings.theme === 'dark'
  }

  get themeClass(): string {
    return this.isDark ? 'dark' : 'light'
  }

  get currentZoom(): number {
    return this._settings.zoom
  }

  async loadSettings(): Promise<void> {
    try {
      if (!isTauriRuntime()) {
        const data = window.localStorage.getItem(STORAGE_KEY)
        if (data) {
          const loaded = JSON.parse(data)
          this._settings = { ...DEFAULT_SETTINGS, ...loaded }
        }
        this._isLoaded = true
        this.applyTheme()
        this.emit()
        return
      }

      let data: string | null = null
      try {
        data = await invoke<string>('read_config_file')
      } catch {
        // 配置文件不存在时使用默认值
      }

      if (data) {
        const loaded = JSON.parse(data)
        this._settings = { ...DEFAULT_SETTINGS, ...loaded }
      }
      this._isLoaded = true
      this.applyTheme()
      void this.applyWindowMaterial()
      this.listenSystemTheme()
      this.emit()
    } catch (e) {
      console.error('[Settings] Failed to load settings:', e)
      this._isLoaded = true
      this.emit()
    }
  }

  async saveSettings(): Promise<boolean> {
    try {
      if (!isTauriRuntime()) {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(this._settings))
        return true
      }

      await invoke('write_config_file', {
        content: JSON.stringify(this._settings, null, 2),
      })
      return true
    } catch (e) {
      console.error('[Settings] Failed to save settings:', e)
      return false
    }
  }

  /** 监听系统深浅色变化，theme=system 时实时跟随 */
  private listenSystemTheme(): void {
    if (typeof window === 'undefined' || !window.matchMedia) return
    window
      .matchMedia('(prefers-color-scheme: dark)')
      .addEventListener('change', () => {
        if (this._settings.theme === 'system') {
          this.applyTheme()
          this.emit()
        }
      })
  }

  applyTheme(): void {
    const root = document.documentElement
    root.classList.toggle('dark', this.isDark)
    root.classList.toggle('light', !this.isDark)
    if (isTauriRuntime()) {
      void invoke('set_tray_theme', { dark: this.isDark }).catch(() => {})
    }
  }

  async applyWindowMaterial(): Promise<void> {
    if (!isTauriRuntime()) return
    try {
      const { getCurrentWindow, Effect } = await import('@tauri-apps/api/window')
      const win = getCurrentWindow()
      await win.clearEffects()
      const material = this._settings.windowMaterial
      if (material === 'mica') {
        await win.setEffects({ effects: [Effect.Tabbed] })
      } else if (material === 'acrylic') {
        await win.setEffects({ effects: [Effect.Acrylic] })
      }
    } catch (e) {
      console.error('[Settings] applyWindowMaterial failed:', e)
    }
  }

  toggleTheme(): void {
    this._settings.theme = this._settings.theme === 'light' ? 'dark' : 'light'
    this.applyTheme()
    void this.applyWindowMaterial()
    void this.saveSettings()
    this.emit()
  }

  setTheme(theme: Settings['theme']): void {
    this._settings.theme = theme
    this.applyTheme()
    void this.applyWindowMaterial()
    void this.saveSettings()
    this.emit()
  }

  setWindowMaterial(material: Settings['windowMaterial']): void {
    this._settings.windowMaterial = material
    void this.applyWindowMaterial()
    void this.saveSettings()
    this.emit()
  }

  setZoom(zoom: number): void {
    this._settings.zoom = Math.max(50, Math.min(200, zoom))
    void this.saveSettings()
    this.emit()
  }

  increaseZoom(): void {
    this.setZoom(this._settings.zoom + 10)
  }

  decreaseZoom(): void {
    this.setZoom(this._settings.zoom - 10)
  }

  resetZoom(): void {
    this.setZoom(100)
  }

  openSettings(): void {
    document.dispatchEvent(new CustomEvent('open-settings'))
    window.dispatchEvent(new CustomEvent('open-settings'))
  }
}

export const settingsStore = new SettingsStore()
