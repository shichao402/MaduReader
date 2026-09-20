import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { invoke } from '@tauri-apps/api/core'

console.log('[Settings] Module loaded')

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
  sidebarView: 'tree' | 'tabs'
  codeHighlightTheme: string
  showLineNumbers: boolean
  autoSave: boolean
  mermaidConfig: MermaidConfig
  plantUmlServer: string
  proxyEnabled: boolean
  proxyServer: string
  windowMaterial: 'off' | 'mica' | 'acrylic'
}

const DEFAULT_SETTINGS: Settings = {
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
    startOnLoad: true
  },
  plantUmlServer: 'https://www.plantuml.com/plantuml',
  proxyEnabled: false,
  proxyServer: '',
  windowMaterial: 'mica'
}

const STORAGE_KEY = 'madureader-settings'

function isTauriRuntime(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}

export const useSettingsStore = defineStore('settings', () => {
  console.log('[Settings] Store initialized')
  const settings = ref<Settings>({ ...DEFAULT_SETTINGS })
  const isLoaded = ref(false)

  const isDark = computed(() => {
    if (settings.value.theme === 'system') {
      return window.matchMedia('(prefers-color-scheme: dark)').matches
    }
    return settings.value.theme === 'dark'
  })

  const themeClass = computed(() => {
    return isDark.value ? 'dark' : 'light'
  })

  const currentZoom = computed(() => settings.value.zoom)

  async function loadSettings() {
    console.log('[Settings] loadSettings started')
    try {
      if (!isTauriRuntime()) {
        const data = window.localStorage.getItem(STORAGE_KEY)
        if (data) {
          const loaded = JSON.parse(data)
          settings.value = { ...DEFAULT_SETTINGS, ...loaded }
        }
        isLoaded.value = true
        applyTheme()
        return
      }

      const fs = await import('@tauri-apps/plugin-fs')
      console.log('[Settings] FS plugin loaded')
      
      const appDataDir = await invoke<string>('app_data_dir')
      console.log('[Settings] App data dir:', appDataDir)
      
      const configPath = `${appDataDir}config.json`
      
      // 检查配置文件是否存在
      let isFile = false
      try {
        await fs.readTextFile(configPath)
        isFile = true
      } catch {
        isFile = false
      }
      
      console.log('[Settings] Config file exists:', isFile)
      
      if (isFile) {
        const data = await fs.readTextFile(configPath)
        const loaded = JSON.parse(data)
        console.log('[Settings] Loaded settings from file:', loaded)
        settings.value = { ...DEFAULT_SETTINGS, ...loaded }
      }
      isLoaded.value = true
      console.log('[Settings] Applying theme, isDark:', isDark.value)
      applyTheme()
      void applyWindowMaterial()
      console.log('[Settings] loadSettings completed successfully')
    } catch (e) {
      console.error('[Settings] Failed to load settings:', e)
      isLoaded.value = true
    }
  }

  async function saveSettings() {
    try {
      if (!isTauriRuntime()) {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings.value))
        return
      }

      const fs = await import('@tauri-apps/plugin-fs')
      const appDataDir = await invoke<string>('app_data_dir')
      const configPath = `${appDataDir}config.json`
      
      await fs.writeTextFile(configPath, JSON.stringify(settings.value, null, 2))
    } catch (e) {
      console.error('[Settings] Failed to save settings:', e)
    }
  }

  function applyTheme() {
    const root = document.documentElement
    console.log('[Settings] applyTheme called, isDark:', isDark.value)
    console.log('[Settings] Root element:', root)
    root.classList.toggle('dark', isDark.value)
    root.classList.toggle('light', !isDark.value)
    console.log('[Settings] Theme classes applied:', root.className)
  }

  async function applyWindowMaterial() {
    if (!isTauriRuntime()) return
    try {
      const { getCurrentWindow, Effect } = await import('@tauri-apps/api/window')
      const win = getCurrentWindow()
      await win.clearEffects()
      const material = settings.value.windowMaterial
      if (material === 'mica') {
        await win.setEffects({ effects: [Effect.Tabbed] })
      } else if (material === 'acrylic') {
        await win.setEffects({ effects: [Effect.Acrylic] })
      }
    } catch (e) {
      console.error('[Settings] applyWindowMaterial failed:', e)
    }
  }

  function toggleTheme() {
    settings.value.theme = settings.value.theme === 'light' ? 'dark' : 'light'
    applyTheme()
    void applyWindowMaterial()
    saveSettings()
  }

  function setTheme(theme: 'light' | 'dark' | 'system') {
    settings.value.theme = theme
    applyTheme()
    void applyWindowMaterial()
    saveSettings()
  }

  function setZoom(zoom: number) {
    settings.value.zoom = Math.max(50, Math.min(200, zoom))
    saveSettings()
  }

  function increaseZoom() {
    setZoom(settings.value.zoom + 10)
  }

  function decreaseZoom() {
    setZoom(settings.value.zoom - 10)
  }

  function resetZoom() {
    setZoom(100)
  }

  function openSettings() {
    document.dispatchEvent(new CustomEvent('open-settings'))
    window.dispatchEvent(new CustomEvent('open-settings'))
  }

  return {
    settings,
    isLoaded,
    isDark,
    themeClass,
    currentZoom,
    loadSettings,
    saveSettings,
    applyTheme,
    applyWindowMaterial,
    toggleTheme,
    setTheme,
    setWindowMaterial(material: 'off' | 'mica' | 'acrylic') {
      settings.value.windowMaterial = material
      void applyWindowMaterial()
      saveSettings()
    },
    setZoom,
    increaseZoom,
    decreaseZoom,
    resetZoom,
    openSettings
  }
})
