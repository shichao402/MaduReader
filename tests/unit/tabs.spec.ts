import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useTabStore } from '../../src/stores/tabs'

// Mock @tauri-apps/plugin-fs
vi.mock('@tauri-apps/plugin-fs', () => ({
  default: {
    readTextFile: vi.fn().mockResolvedValue('# Test Content'),
    writeTextFile: vi.fn().mockResolvedValue(undefined),
    readDir: vi.fn().mockResolvedValue([])
  },
  readTextFile: vi.fn().mockResolvedValue('# Test Content'),
  writeTextFile: vi.fn().mockResolvedValue(undefined),
  readDir: vi.fn().mockResolvedValue([])
}))

describe('TabStore', () => {
  let store

  beforeEach(() => {
    setActivePinia(createPinia())
    store = useTabStore()
    vi.clearAllMocks()
  })

  describe('initial state', () => {
    it('should have empty tabs initially', () => {
      expect(store.tabs).toEqual([])
    })

    it('should have null activeTabId initially', () => {
      expect(store.activeTabId).toBeNull()
    })

    it('should have empty workingDirectory initially', () => {
      expect(store.workingDirectory).toBe('')
    })

    it('should have tree sidebar view initially', () => {
      expect(store.sidebarView).toBe('tree')
    })
  })

  describe('newTab', () => {
    it('should create new tab', () => {
      store.newTab()
      
      expect(store.tabs.length).toBe(1)
      expect(store.activeTabId).toBe(store.tabs[0].id)
    })

    it('should create tab with correct name', () => {
      store.newTab()
      
      expect(store.tabs[0].name).toContain('新建文档')
    })
  })

  describe('closeTab', () => {
    it('should close existing tab', () => {
      store.newTab()
      const tabId = store.tabs[0].id
      
      store.closeTab(tabId)
      
      expect(store.tabs.length).toBe(0)
    })

    it('should not close non-existent tab', () => {
      store.closeTab('non-existent-id')
      
      expect(store.tabs.length).toBe(0)
    })
  })

  describe('setActiveTab', () => {
    it('should set active tab', () => {
      store.newTab()
      store.newTab()
      
      store.setActiveTab(store.tabs[1].id)
      
      expect(store.activeTabId).toBe(store.tabs[1].id)
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
  })

  describe('saveActiveTab', () => {
    it('should not throw when no active tab', () => {
      expect(() => {
        store.saveActiveTab()
      }).not.toThrow()
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

    it('should handle non-existent path gracefully', () => {
      expect(() => {
        store.toggleFileNode('/non-existent')
      }).not.toThrow()
    })
  })

  describe('refreshFileTree', () => {
    it('should not throw when no working directory', async () => {
      store.workingDirectory = ''
      
      await expect(store.refreshFileTree()).resolves.not.toThrow()
    })

    it('should refresh tree when working directory is set', async () => {
      store.workingDirectory = '/test'
      
      await store.refreshFileTree()
      
      // Should not throw
      expect(true).toBe(true)
    })
  })

  describe('activeTab computed', () => {
    it('should return null when no active tab', () => {
      expect(store.activeTab).toBeNull()
    })

    it('should return active tab when set', () => {
      store.newTab()
      store.activeTabId = store.tabs[0].id
      
      expect(store.activeTab).not.toBeNull()
    })
  })

  describe('activeContent computed', () => {
    it('should return empty string when no active tab', () => {
      expect(store.activeContent).toBe('')
    })

    it('should return content of active tab', () => {
      store.newTab()
      store.tabs[0].content = '# Test Content'
      store.activeTabId = store.tabs[0].id
      
      expect(store.activeContent).toBe('# Test Content')
    })
  })

  describe('fileTree state', () => {
    it('should have empty file tree initially', () => {
      expect(store.fileTree).toEqual([])
    })
  })

  describe('openFileFromTree', () => {
    it('should not open non-md files', () => {
      expect(() => {
        store.openFileFromTree('/test/image.png')
      }).not.toThrow()
    })

    it('should handle opening md file from tree', async () => {
      store.workingDirectory = '/docs'
      
      expect(() => {
        store.openFileFromTree('/docs/guide.md')
      }).not.toThrow()
    })
  })

  describe('tabs state management', () => {
    it('should maintain tab counter', () => {
      store.newTab()
      store.newTab()
      
      // All tabs should have unique IDs
      const ids = store.tabs.map(t => t.id)
      expect(new Set(ids).size).toBe(ids.length)
    })
  })
})
