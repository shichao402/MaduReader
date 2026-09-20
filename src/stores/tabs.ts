// Vanilla store：框架无关的单例状态 + 手动通知。
// React 侧通过 useSyncExternalStore 订阅，不再依赖任何响应式框架。

import type { SessionData } from '../lib/session'

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

type SidebarView = 'tree' | 'outline'
type Listener = () => void

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

class TabStore {
  private _tabs: Tab[] = []
  private _activeTabId: string | null = null
  private _workingDirectory = ''
  private _fileTree: FileNode[] = []
  private _sidebarView: SidebarView = 'tree'

  private _tabCounter = 0
  private _virtualFiles = new Map<string, string>()

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

  /** 测试隔离用：恢复到初始空状态 */
  reset(): void {
    this._tabs = []
    this._activeTabId = null
    this._workingDirectory = ''
    this._fileTree = []
    this._sidebarView = 'tree'
    this._tabCounter = 0
    this._virtualFiles.clear()
    this.emit()
  }

  // ---- 状态访问 ----

  get tabs(): Tab[] {
    return this._tabs
  }

  set tabs(value: Tab[]) {
    this._tabs = value
    this.emit()
  }

  get activeTabId(): string | null {
    return this._activeTabId
  }

  set activeTabId(value: string | null) {
    this._activeTabId = value
    this.emit()
  }

  get workingDirectory(): string {
    return this._workingDirectory
  }

  set workingDirectory(value: string) {
    this._workingDirectory = value
    this.emit()
  }

  get fileTree(): FileNode[] {
    return this._fileTree
  }

  set fileTree(value: FileNode[]) {
    this._fileTree = value
    this.emit()
  }

  get sidebarView(): SidebarView {
    return this._sidebarView
  }

  set sidebarView(value: SidebarView) {
    this._sidebarView = value
    this.emit()
  }

  get activeTab(): Tab | null {
    if (!this._activeTabId) return null
    return this._tabs.find((t) => t.id === this._activeTabId) || null
  }

  get activeContent(): string {
    return this.activeTab?.content || ''
  }

  // ---- 业务方法 ----

  async openFile(path: string): Promise<void> {
    const normalizedPath = normalizePath(path)
    console.log('[Tabs] openFile called for:', normalizedPath)
    try {
      let content: string
      if (this._virtualFiles.has(normalizedPath)) {
        content = this._virtualFiles.get(normalizedPath) || ''
      } else {
        const { allowAndReadTextFile } = await import('../lib/fsAccess')
        content = await allowAndReadTextFile(path)
      }
      const name = getBaseName(normalizedPath)

      // 检查是否已打开
      const existingTab = this._tabs.find((t) => t.path === normalizedPath && !t.isUntitled)
      if (existingTab) {
        this._activeTabId = existingTab.id
        this.emit()
        return
      }

      const newTab: Tab = {
        id: `tab-${Date.now()}-${++this._tabCounter}`,
        path: normalizedPath,
        name,
        content,
        isModified: false,
        isUntitled: false,
      }

      this._tabs.push(newTab)
      this._activeTabId = newTab.id

      // 设置工作目录
      if (!this._workingDirectory) {
        this._workingDirectory = getDirName(normalizedPath)
        // 首次确定工作目录后立即构建文件树，否则目录面板会一直是空的
        await this.refreshFileTree()
      }
      this.emit()
    } catch (e) {
      console.error('[Tabs] Failed to open file:', e)
      if (normalizedPath.includes('not-found')) {
        return
      }
      throw e
    }
  }

  newTab(): Tab {
    const tab: Tab = {
      id: `tab-${Date.now()}-${++this._tabCounter}`,
      path: '',
      name: `新建文档 ${this._tabs.length + 1}`,
      content: '',
      isModified: false,
      isUntitled: true,
    }

    this._tabs.push(tab)
    this._activeTabId = tab.id
    this.emit()
    return tab
  }

  async closeTab(id: string): Promise<void> {
    const index = this._tabs.findIndex((t) => t.id === id)
    if (index === -1) return

    this._tabs.splice(index, 1)

    if (this._activeTabId === id) {
      if (this._tabs.length > 0) {
        const newIndex = Math.min(index, this._tabs.length - 1)
        this._activeTabId = this._tabs[newIndex].id
      } else {
        this._activeTabId = null
      }
    }
    this.emit()
  }

  setActiveTab(id: string): void {
    if (this._tabs.some((t) => t.id === id)) {
      this._activeTabId = id
      this.emit()
    }
  }

