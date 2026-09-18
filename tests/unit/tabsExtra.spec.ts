import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useTabStore } from '../../src/stores/tabs'

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

describe('TabStore - Additional Coverage', () => {
  let store

  beforeEach(() => {
    setActivePinia(createPinia())
    store = useTabStore()
    vi.clearAllMocks()
  })

  describe('openFile coverage', () => {
    it('should open file successfully', async () => {
      const fs = await import('@tauri-apps/plugin-fs')
      vi.mocked(fs.readTextFile).mockResolvedValue('# Test Content')
      
      await store.openFile('/test/file.md')
      
      expect(store.tabs.length).toBe(1)
      expect(store.tabs[0].path).toBe('/test/file.md')
      expect(store.tabs[0].name).toBe('file.md')
      expect(store.tabs[0].content).toBe('# Test Content')
    })

    it('should not open duplicate file', async () => {
      const fs = await import('@tauri-apps/plugin-fs')
      vi.mocked(fs.readTextFile).mockResolvedValue('# Test Content')
      
      await store.openFile('/test/file.md')
      await store.openFile('/test/file.md')
      
      expect(store.tabs.length).toBe(1)
    })

    it('should handle file open error', async () => {
      const fs = await import('@tauri-apps/plugin-fs')
      vi.mocked(fs.readTextFile).mockRejectedValue(new Error('File not found'))
      
      await expect(store.openFile('/test/file.md')).rejects.toThrow()
    })

    it('should set working directory from file path', async () => {
      const fs = await import('@tauri-apps/plugin-fs')
      vi.mocked(fs.readTextFile).mockResolvedValue('# Test')
      
      await store.openFile('/project/docs/file.md')
      
      expect(store.workingDirectory).toBe('/project/docs')
    })

    it('should extract filename correctly', async () => {
      const fs = await import('@tauri-apps/plugin-fs')
      vi.mocked(fs.readTextFile).mockResolvedValue('# Test')
      
      await store.openFile('/very/long/path/file.md')
      
      expect(store.tabs[0].name).toBe('file.md')
    })

    it('should handle file path without extension', async () => {
      const fs = await import('@tauri-apps/plugin-fs')
      vi.mocked(fs.readTextFile).mockResolvedValue('# Test')
      
      await store.openFile('/test/file')
      
      expect(store.tabs[0].name).toBe('file')
    })
  })

  describe('closeTab with active tab', () => {
    it('should switch to next tab when closing active', () => {
      store.newTab()
      store.newTab()
      store.newTab()
      
      // Make second tab active
      store.activeTabId = store.tabs[1].id
      
      // Close it
      store.closeTab(store.tabs[1].id)
      
      expect(store.activeTabId).toBe(store.tabs[1].id)
    })

    it('should switch to previous tab when closing last active', () => {
      store.newTab()
      store.newTab()
      
      // Make second tab active
      store.activeTabId = store.tabs[1].id
      
      // Close first tab
      store.closeTab(store.tabs[0].id)
      
      expect(store.activeTabId).toBe(store.tabs[0].id)
    })

    it('should set activeTabId to null when closing last tab', () => {
      store.newTab()
      store.activeTabId = store.tabs[0].id
      
      store.closeTab(store.tabs[0].id)
      
      expect(store.activeTabId).toBeNull()
    })

    it('should handle closing non-active tab', () => {
      store.newTab()
      store.newTab()
      
      const firstTabId = store.tabs[0].id
      const secondTabId = store.tabs[1].id
      store.activeTabId = secondTabId
      
      store.closeTab(firstTabId)
      
      expect(store.activeTabId).toBe(secondTabId)
    })
  })

  describe('setActiveTab coverage', () => {
    it('should not change active tab for non-existent id', () => {
      store.newTab()
      const originalId = store.activeTabId
      
      store.setActiveTab('non-existent-id')
      
      expect(store.activeTabId).toBe(originalId)
    })

    it('should handle setActiveTab with empty id', () => {
      store.newTab()
      
      store.setActiveTab('')
      
      // Should remain unchanged
      expect(store.tabs.length).toBe(1)
    })
  })

  describe('saveActiveTab coverage', () => {
    it('should save file successfully', async () => {
      const fs = await import('@tauri-apps/plugin-fs')
      vi.mocked(fs.writeTextFile).mockResolvedValue(undefined)
      
      store.newTab()
      store.tabs[0].path = '/test/save.md'
      store.tabs[0].isUntitled = false
      store.tabs[0].content = '# Saved Content'
      store.activeTabId = store.tabs[0].id
      
      store.saveActiveTab()
      
      await new Promise(resolve => setTimeout(resolve, 100))
      
      expect(fs.writeTextFile).toHaveBeenCalledWith('/test/save.md', '# Saved Content')
    })

    it('should not save untitled tab', async () => {
      store.newTab()
      store.tabs[0].isUntitled = true
      store.activeTabId = store.tabs[0].id
      
      store.saveActiveTab()
      
      await new Promise(resolve => setTimeout(resolve, 100))
      
      const fs = await import('@tauri-apps/plugin-fs')
      expect(fs.writeTextFile).not.toHaveBeenCalled()
    })

    it('should not save when no active tab', async () => {
      store.saveActiveTab()
      
      await new Promise(resolve => setTimeout(resolve, 100))
      
      const fs = await import('@tauri-apps/plugin-fs')
      expect(fs.writeTextFile).not.toHaveBeenCalled()
    })

    it('should handle save error gracefully', async () => {
      const fs = await import('@tauri-apps/plugin-fs')
      vi.mocked(fs.writeTextFile).mockRejectedValue(new Error('Write failed'))
      
      store.newTab()
      store.tabs[0].path = '/test/save.md'
      store.tabs[0].isUntitled = false
      store.activeTabId = store.tabs[0].id
      
      // Should not throw
      store.saveActiveTab()
      
      await new Promise(resolve => setTimeout(resolve, 100))
    })
  })

  describe('refreshFileTree coverage', () => {
    it('should refresh tree successfully', async () => {
      const fs = await import('@tauri-apps/plugin-fs')
      vi.mocked(fs.readDir).mockResolvedValue([])
      
      store.workingDirectory = '/test'
      
      await store.refreshFileTree()
      
      expect(fs.readDir).toHaveBeenCalledWith('/test')
    })

    it('should handle refresh error gracefully', async () => {
      const fs = await import('@tauri-apps/plugin-fs')
      vi.mocked(fs.readDir).mockRejectedValue(new Error('Read failed'))
      
      store.workingDirectory = '/test'
      
      // Should not throw
      await store.refreshFileTree()
    })
  })

  describe('refreshFileTree with mock data', () => {
    it('should populate file tree with mock entries', async () => {
      const fs = await import('@tauri-apps/plugin-fs')
      vi.mocked(fs.readDir).mockImplementation((dir: string) => {
        if (dir === '/test') {
          return Promise.resolve([
            { name: 'docs', isDirectory: true },
            { name: 'readme.md', isDirectory: false },
          ])
        }
        return Promise.resolve([])
      })
      
      store.workingDirectory = '/test'
      
      await store.refreshFileTree()
      
      expect(store.fileTree.length).toBeGreaterThan(0)
    })
  })

  describe('openFileFromTree coverage', () => {
    it('should handle opening file that fails', async () => {
      const fs = await import('@tauri-apps/plugin-fs')
      vi.mocked(fs.readTextFile).mockRejectedValue(new Error('Failed'))
      
      store.workingDirectory = '/docs'
      
      // Should not throw
      store.openFileFromTree('/docs/guide.md')
      
      await new Promise(resolve => setTimeout(resolve, 100))
    })
  })

  describe('setWorkingDirectory coverage', () => {
    it('should set working directory', async () => {
      const fs = await import('@tauri-apps/plugin-fs')
      vi.mocked(fs.readDir).mockResolvedValue([])
      
      await store.setWorkingDirectory('/new/path')
      
      expect(store.workingDirectory).toBe('/new/path')
    })
  })

  describe('toggleFileNode coverage', () => {
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

  describe('sidebarView coverage', () => {
    it('should toggle sidebar view', () => {
      store.setSidebarView('tabs')
      expect(store.sidebarView).toBe('tabs')
      
      store.setSidebarView('tree')
      expect(store.sidebarView).toBe('tree')
    })
  })
})
