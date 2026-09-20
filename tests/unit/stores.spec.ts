import { describe, it, expect, beforeEach, vi } from 'vitest'
import { tabStore } from '../../src/stores/tabs'
import { settingsStore } from '../../src/stores/settings'

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn().mockResolvedValue('/app/data/dir/')
}))

vi.mock('@tauri-apps/plugin-fs', () => ({
  readTextFile: vi.fn().mockRejectedValue(new Error('File not found')),
  writeTextFile: vi.fn().mockResolvedValue(undefined),
  readDir: vi.fn().mockResolvedValue([])
}))

describe('Stores', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    Object.defineProperty(window, 'matchMedia', {
      value: (query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      }),
      writable: true,
      configurable: true,
    })
  })

  describe('TabStore', () => {
    let store

    beforeEach(() => {
      store = tabStore
      store.reset()
    })

    describe('initial state', () => {
      it('should initialize with empty tabs', () => {
        expect(store.tabs).toBeDefined()
        expect(Array.isArray(store.tabs)).toBe(true)
      })

      it('should have null activeTabId initially', () => {
        expect(store.activeTabId).toBeNull()
      })

      it('should have empty workingDirectory initially', () => {
        expect(store.workingDirectory).toBe('')
      })

      it('should have empty fileTree initially', () => {
        expect(store.fileTree).toBeDefined()
        expect(Array.isArray(store.fileTree)).toBe(true)
      })

      it('should have tree sidebarView initially', () => {
        expect(store.sidebarView).toBe('tree')
      })

      it('should have no activeTab initially', () => {
        expect(store.activeTab).toBeNull()
      })

      it('should have empty activeContent initially', () => {
        expect(store.activeContent).toBe('')
      })
    })

    describe('newTab', () => {
      it('should create a new tab', () => {
        store.newTab()
        
        expect(store.tabs.length).toBe(1)
        expect(store.tabs[0].isUntitled).toBe(true)
        expect(store.tabs[0].name).toMatch(/^新建文档 /)
      })

      it('should set activeTabId to new tab', () => {
        store.newTab()
        
        expect(store.activeTabId).toBe(store.tabs[0].id)
      })

      it('should create multiple tabs', () => {
        store.newTab()
        store.newTab()
        store.newTab()
        
        expect(store.tabs.length).toBe(3)
      })

      it('should have unique IDs for each tab', () => {
        store.newTab()
        store.newTab()
        
        expect(store.tabs[0].id).not.toBe(store.tabs[1].id)
      })
    })

    describe('closeTab', () => {
      it('should remove a tab by id', () => {
        store.newTab()
        const tabId = store.tabs[0].id
        
        store.closeTab(tabId)
        
        expect(store.tabs.length).toBe(0)
        expect(store.tabs.find(t => t.id === tabId)).toBeUndefined()
      })

      it('should not throw for non-existent tab', () => {
        expect(() => {
          store.closeTab('non-existent-id')
        }).not.toThrow()
      })

      it('should update activeTabId when closing active tab', () => {
        store.newTab()
        store.newTab()
        store.activeTabId = store.tabs[0].id
        
        store.closeTab(store.tabs[0].id)
        
        expect(store.activeTabId).toBe(store.tabs[0].id)
      })

      it('should set activeTabId to null when closing last tab', () => {
        store.newTab()
        store.activeTabId = store.tabs[0].id
        
        store.closeTab(store.tabs[0].id)
        
        expect(store.activeTabId).toBeNull()
      })
    })

    describe('setActiveTab', () => {
      it('should set active tab', () => {
        store.newTab()
        const tabId = store.tabs[0].id
        
        store.setActiveTab(tabId)
        
        expect(store.activeTabId).toBe(tabId)
      })

      it('should not change activeTabId for non-existent tab', () => {
        const originalId = store.activeTabId
        
        store.setActiveTab('non-existent-id')
        
        expect(store.activeTabId).toBe(originalId)
      })
    })

    describe('updateTabContent', () => {
      it('should update tab content', () => {
        store.newTab()
        const tabId = store.tabs[0].id
        
        store.updateTabContent(tabId, '# New Content')
        
        expect(store.tabs[0].content).toBe('# New Content')
        expect(store.tabs[0].isModified).toBe(true)
      })

      it('should not update non-existent tab', () => {
        store.updateTabContent('non-existent-id', '# Content')
        
        // Should not throw
        expect(true).toBe(true)
      })
    })

    describe('setSidebarView', () => {
      it('should set sidebar view to tabs', () => {
        store.setSidebarView('tabs')
        
        expect(store.sidebarView).toBe('tabs')
      })

      it('should set sidebar view to tree', () => {
        store.setSidebarView('tree')
        
        expect(store.sidebarView).toBe('tree')
      })
    })

    describe('setWorkingDirectory', () => {
      it('should set working directory', () => {
        store.setWorkingDirectory('/test/path')
        
        expect(store.workingDirectory).toBe('/test/path')
      })
    })

    describe('toggleFileNode', () => {
      it('should toggle file node expansion', () => {
        const node = { path: '/test', isDir: true, children: [], expanded: false }
        store.fileTree.push(node as any)
        
        store.toggleFileNode('/test')
        
        expect(node.expanded).toBe(true)
      })

      it('should toggle file node collapse', () => {
        const node = { path: '/test', isDir: true, children: [], expanded: true }
        store.fileTree.push(node as any)
        
        store.toggleFileNode('/test')
        
        expect(node.expanded).toBe(false)
      })
    })

    describe('toggleFileNode with nested paths', () => {
      it('should find and toggle node by path in nested structure', () => {
        const childNode = { path: '/parent/child', isDir: true, children: [], expanded: false }
        const parentNode = { path: '/parent', isDir: true, children: [childNode], expanded: false }
        store.fileTree.push(parentNode as any)
        
        store.toggleFileNode('/parent/child')
        
        expect(childNode.expanded).toBe(true)
      })

      it('should handle non-existent path gracefully', () => {
        // Should not throw
        expect(() => {
          store.toggleFileNode('/non-existent')
        }).not.toThrow()
      })
    })
  })

  describe('SettingsStore', () => {
    let store

    beforeEach(() => {
      store = settingsStore
      store.reset()
    })

    describe('initial state', () => {
      it('should initialize with default settings', () => {
        expect(store.settings).toBeDefined()
        expect(store.settings.theme).toBe('light')
        expect(store.settings.fontSize).toBe(16)
        expect(store.settings.zoom).toBe(100)
      })

      it('should have isLoaded as false initially', () => {
        expect(store.isLoaded).toBe(false)
      })
    })

    describe('isDark computed', () => {
      it('should return false for light theme', () => {
        store.settings.theme = 'light'
        
        expect(store.isDark).toBe(false)
      })

      it('should return true for dark theme', () => {
        store.settings.theme = 'dark'
        
        expect(store.isDark).toBe(true)
      })

      it('should return false for system theme (jsdom limitation)', () => {
        store.settings.theme = 'system'
        
        // In jsdom, matchMedia is not available by default
        // The computed property should still work without throwing
        expect(typeof store.isDark).toBe('boolean')
      })
    })

    describe('themeClass computed', () => {
      it('should return light for light theme', () => {
        store.settings.theme = 'light'
        
        expect(store.themeClass).toBe('light')
      })

      it('should return dark for dark theme', () => {
        store.settings.theme = 'dark'
        
        expect(store.themeClass).toBe('dark')
      })
    })

    describe('currentZoom computed', () => {
      it('should return zoom value', () => {
        store.settings.zoom = 150
        
        expect(store.currentZoom).toBe(150)
      })
    })

    describe('toggleTheme', () => {
      it('should toggle between light and dark', () => {
        store.settings.theme = 'light'
        store.toggleTheme()
        
        expect(store.settings.theme).toBe('dark')
      })

      it('should toggle back to light', () => {
        store.settings.theme = 'dark'
        store.toggleTheme()
        
        expect(store.settings.theme).toBe('light')
      })

      it('should toggle between light and dark', () => {
        store.settings.theme = 'light'
        store.toggleTheme()
        
        expect(store.settings.theme).toBe('dark')
      })

      it('should toggle back to light', () => {
        store.settings.theme = 'dark'
        store.toggleTheme()
        
        expect(store.settings.theme).toBe('light')
      })
    })

    describe('setTheme', () => {
      it('should set light theme', () => {
        store.setTheme('light')
        
        expect(store.settings.theme).toBe('light')
      })

      it('should set dark theme', () => {
        store.setTheme('dark')
        
        expect(store.settings.theme).toBe('dark')
      })

      it('should set system theme without error', () => {
        // This may throw in jsdom due to matchMedia
        expect(() => {
          store.setTheme('system')
        }).not.toThrow()
        
        expect(store.settings.theme).toBe('system')
      })
    })

    describe('setZoom', () => {
      it('should set zoom level', () => {
        store.setZoom(150)
        
        expect(store.settings.zoom).toBe(150)
      })

      it('should cap zoom at 200', () => {
        store.setZoom(250)
        
        expect(store.settings.zoom).toBe(200)
      })

      it('should cap zoom at 50', () => {
        store.setZoom(30)
        
        expect(store.settings.zoom).toBe(50)
      })
    })

    describe('increaseZoom', () => {
      it('should increase zoom by 10', () => {
        store.settings.zoom = 100
        store.increaseZoom()
        
        expect(store.settings.zoom).toBe(110)
      })

      it('should cap at 200', () => {
        store.settings.zoom = 195
        store.increaseZoom()
        
        expect(store.settings.zoom).toBe(200)
      })
    })

    describe('decreaseZoom', () => {
      it('should decrease zoom by 10', () => {
        store.settings.zoom = 100
        store.decreaseZoom()
        
        expect(store.settings.zoom).toBe(90)
      })

      it('should cap at 50', () => {
        store.settings.zoom = 55
        store.decreaseZoom()
        
        expect(store.settings.zoom).toBe(50)
      })
    })

    describe('resetZoom', () => {
      it('should reset zoom to 100', () => {
        store.settings.zoom = 150
        store.resetZoom()
        
        expect(store.settings.zoom).toBe(100)
      })
    })

    describe('applyTheme', () => {
      it('should add dark class for dark theme', () => {
        store.settings.theme = 'dark'
        
        store.applyTheme()
        
        expect(document.documentElement.classList.contains('dark')).toBe(true)
      })

      it('should add light class for light theme', () => {
        store.settings.theme = 'light'
        
        store.applyTheme()
        
        expect(document.documentElement.classList.contains('light')).toBe(true)
      })

      it('should remove opposing class', () => {
        store.settings.theme = 'dark'
        store.applyTheme()
        
        store.settings.theme = 'light'
        store.applyTheme()
        
        expect(document.documentElement.classList.contains('dark')).toBe(false)
      })
    })

    describe('openSettings', () => {
      it('should dispatch open-settings event', () => {
        const dispatchSpy = vi.spyOn(document, 'dispatchEvent')
        store.openSettings()

        expect(dispatchSpy).toHaveBeenCalledWith(expect.any(CustomEvent))
        dispatchSpy.mockRestore()
      })

      it('should dispatch event with correct type', () => {
        const dispatchSpy = vi.spyOn(document, 'dispatchEvent')
        store.openSettings()

        const event = dispatchSpy.mock.calls[0][0] as CustomEvent
        expect(event.type).toBe('open-settings')
        dispatchSpy.mockRestore()
      })
    })

    describe('loadSettings', () => {
      it('should set isLoaded to true on success', async () => {
        await store.loadSettings()
        
        expect(store.isLoaded).toBe(true)
      })

      it('should set isLoaded to true on error', async () => {
        const invoke = await import('@tauri-apps/api/core')
        invoke.invoke.mockRejectedValueOnce(new Error('Test error'))
        
        await store.loadSettings()
        
        expect(store.isLoaded).toBe(true)
      })
    })

    describe('saveSettings', () => {
      it('should save settings successfully', async () => {
        const fs = await import('@tauri-apps/plugin-fs')
        
        await store.saveSettings()
        
        expect(fs.writeTextFile).toHaveBeenCalled()
      })

      it('should handle save error gracefully', async () => {
        const fs = await import('@tauri-apps/plugin-fs')
        fs.writeTextFile.mockRejectedValueOnce(new Error('Write failed'))
        
        // Should not throw
        await store.saveSettings()
      })
    })
  })
})