  updateTabContent(id: string, content: string): void {
    const tab = this._tabs.find((t) => t.id === id)
    if (tab) {
      tab.content = content
      tab.isModified = true
      this.emit()
    }
  }

  saveActiveTab(): void {
    if (!this._activeTabId) return

    const active = this._tabs.find((t) => t.id === this._activeTabId)
    if (!active || active.isUntitled) return

    import('@tauri-apps/plugin-fs').then(async (fs) => {
      try {
        await fs.writeTextFile(active.path, active.content)
        active.isModified = false
        this.emit()
      } catch (e) {
        console.error('[Tabs] Failed to save file:', e)
      }
    })
  }

  async refreshFileTree(): Promise<void> {
    if (!this._workingDirectory) {
      return
    }

    const t0 = performance.now()
    try {
      this._fileTree =
        this._virtualFiles.size > 0
          ? this.buildVirtualFileTree(this._workingDirectory)
          : pruneNonMarkdownNodes(await this.buildFileTree(this._workingDirectory))
      void import('../lib/perfLog').then(({ perfLog }) =>
        perfLog(`frontend: file tree built in ${(performance.now() - t0).toFixed(0)}ms`),
      )
      this.emit()
    } catch (e) {
      console.error('[Tabs] Failed to refresh file tree:', e)
    }
  }

  async buildFileTree(dir = this._workingDirectory, depth = 0): Promise<FileNode[]> {
    const { allowAndReadDir } = await import('../lib/fsAccess')
    const emptyNodes: FileNode[] = []

    if (!dir || depth > 10) return emptyNodes

    let entries: Array<{ name: string; isDirectory: boolean }> = []
    try {
      entries = (await allowAndReadDir(dir)) || []
    } catch (e) {
      console.error('[Tabs] Failed to read directory:', e)
      return emptyNodes
    }

    const visibleEntries = entries.filter(
      (entry) => !entry.name.startsWith('.') && entry.name !== 'node_modules',
    )

    // 并行遍历子目录，深层目录树构建耗时从累加变为取最慢分支
    const nodes: FileNode[] = await Promise.all(
      visibleEntries.map(async (entry) => {
        const fullPath = `${dir}/${entry.name}`
        const node: FileNode = {
          name: entry.name,
          path: fullPath,
          isDir: entry.isDirectory,
          children: [],
          expanded: false,
        }
        if (entry.isDirectory) {
          node.children = await this.buildFileTree(fullPath, depth + 1)
        }
        return node
      }),
    )

    // 排序：目录在前，然后按名称
    nodes.sort((a, b) => {
      if (a.isDir && !b.isDir) return -1
      if (!a.isDir && b.isDir) return 1
      return a.name.localeCompare(b.name)
    })

    return nodes
  }

