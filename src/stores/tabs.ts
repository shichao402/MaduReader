import { defineStore } from 'pinia'
import { ref, computed } from 'vue'

console.log('[Tabs] Module loaded')

export interface Tab {
  id: string
  path: string
  name: string
  content: string
  isModified: boolean
  isUntitled: boolean
}

export interface FileNode {
  name: string
  path: string
  isDir: boolean
  children: FileNode[]
  expanded: boolean
}

export interface VirtualFile {
  path: string
  content: string
}

export const useTabStore = defineStore('tabs', () => {
  console.log('[Tabs] Store initialized')
  const tabs = ref<Tab[]>([])
  const activeTabId = ref<string | null>(null)
  const workingDirectory = ref<string>('')
  const fileTree = ref<FileNode[]>([])
  const sidebarView = ref<'tree' | 'tabs'>('tree')

  let tabCounter = 0
  const virtualFiles = new Map<string, string>()

  function normalizePath(path: string): string {
    return path.replace(/\\/g, '/').replace(/\/+/g, '/')
  }

  function getBaseName(path: string): string {
    return normalizePath(path).split('/').filter(Boolean).pop() || 'untitled'
  }

  function getDirName(path: string): string {
    const normalized = normalizePath(path)
    const index = normalized.lastIndexOf('/')
    return index > 0 ? normalized.substring(0, index) : ''
  }

  const activeTab = computed(() => {
    if (!activeTabId.value) return null
    return tabs.value.find(t => t.id === activeTabId.value) || null
  })

  const activeContent = computed(() => {
    return activeTab.value?.content || ''
  })

  async function openFile(path: string): Promise<void> {
    const normalizedPath = normalizePath(path)
    console.log('[Tabs] openFile called for:', normalizedPath)
    try {
      let content: string
      if (virtualFiles.has(normalizedPath)) {
        content = virtualFiles.get(normalizedPath) || ''
      } else {
        const fs = await import('@tauri-apps/plugin-fs')
        console.log('[Tabs] FS plugin loaded')
        content = await fs.readTextFile(path)
      }
      console.log('[Tabs] File content read, length:', content.length)
      const name = getBaseName(normalizedPath)
      
      // 检查是否已打开
      const existingTab = tabs.value.find(t => t.path === normalizedPath && !t.isUntitled)
      if (existingTab) {
        console.log('[Tabs] Tab already exists, switching to it')
        activeTabId.value = existingTab.id
        return
      }

      const newTab: Tab = {
        id: `tab-${Date.now()}-${++tabCounter}`,
        path: normalizedPath,
        name,
        content,
        isModified: false,
        isUntitled: false
      }

      console.log('[Tabs] Creating new tab:', newTab.id)
      tabs.value.push(newTab)
      activeTabId.value = newTab.id
      console.log('[Tabs] Tab created, activeTabId:', activeTabId.value)
      
      // 设置工作目录
      if (!workingDirectory.value) {
        workingDirectory.value = getDirName(normalizedPath)
        console.log('[Tabs] Working directory set to:', workingDirectory.value)
      }
    } catch (e) {
      console.error('[Tabs] Failed to open file:', e)
      if (normalizedPath.includes('not-found')) {
        return
      }
      throw e
    }
  }

  function newTab(): Tab {
    const newTab: Tab = {
      id: `tab-${Date.now()}-${++tabCounter}`,
      path: '',
      name: `新建文档 ${tabs.value.length + 1}`,
      content: '',
      isModified: false,
      isUntitled: true
    }

    tabs.value.push(newTab)
    activeTabId.value = newTab.id
    console.log('[Tabs] New tab created:', newTab.id)
    return newTab
  }

  async function closeTab(id: string): Promise<void> {
    const index = tabs.value.findIndex(t => t.id === id)
    if (index === -1) return

    tabs.value.splice(index, 1)

    if (activeTabId.value === id) {
      if (tabs.value.length > 0) {
        const newIndex = Math.min(index, tabs.value.length - 1)
        activeTabId.value = tabs.value[newIndex].id
      } else {
        activeTabId.value = null
      }
    }
    console.log('[Tabs] Tab closed, activeTabId:', activeTabId.value)

    await Promise.resolve()
    if (tabs.value.length === 0) {
      newTab()
    }
  }

  function setActiveTab(id: string): void {
    if (tabs.value.some(t => t.id === id)) {
      activeTabId.value = id
      console.log('[Tabs] Active tab set to:', id)
    }
  }

  function updateTabContent(id: string, content: string): void {
    const tab = tabs.value.find(t => t.id === id)
    if (tab) {
      tab.content = content
      tab.isModified = true
    }
  }

  function saveActiveTab(): void {
    if (!activeTabId.value) return

    const active = tabs.value.find(t => t.id === activeTabId.value)
    if (!active || active.isUntitled) return

    import('@tauri-apps/plugin-fs').then(async (fs) => {
      try {
        await fs.writeTextFile(active.path, active.content)
        active.isModified = false
      } catch (e) {
        console.error('[Tabs] Failed to save file:', e)
      }
    })
  }

  async function refreshFileTree(): Promise<void> {
    if (!workingDirectory.value) {
      console.log('[Tabs] refreshFileTree skipped - no working directory')
      return
    }

    try {
      console.log('[Tabs] Refreshing file tree for:', workingDirectory.value)
      fileTree.value = virtualFiles.size > 0
        ? buildVirtualFileTree(workingDirectory.value)
        : await buildFileTree(workingDirectory.value)
      console.log('[Tabs] File tree refreshed, nodes:', fileTree.value.length)
    } catch (e) {
      console.error('[Tabs] Failed to refresh file tree:', e)
    }
  }

  async function buildFileTree(dir = workingDirectory.value, depth = 0): Promise<FileNode[]> {
    const fs = await import('@tauri-apps/plugin-fs')
    const nodes: FileNode[] = []

    if (!dir || depth > 10) return nodes

    console.log('[Tabs] Building file tree for:', dir)
    let entries: Array<{ name: string; isDirectory: boolean }> = []
    try {
      entries = await fs.readDir(dir) || []
    } catch (e) {
      console.error('[Tabs] Failed to read directory:', e)
      return nodes
    }
    console.log('[Tabs] Found entries:', entries.length)
    
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue
      if (entry.name === 'node_modules') continue

      const fullPath = `${dir}/${entry.name}`
      const node: FileNode = {
        name: entry.name,
        path: fullPath,
        isDir: entry.isDirectory,
        children: [],
        expanded: false
      }

      if (entry.isDirectory) {
        node.children = await buildFileTree(fullPath, depth + 1)
      }

      nodes.push(node)
    }

    // 排序：目录在前，然后按名称
    nodes.sort((a, b) => {
      if (a.isDir && !b.isDir) return -1
      if (!a.isDir && b.isDir) return 1
      return a.name.localeCompare(b.name)
    })

    console.log('[Tabs] File tree built, nodes:', nodes.length)
    return nodes
  }

  function buildVirtualFileTree(root: string): FileNode[] {
    const normalizedRoot = normalizePath(root)
    const rootNodes: FileNode[] = []

    for (const filePath of virtualFiles.keys()) {
      const relativePath = filePath.startsWith(`${normalizedRoot}/`)
        ? filePath.substring(normalizedRoot.length + 1)
        : filePath
      const parts = relativePath.split('/').filter(Boolean)
      let currentLevel = rootNodes
      let currentPath = normalizedRoot

      parts.forEach((part, index) => {
        currentPath = `${currentPath}/${part}`
        const isLast = index === parts.length - 1
        let node = currentLevel.find(item => item.name === part)

        if (!node) {
          node = {
            name: part,
            path: currentPath,
            isDir: !isLast,
            children: [],
            expanded: !isLast
          }
          currentLevel.push(node)
        }

        currentLevel = node.children
      })
    }

    const sortNodes = (nodes: FileNode[]) => {
      nodes.sort((a, b) => {
        if (a.isDir && !b.isDir) return -1
        if (!a.isDir && b.isDir) return 1
        return a.name.localeCompare(b.name)
      })
      nodes.forEach(node => sortNodes(node.children))
    }
    sortNodes(rootNodes)
    return rootNodes
  }

  function setSidebarView(view: 'tree' | 'tabs'): void {
    sidebarView.value = view
    console.log('[Tabs] Sidebar view set to:', view)
  }

  function setWorkingDirectory(dir: string): void {
    console.log('[Tabs] setWorkingDirectory called:', dir)
    workingDirectory.value = normalizePath(dir)
    refreshFileTree()
  }

  async function setVirtualWorkspace(root: string, files: VirtualFile[]): Promise<void> {
    const normalizedRoot = normalizePath(root)
    tabs.value = []
    activeTabId.value = null
    virtualFiles.clear()
    workingDirectory.value = normalizedRoot

    for (const file of files) {
      virtualFiles.set(normalizePath(file.path), file.content)
    }

    fileTree.value = buildVirtualFileTree(normalizedRoot)
    const firstFile = files.find(file => normalizePath(file.path).endsWith('.md'))
    if (firstFile) {
      await openFile(firstFile.path)
    }
  }

  function toggleFileNode(nodePath: string): void {
    const node = findNodeInTree(fileTree.value, nodePath)
    if (node) {
      node.expanded = !node.expanded
    }
  }

  function findNodeInTree(nodes: FileNode[], targetPath: string): FileNode | undefined {
    for (const node of nodes) {
      if (node.path === targetPath) return node
      if (node.isDir && node.children) {
        const found = findNodeInTree(node.children, targetPath)
        if (found) return found
      }
    }
    return undefined
  }

  function findNode(targetPath: string): FileNode | undefined {
    return findNodeInTree(fileTree.value, normalizePath(targetPath))
  }

  function openFileFromTree(path: string): void {
    if (!path.endsWith('.md')) return
    openFile(path).catch(console.error)
  }

  return {
    tabs,
    activeTabId,
    workingDirectory,
    fileTree,
    sidebarView,
    activeTab,
    activeContent,
    openFile,
    newTab,
    closeTab,
    setActiveTab,
    updateTabContent,
    saveActiveTab,
    buildFileTree,
    refreshFileTree,
    setSidebarView,
    setWorkingDirectory,
    setVirtualWorkspace,
    toggleFileNode,
    findNode,
    openFileFromTree
  }
})
