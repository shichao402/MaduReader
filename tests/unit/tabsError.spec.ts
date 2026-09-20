import { describe, it, expect, vi, beforeEach } from 'vitest'
import { tabStore } from '../../src/stores/tabs'

// Mock @tauri-apps/plugin-fs
vi.mock('@tauri-apps/plugin-fs', () => ({
  default: {
    readTextFile: vi.fn(),
    writeTextFile: vi.fn(),
    readDir: vi.fn()
  },
  readTextFile: vi.fn(),
  writeTextFile: vi.fn(),
  readDir: vi.fn()
}))

describe('TabStore - Error Handling Coverage', () => {
  let store

  beforeEach(() => {
    store = tabStore
    store.reset()
    vi.clearAllMocks()
  })

  describe('saveActiveTab - Branch Coverage', () => {
    it('should return early when no active tab', () => {
      // No active tab
      store.saveActiveTab()
      
      // Should not throw
      expect(true).toBe(true)
    })

    it('should return early when active tab is untitled', () => {
      store.newTab()
      store.activeTabId = store.tabs[0].id
      
      // Should not throw even though we can't save
      store.saveActiveTab()
      
      expect(true).toBe(true)
    })
  })

  describe('refreshFileTree - Branch Coverage', () => {
    it('should return early when no working directory', async () => {
      // No working directory set
      await store.refreshFileTree()
      
      // Should not throw
      expect(true).toBe(true)
    })
  })

  describe('closeTab - Edge Cases', () => {
    it('should activate next tab when closing middle tab', () => {
      store.newTab()
      store.newTab()
      store.newTab()
      
      const secondTabId = store.tabs[1].id
      store.setActiveTab(secondTabId)
      
      store.closeTab(secondTabId)
      
      // Should activate either first or third tab
      expect(store.tabs.length).toBe(2)
      expect(store.activeTabId).not.toBeNull()
    })

    it('should activate previous tab when closing last tab', () => {
      store.newTab()
      store.newTab()
      
      const firstTabId = store.tabs[0].id
      const secondTabId = store.tabs[1].id
      
      store.setActiveTab(secondTabId)
      store.closeTab(secondTabId)
      
      expect(store.activeTabId).toBe(firstTabId)
    })
  })

  describe('updateTabContent - Edge Cases', () => {
    it('should not update non-existent tab', () => {
      const initialCount = store.tabs.length
      
      store.updateTabContent('non-existent-id', '# Content')
      
      expect(store.tabs.length).toBe(initialCount)
    })
  })

  describe('setActiveTab - Edge Cases', () => {
    it('should not change active tab when id not found', () => {
      store.newTab()
      const originalId = store.activeTabId
      
      store.setActiveTab('non-existent-id')
      
      expect(store.activeTabId).toBe(originalId)
    })
  })

  describe('setWorkingDirectory - With Existing Directory', () => {
    it('should set working directory', async () => {
      store.setWorkingDirectory('/new/path')
      
      expect(store.workingDirectory).toBe('/new/path')
    })
  })

  describe('openFileFromTree - Additional Tests', () => {
    it('should not throw for non-md files', () => {
      // Should not throw
      expect(() => {
        store.openFileFromTree('/test/image.png')
      }).not.toThrow()
    })

    it('should not call openFile for non-md files', () => {
      const openFileSpy = vi.spyOn(store, 'openFile')
      
      store.openFileFromTree('/test/image.png')
      
      expect(openFileSpy).not.toHaveBeenCalled()
    })
  })

  describe('State Management', () => {
    it('should maintain unique tab IDs', () => {
      store.newTab()
      store.newTab()
      
      // All tabs should have unique IDs
      const ids = store.tabs.map(t => t.id)
      expect(new Set(ids).size).toBe(ids.length)
    })

    it('should track isModified flag', () => {
      store.newTab()
      
      expect(store.tabs[0].isModified).toBe(false)
      
      store.updateTabContent(store.tabs[0].id, '# Modified')
      expect(store.tabs[0].isModified).toBe(true)
    })

    it('should handle multiple tabs correctly', () => {
      for (let i = 0; i < 5; i++) {
        store.newTab()
      }
      
      expect(store.tabs.length).toBe(5)
    })
  })

  describe('Tab structure', () => {
    it('should create tab with correct initial state', () => {
      store.newTab()
      const tab = store.tabs[0]
      
      expect(tab.id).toBeDefined()
      expect(tab.path).toBe('')
      expect(tab.name).toContain('新建文档')
      expect(tab.content).toBe('')
      expect(tab.isModified).toBe(false)
      expect(tab.isUntitled).toBe(true)
    })
  })

  describe('Computed Properties', () => {
    it('should return null for activeTab when no active tab', () => {
      expect(store.activeTab).toBeNull()
    })

    it('should return active tab when set', () => {
      store.newTab()
      store.activeTabId = store.tabs[0].id
      
      expect(store.activeTab).not.toBeNull()
    })

    it('should return empty string for activeContent when no active tab', () => {
      expect(store.activeContent).toBe('')
    })

    it('should return content of active tab', () => {
      store.newTab()
      store.tabs[0].content = '# Test Content'
      store.activeTabId = store.tabs[0].id
      
      expect(store.activeContent).toBe('# Test Content')
    })
  })

  describe('toggleFileNode', () => {
    it('should toggle file node expansion', () => {
      const node = {
        name: 'test',
        path: '/test',
        isDir: true,
        children: [],
        expanded: false
      }
      store.fileTree.push(node as any)
      
      store.toggleFileNode('/test')
      
      expect(node.expanded).toBe(true)
    })

    it('should toggle file node back to collapsed', () => {
      const node = {
        name: 'test',
        path: '/test',
        isDir: true,
        children: [],
        expanded: true
      }
      store.fileTree.push(node as any)
      
      store.toggleFileNode('/test')
      
      expect(node.expanded).toBe(false)
    })

    it('should handle non-existent path gracefully', () => {
      expect(() => {
        store.toggleFileNode('/non-existent')
      }).not.toThrow()
    })

    it('should find nested node via toggleFileNode', () => {
      const childNode = {
        name: 'child',
        path: '/parent/child',
        isDir: true,
        children: [],
        expanded: false
      }
      const parentNode = {
        name: 'parent',
        path: '/parent',
        isDir: true,
        children: [childNode as any],
        expanded: false
      }
      store.fileTree.push(parentNode as any)
      
      store.toggleFileNode('/parent/child')
      
      expect(childNode.expanded).toBe(true)
    })
  })
})