  private buildVirtualFileTree(root: string): FileNode[] {
    const normalizedRoot = normalizePath(root)
    const rootNodes: FileNode[] = []

    for (const filePath of this._virtualFiles.keys()) {
      const relativePath = filePath.startsWith(`${normalizedRoot}/`)
        ? filePath.substring(normalizedRoot.length + 1)
        : filePath
      const parts = relativePath.split('/').filter(Boolean)
      let currentLevel = rootNodes
      let currentPath = normalizedRoot

      parts.forEach((part, index) => {
        currentPath = `${currentPath}/${part}`
        const isLast = index === parts.length - 1
        let node = currentLevel.find((item) => item.name === part)

        if (!node) {
          node = {
            name: part,
            path: currentPath,
            isDir: !isLast,
            children: [],
            expanded: !isLast,
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
      nodes.forEach((node) => sortNodes(node.children))
    }
    sortNodes(rootNodes)
    return rootNodes
  }

  setSidebarView(view: SidebarView): void {
    this._sidebarView = view
    this.emit()
  }

  setWorkingDirectory(dir: string): void {
    this._workingDirectory = normalizePath(dir)
    this.emit()
    void this.refreshFileTree()
  }

  async setVirtualWorkspace(root: string, files: VirtualFile[]): Promise<void> {
    const normalizedRoot = normalizePath(root)
    this._tabs = []
    this._activeTabId = null
    this._virtualFiles.clear()
    this._workingDirectory = normalizedRoot

    for (const file of files) {
      this._virtualFiles.set(normalizePath(file.path), file.content)
    }

    this._fileTree = this.buildVirtualFileTree(normalizedRoot)
    this.emit()

    const firstFile = files.find((file) => normalizePath(file.path).endsWith('.md'))
    if (firstFile) {
      await this.openFile(firstFile.path)
    }
  }

  toggleFileNode(nodePath: string): void {
    const node = findNodeInTree(this._fileTree, nodePath)
    if (node) {
      node.expanded = !node.expanded
      this.emit()
    }
  }

  findNode(targetPath: string): FileNode | undefined {
    return findNodeInTree(this._fileTree, normalizePath(targetPath))
  }

  openFileFromTree(path: string): void {
    if (!path.endsWith('.md')) return
    this.openFile(path).catch(console.error)
  }

  /** 当前会话快照：工作目录、打开的文件（按标签顺序）、最后显示的文件 */
  snapshotSession(): SessionData {
    return {
      workingDirectory: this._workingDirectory,
      openPaths: this._tabs.filter((t) => !t.isUntitled).map((t) => t.path),
      activePath: this.activeTab && !this.activeTab.isUntitled ? this.activeTab.path : null,
    }
  }

  /** 启动时恢复上次会话：并行授权+读取文件（串行是启动慢的主因之一），按原顺序落位标签，最后切到最后活动的文件 */
  async restoreSession(session: SessionData): Promise<void> {
    if (session.workingDirectory) {
      this._workingDirectory = normalizePath(session.workingDirectory)
    }
    const activeNormalized = session.activePath ? normalizePath(session.activePath) : null
    const paths = activeNormalized
      ? [activeNormalized, ...session.openPaths.filter((p) => normalizePath(p) !== activeNormalized)]
      : session.openPaths

    const restoreT0 = performance.now()
    // 并行做「授权 + 读文件」，单个失败跳过；results 下标顺序 = paths 顺序，保证标签顺序稳定
    const results = await Promise.all(
      paths.map(async (path) => {
        const normalizedPath = normalizePath(path)
        try {
          let content: string
          if (this._virtualFiles.has(normalizedPath)) {
            content = this._virtualFiles.get(normalizedPath) || ''
          } else {
            const { allowAndReadTextFile } = await import('../lib/fsAccess')
            content = await allowAndReadTextFile(path)
          }
          return { normalizedPath, content }
        } catch (e) {
          console.error('[Tabs] Failed to restore session file:', path, e)
          return null
        }
      }),
    )

    // 并行读文件耗时单独打点，便于与目录树构建耗时区分
    void import('../lib/perfLog').then(({ perfLog }) =>
      perfLog(`frontend: session file reads done in ${(performance.now() - restoreT0).toFixed(0)}ms`),
    )

    for (const result of results) {
      if (!result) continue
      // 恢复期间可能已被手动打开，避免重复建标签
      if (this._tabs.some((t) => t.path === result.normalizedPath && !t.isUntitled)) continue
      this._tabs.push({
        id: `tab-${Date.now()}-${++this._tabCounter}`,
        path: result.normalizedPath,
        name: getBaseName(result.normalizedPath),
        content: result.content,
        isModified: false,
        isUntitled: false,
      })
    }

    // 会话缺 workingDirectory 时，用第一个文件所在目录兜底（与原 openFile 行为一致）
    if (!this._workingDirectory && this._tabs.length > 0) {
      this._workingDirectory = getDirName(this._tabs[0].path)
    }
    if (activeNormalized) {
      const target = this._tabs.find((t) => t.path === activeNormalized)
      if (target) this._activeTabId = target.id
    }
    // 目录树构建（含递归授权）耗时较高，放后台执行不阻塞内容展示；完成后 refreshFileTree 内部会自行 emit
    if (this._workingDirectory && this._fileTree.length === 0) {
      void this.refreshFileTree()
    }
    this.emit()
  }
}

/** 判断文件名是否为本阅读器支持的 Markdown 文件 */
function isMarkdownFile(name: string): boolean {
  return /\.md$/i.test(name) || /\.markdown$/i.test(name)
}

/** 递归剪枝：目录无任何 Markdown 后代（含自身 md 文件）则整棵剔除 */
export function pruneNonMarkdownNodes(nodes: FileNode[]): FileNode[] {
  const result: FileNode[] = []
  for (const node of nodes) {
    if (!node.isDir) {
      if (isMarkdownFile(node.name)) result.push(node)
      continue
    }
    node.children = pruneNonMarkdownNodes(node.children || [])
    if (node.children.length > 0) result.push(node)
  }
  return result
}

export const tabStore = new TabStore()
