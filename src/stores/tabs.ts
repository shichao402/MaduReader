// Vanilla store：框架无关的单例状态 + 手动通知。
// React 侧通过 useSyncExternalStore 订阅，不再依赖任何响应式框架。

import type { SessionData } from '../lib/session'
import { perfLog } from '../lib/perfLog'
import { DEFAULT_FILE_POLICY, DAY_MS, compareFileActivity, filePathKey, sanitizeFilePolicy, sanitizeActivity, sanitizeInactive, type FilePolicy, type InactiveFile } from '../lib/fileActivity'

export interface Tab {
  id: string
  path: string
  name: string
  content: string
  isModified: boolean
  isUntitled: boolean
  sourceMissing?: boolean
  /** 磁盘上检测到的新版本；正在阅读或有未保存修改时不直接替换，由用户决定是否刷新。 */
  externalContent?: string
  lastAccessedAt?: number
  accessCount?: number
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

interface DirectoryScan {
  previousTree: FileNode[]
  directories: Map<string, Set<string>>
  failures: Map<string, string>
  readDir?: typeof import('../lib/fsAccess').allowAndReadDir
}

function normalizePath(path: string): string {
  const slashed = path.replace(/\\/g, '/')
  const collapsed = slashed.replace(/\/+/g, '/')
  const normalized = slashed.startsWith('//') ? `/${collapsed}` : collapsed
  // 不折叠 UNC 前缀，也不丢失盘符根目录/POSIX 根；保留大小写。
  if (normalized === '/' || normalized === '//' || /^[a-z]:\/$/i.test(normalized)) {
    return normalized
  }
  return normalized.replace(/\/+$/, '')
}

function directoryPrefix(path: string): string {
  return path.endsWith('/') ? path : `${path}/`
}

function joinPath(dir: string, name: string): string {
  return normalizePath(`${dir ? directoryPrefix(dir) : ''}${name}`)
}

function isWithinPath(path: string, dir: string): boolean {
  return path === dir || path.startsWith(directoryPrefix(dir))
}

function getBaseName(path: string): string {
  return normalizePath(path).split('/').filter(Boolean).pop() || 'untitled'
}

function getDirName(path: string): string {
  const normalized = normalizePath(path)
  const index = normalized.lastIndexOf('/')
  if (index === 0) return '/'
  if (index === 2 && /^[a-z]:\//i.test(normalized)) return normalized.slice(0, 3)
  return index > 0 ? normalized.substring(0, index) : ''
}

function findNodeInTree(nodes: FileNode[], targetPath: string): FileNode | undefined {
  for (const node of nodes) {
    if (normalizePath(node.path) === targetPath) return node
    if (node.isDir && node.children) {
      const found = findNodeInTree(node.children, targetPath)
      if (found) return found
    }
  }
  return undefined
}

function cloneFileTree(nodes: FileNode[]): FileNode[] {
  return nodes.map((node) => ({ ...node, children: cloneFileTree(node.children) }))
}

function sameFileTree(a: FileNode[], b: FileNode[]): boolean {
  return a.length === b.length && a.every((node, index) => {
    const other = b[index]
    return node.name === other.name && node.path === other.path &&
      node.isDir === other.isDir && node.expanded === other.expanded &&
      sameFileTree(node.children, other.children)
  })
}

function preserveExpansion(nodes: FileNode[], previous: FileNode[]): void {
  const expanded = new Map<string, boolean>()
  const collect = (level: FileNode[]) => level.forEach((node) => {
    if (node.isDir) expanded.set(normalizePath(node.path), node.expanded)
    collect(node.children)
  })
  const apply = (level: FileNode[]) => level.forEach((node) => {
    const value = expanded.get(node.path)
    if (node.isDir && value !== undefined) node.expanded = value
    apply(node.children)
  })
  collect(previous)
  apply(nodes)
}

class TabStore {
  private _tabs: Tab[] = []
  private _inactiveFiles: InactiveFile[] = []
  private _filePolicy: FilePolicy = { ...DEFAULT_FILE_POLICY }
  private _activeTabId: string | null = null
  private _workingDirectory = ''
  private _fileTree: FileNode[] = []
  private _sidebarView: SidebarView = 'tree'
  private _isVirtualWorkspace = false
  private _directoryError: string | null = null
  private _directoryGeneration = 0
  private _openGeneration = 0

  // 跨 reset/切目录仍持有实际扫描锁。请求序号只递增，所有等待者共享补扫闭环。
  private _refreshTask: Promise<void> | null = null
  private _refreshRequested = 0
  private _refreshCompleted = 0

  private _tabCounter = 0
  private _virtualFiles = new Map<string, string>()

  // 正文同步：串行执行，期间到达的请求合并为一次补查；指纹不随会话持久化。
  private _diskStamps = new WeakMap<Tab, string>()
  private _dismissedVersions = new WeakMap<Tab, string>()
  private _contentSyncTask: Promise<void> | null = null
  private _contentSyncAgain = false

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

  /** 所有目录入口共用的代次边界；同路径恢复/重建也可以强制隔离。 */
  private changeWorkspace(dir: string, virtual = false, force = false, invalidateOpens = true): boolean {
    const normalized = normalizePath(dir)
    const changed = normalized !== this._workingDirectory || virtual !== this._isVirtualWorkspace
    if (!force && !changed) return false
    this._directoryGeneration += 1
    if (invalidateOpens) this._openGeneration += 1
    this._workingDirectory = normalized
    this._isVirtualWorkspace = virtual
    if (changed) {
      this._directoryError = null
      this._fileTree = []
    }
    if (!virtual) this._virtualFiles.clear()
    return changed
  }

  get version(): number {
    return this._version
  }

  /** 测试隔离用：恢复到初始空状态，但不释放尚未完成的实际扫描锁。 */
  reset(): void {
    const changed = this._tabs.length > 0 || this._inactiveFiles.length > 0 || this._activeTabId !== null ||
      this._workingDirectory !== '' || this._fileTree.length > 0 ||
      this._sidebarView !== 'tree' || this._isVirtualWorkspace || this._directoryError !== null
    this.changeWorkspace('', false, true)
    this._tabs = []
    this._inactiveFiles = []
    this._filePolicy = { ...DEFAULT_FILE_POLICY }
    this._activeTabId = null
    this._fileTree = []
    this._directoryError = null
    this._sidebarView = 'tree'
    this._tabCounter = 0
    if (changed) this.emit()
  }

  // ---- 状态访问 ----

  get tabs(): Tab[] {
    return this._tabs
  }

  set tabs(value: Tab[]) {
    if (this._tabs === value) return
    this._tabs = value
    this.emit()
  }

  get activeTabId(): string | null {
    return this._activeTabId
  }

  set activeTabId(value: string | null) {
    if (this._activeTabId === value) return
    this._activeTabId = value
    this.emit()
  }

  get workingDirectory(): string {
    return this._workingDirectory
  }

  set workingDirectory(value: string) {
    this.setWorkingDirectory(value)
  }

  get isVirtualWorkspace(): boolean {
    return this._isVirtualWorkspace
  }

  get directoryError(): string | null {
    return this._directoryError
  }

  get fileTree(): FileNode[] {
    return this._fileTree
  }

  set fileTree(value: FileNode[]) {
    if (sameFileTree(this._fileTree, value)) return
    this._fileTree = value
    this.emit()
  }

  get sidebarView(): SidebarView {
    return this._sidebarView
  }

  set sidebarView(value: SidebarView) {
    this.setSidebarView(value)
  }

  get activeTab(): Tab | null {
    if (!this._activeTabId) return null
    return this._tabs.find((t) => t.id === this._activeTabId) || null
  }

  get activeContent(): string {
    return this.activeTab?.content || ''
  }

  get inactiveFiles(): InactiveFile[] {
    return [...this._inactiveFiles].sort((a, b) => compareFileActivity(a, b, this._filePolicy.openFilesSort))
  }

  get sortedTabs(): Tab[] {
    return [...this._tabs].sort((a, b) => compareFileActivity(a, b, this._filePolicy.openFilesSort))
  }

  /** 变更文档前让正文同步保存位置，不能等 React 清理时再读取已移除的 DOM。 */
  private beforeDocumentChange(): void {
    if (typeof window !== 'undefined') window.dispatchEvent(new Event('madu:before-document-change'))
  }

  private touch(tab: Tab, now = Date.now()): void {
    tab.lastAccessedAt = now
    tab.accessCount = Math.min(Number.MAX_SAFE_INTEGER, (tab.accessCount ?? 0) + 1)
  }

  /** 最近最少使用者先休眠；活动/未保存/无磁盘路径/丢失源快照永不自动丢弃。 */
  private maintainFiles(now = Date.now()): boolean {
    const before = this._inactiveFiles.length
    this._inactiveFiles = this._inactiveFiles.filter(file => now - file.inactiveSince < this._filePolicy.inactiveRetentionDays * DAY_MS)
    let changed = before !== this._inactiveFiles.length
    const victims = this._tabs.filter(tab => tab.id !== this._activeTabId && !tab.isModified && !tab.isUntitled && !tab.sourceMissing)
      .sort((a, b) => (a.lastAccessedAt ?? 0) - (b.lastAccessedAt ?? 0) || (a.accessCount ?? 1) - (b.accessCount ?? 1))
    while (this._tabs.length > this._filePolicy.maxOpenFiles && victims.length) {
      const tab = victims.shift()!
      this._tabs = this._tabs.filter(item => item !== tab)
      this._inactiveFiles = this._inactiveFiles.filter(item => filePathKey(item.path) !== filePathKey(tab.path))
      this._inactiveFiles.push({ path: tab.path, lastAccessedAt: tab.lastAccessedAt ?? now, accessCount: tab.accessCount ?? 1, inactiveSince: now })
      changed = true
    }
    return changed
  }

  applyFilePolicy(policy: Partial<FilePolicy>): void {
    const next = sanitizeFilePolicy({ ...this._filePolicy, ...policy })
    const changed = JSON.stringify(next) !== JSON.stringify(this._filePolicy)
    this._filePolicy = next
    if (this.maintainFiles() || changed) this.emit()
  }

  cleanupInactiveFiles(now = Date.now()): void {
    if (this.maintainFiles(now)) this.emit()
  }

  closeInactiveFile(path: string): void {
    const next = this._inactiveFiles.filter(file => filePathKey(file.path) !== filePathKey(path))
    if (next.length !== this._inactiveFiles.length) { this._inactiveFiles = next; this.emit() }
  }

  // ---- 业务方法 ----

  async openFile(path: string): Promise<void> {
    const normalizedPath = normalizePath(path)
    const generation = this._openGeneration
    console.log('[Tabs] openFile called for:', normalizedPath)
    try {
      let content: string
      if (this._virtualFiles.has(normalizedPath)) {
        content = this._virtualFiles.get(normalizedPath) || ''
      } else {
        const { allowAndReadTextFile } = await import('../lib/fsAccess')
        content = await allowAndReadTextFile(path)
      }
      if (generation !== this._openGeneration) throw new Error('工作区已变化，请重新打开文件')
      const name = getBaseName(normalizedPath)

      // 已打开：非当前阅读的干净标签直接换新；正在阅读或有未保存修改的只提示有变更。
      const existingTab = this._tabs.find((t) => filePathKey(t.path) === filePathKey(normalizedPath) && !t.isUntitled)
      if (existingTab) {
        this.beforeDocumentChange()
        this.applyDiskContent(existingTab, content)
        this._activeTabId = existingTab.id
        this.touch(existingTab)
        if (existingTab.sourceMissing) existingTab.sourceMissing = false
        this.maintainFiles()
        this.emit()
        return
      }

      const dormant = this._inactiveFiles.find(file => filePathKey(file.path) === filePathKey(normalizedPath))
      const newTab: Tab = {
        id: `tab-${Date.now()}-${++this._tabCounter}`,
        path: normalizedPath,
        name,
        content,
        lastAccessedAt: Date.now(),
        accessCount: Math.min(Number.MAX_SAFE_INTEGER, (dormant?.accessCount ?? 0) + 1),
        isModified: false,
        isUntitled: false,
      }

      this.beforeDocumentChange()
      this._inactiveFiles = this._inactiveFiles.filter(file => filePathKey(file.path) !== filePathKey(normalizedPath))
      this._tabs.push(newTab)
      this._activeTabId = newTab.id
      this.maintainFiles()

      const directoryChanged = !this._workingDirectory &&
        this.changeWorkspace(getDirName(normalizedPath), this._isVirtualWorkspace, false, false)
      this.emit()
      if (directoryChanged) await this.refreshFileTree()
    } catch (e) {
      console.error('[Tabs] Failed to open file:', e)
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

    this.beforeDocumentChange()
    this.touch(tab)
    this._tabs.push(tab)
    this._activeTabId = tab.id
    this.maintainFiles()
    this.emit()
    return tab
  }

  async closeTab(id: string): Promise<void> {
    const index = this._tabs.findIndex((t) => t.id === id)
    if (index === -1) return

    this.beforeDocumentChange()
    this._tabs.splice(index, 1)

    if (this._activeTabId === id) {
      if (this._tabs.length > 0) {
        const newIndex = Math.min(index, this._tabs.length - 1)
        this._activeTabId = this._tabs[newIndex].id
        this.touch(this._tabs[newIndex])
      } else {
        this._activeTabId = null
      }
    }
    this.emit()
  }

  setActiveTab(id: string): void {
    const tab = this._tabs.find(item => item.id === id)
    if (tab && this._activeTabId !== id) {
      this.beforeDocumentChange()
      this._activeTabId = id
      this.touch(tab)
      this.maintainFiles()
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

  refreshFileTree(): Promise<void> {
    if (!this._workingDirectory) return Promise.resolve()
    this._refreshRequested += 1
    return this.ensureRefreshTask()
  }

  /**
   * 核对已打开标签与磁盘是否一致。当前阅读或有未保存修改的标签只记录 externalContent
   * 由用户手动刷新，避免打断阅读；其余干净标签静默换成磁盘新版本。
   */
  syncOpenFileContents(): Promise<void> {
    if (this._contentSyncTask) {
      this._contentSyncAgain = true
      return this._contentSyncTask
    }
    this._contentSyncTask = (async () => {
      try {
        do {
          this._contentSyncAgain = false
          await this.checkOpenFileContents()
        } while (this._contentSyncAgain)
      } finally {
        this._contentSyncTask = null
      }
    })()
    return this._contentSyncTask
  }

  private async checkOpenFileContents(): Promise<void> {
    if (this._isVirtualWorkspace) return
    const generation = this._openGeneration
    const targets = this._tabs.filter(tab => !tab.isUntitled && tab.path && !this._virtualFiles.has(normalizePath(tab.path)))
    if (!targets.length) return
    const fsAccess = await import('../lib/fsAccess')
    const results = await Promise.all(targets.map(async (tab) => {
      let stamp: string | undefined
      try {
        stamp = await fsAccess.allowAndStatFile(tab.path)
      } catch {
        stamp = undefined
      }
      if (stamp !== undefined && stamp === this._diskStamps.get(tab)) return null
      try {
        return { tab, stamp, content: await fsAccess.allowAndReadTextFile(tab.path) }
      } catch {
        // 丢失/不可读由目录刷新的 sourceMissing 负责，这里保留现有正文。
        return null
      }
    }))
    if (generation !== this._openGeneration) return
    let changed = false
    for (const result of results) {
      if (!result || !this._tabs.includes(result.tab)) continue
      if (result.stamp !== undefined) this._diskStamps.set(result.tab, result.stamp)
      changed = this.applyDiskContent(result.tab, result.content) || changed
    }
    if (changed) this.emit()
  }

  /** 返回是否改变了标签状态；调用方负责 emit。 */
  private applyDiskContent(tab: Tab, disk: string): boolean {
    if (disk === tab.content) {
      this._dismissedVersions.delete(tab)
      if (tab.externalContent === undefined) return false
      tab.externalContent = undefined
      return true
    }
    if (disk === tab.externalContent || disk === this._dismissedVersions.get(tab)) return false
    if (tab.isModified || tab.id === this._activeTabId) {
      tab.externalContent = disk
      return true
    }
    tab.content = disk
    tab.externalContent = undefined
    return true
  }

  /** 用户确认后换成磁盘新版本；先让正文记录阅读位置，换新后按锚点恢复。 */
  reloadExternalChange(id: string): void {
    const tab = this._tabs.find(item => item.id === id)
    if (!tab || tab.externalContent === undefined) return
    if (tab.id === this._activeTabId) this.beforeDocumentChange()
    tab.content = tab.externalContent
    tab.externalContent = undefined
    tab.isModified = false
    this.emit()
  }

  /** 保留当前版本；磁盘再次变化时会重新提示。 */
  dismissExternalChange(id: string): void {
    const tab = this._tabs.find(item => item.id === id)
    if (!tab || tab.externalContent === undefined) return
    this._dismissedVersions.set(tab, tab.externalContent)
    tab.externalContent = undefined
    this.emit()
  }

  private ensureRefreshTask(): Promise<void> {
    if (this._refreshTask) return this._refreshTask
    this._refreshTask = Promise.resolve()
      .then(() => this.drainFileTreeRefreshes())
      .finally(() => {
        this._refreshTask = null
        // 覆盖 drain 结束到 promise 清理之间的微任务窗口，等待者也等待这次补扫。
        if (this._refreshCompleted < this._refreshRequested) return this.ensureRefreshTask()
      })
    return this._refreshTask
  }

  private async drainFileTreeRefreshes(): Promise<void> {
    while (this._refreshCompleted < this._refreshRequested) {
      const request = this._refreshRequested
      const generation = this._directoryGeneration
      const root = this._workingDirectory
      const virtual = this._isVirtualWorkspace
      if (!root) {
        this._refreshCompleted = request
        continue
      }
      const scan: DirectoryScan = {
        previousTree: this._fileTree,
        directories: new Map(),
        failures: new Map(),
      }
      const t0 = performance.now()
      let outcome = 'stale'
      try {
        const tree = pruneNonMarkdownNodes(virtual
          ? this.buildVirtualFileTree(root)
          : await this.buildFileTree(root, 0, scan))
        if (generation !== this._directoryGeneration) continue
        const sources = virtual ? new Map<Tab, boolean>() : await this.checkTabSources(root, scan)
        if (generation !== this._directoryGeneration) continue

        // 必须在所有 await 之后读取当前树，包含扫描期间刚刚发生的展开/折叠。
        preserveExpansion(tree, this._fileTree)
        const error = scan.failures.size > 0
          ? [...scan.failures.values()].sort().join('\n')
          : null
        const treeChanged = !sameFileTree(this._fileTree, tree)
        let changed = treeChanged || this._directoryError !== error
        if (treeChanged) this._fileTree = tree
        this._directoryError = error
        for (const [tab, missing] of sources) {
          if (!this._tabs.includes(tab) || Boolean(tab.sourceMissing) === missing) continue
          tab.sourceMissing = missing
          changed = true
        }
        outcome = error ? 'partial' : 'success'
        if (changed) this.emit()
      } catch (e) {
        if (generation !== this._directoryGeneration) continue
        // 根目录失败不等于空目录，保留树、标签、正文以及已有的丢失标记。
        const error = e instanceof Error ? e.message : String(e)
        outcome = 'error'
        console.error('[Tabs] Failed to refresh file tree:', root, e)
        if (this._directoryError !== error) {
          this._directoryError = error
          this.emit()
        }
      } finally {
        this._refreshCompleted = request
        void perfLog(
          `frontend: file tree scan generation=${generation} request=${request} ` +
          `root=${root} ${outcome} in ${(performance.now() - t0).toFixed(0)}ms`,
        )
      }
    }
  }

  /** 使用成功列举的目录证明存在/丢失；剪枝边界以外才单独 exists 探测。 */
  private async checkTabSources(root: string, scan: DirectoryScan): Promise<Map<Tab, boolean>> {
    const sources = new Map<Tab, boolean>()
    let fsModule: Promise<typeof import('@tauri-apps/plugin-fs')> | undefined
    await Promise.all(this._tabs.filter((tab) => !tab.isUntitled && tab.path).map(async (tab) => {
      const path = normalizePath(tab.path)
      // 子目录不可读时，不把陈旧内容当作存在/丢失证据，也不探测后误标删除。
      if ([...scan.failures.keys()].some((dir) => isWithinPath(path, dir))) return
      let exists: boolean | undefined
      if (path.startsWith(directoryPrefix(root))) {
        const parts = path.slice(directoryPrefix(root).length).split('/')
        let parent = root
        for (let index = 0; index < parts.length; index += 1) {
          const entries = scan.directories.get(parent)
          if (!entries) break
          if (!entries.has(parts[index])) {
            exists = false
            break
          }
          if (index === parts.length - 1) exists = true
          parent = joinPath(parent, parts[index])
        }
      }
      if (exists === undefined) {
        try {
          fsModule ??= import('@tauri-apps/plugin-fs')
          const fs = await fsModule
          exists = await fs.exists(path)
        } catch (e) {
          console.error('[Tabs] Failed to probe source file:', path, e)
          return
        }
      }
      if (typeof exists === 'boolean') sources.set(tab, !exists)
    }))
    return sources
  }

  async buildFileTree(
    dir = this._workingDirectory,
    depth = 0,
    scan: DirectoryScan = { previousTree: this._fileTree, directories: new Map(), failures: new Map() },
  ): Promise<FileNode[]> {
    if (!dir || depth > 10) return []
    dir = normalizePath(dir)
    let entries: Array<{ name: string; isDirectory: boolean }>
    try {
      scan.readDir ??= (await import('../lib/fsAccess')).allowAndReadDir
      entries = await scan.readDir(dir)
      if (!Array.isArray(entries)) throw new Error('目录读取未返回有效列表')
      // 记录未剪枝的完整目录，避免空目录、非 Markdown、隐藏项被误当作删除。
      scan.directories.set(dir, new Set(entries.map((entry) => entry.name)))
    } catch (e) {
      const detail = e instanceof Error ? e.message : String(e)
      const message = `无法读取目录「${dir}」：${detail}`
      if (depth === 0) throw new Error(message)
      console.error('[Tabs] Failed to read directory:', dir, e)
      scan.failures.set(dir, message)
      const previous = findNodeInTree(scan.previousTree, dir)
      // 剪枝会改 children，不能把上次的节点直接交给新扫描。
      return previous?.isDir ? cloneFileTree(previous.children) : []
    }

    const visibleEntries = entries.filter(
      (entry) => !entry.name.startsWith('.') && entry.name !== 'node_modules',
    )
    // 同一次扫描仍并行遍历分支；最大深度和隐藏项剪枝边界保持不变。
    const nodes: FileNode[] = await Promise.all(visibleEntries.map(async (entry) => {
      const fullPath = joinPath(dir, entry.name)
      return {
        name: entry.name,
        path: fullPath,
        isDir: entry.isDirectory,
        children: entry.isDirectory ? await this.buildFileTree(fullPath, depth + 1, scan) : [],
        expanded: false,
      }
    }))
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
      const prefix = directoryPrefix(normalizedRoot)
      const relativePath = filePath.startsWith(prefix) ? filePath.substring(prefix.length) : filePath
      const parts = relativePath.split('/').filter(Boolean)
      let currentLevel = rootNodes
      let currentPath = normalizedRoot

      parts.forEach((part, index) => {
        currentPath = joinPath(currentPath, part)
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
    if (this._sidebarView === view) return
    this._sidebarView = view
    this.emit()
  }

  setWorkingDirectory(dir: string): void {
    if (this.changeWorkspace(dir)) this.emit()
    void this.refreshFileTree()
  }

  async setVirtualWorkspace(root: string, files: VirtualFile[]): Promise<void> {
    this.beforeDocumentChange()
    this.changeWorkspace(root, true, true)
    this._inactiveFiles = []
    this._tabs = []
    this._activeTabId = null
    this._virtualFiles.clear()
    for (const file of files) {
      this._virtualFiles.set(normalizePath(file.path), file.content)
    }
    this._fileTree = pruneNonMarkdownNodes(this.buildVirtualFileTree(this._workingDirectory))
    this.emit()
    const firstFile = files.find((file) => isMarkdownFile(file.path))
    if (firstFile) await this.openFile(firstFile.path)
  }

  toggleFileNode(nodePath: string): void {
    const node = findNodeInTree(this._fileTree, normalizePath(nodePath))
    if (node) {
      node.expanded = !node.expanded
      this.emit()
    }
  }

  findNode(targetPath: string): FileNode | undefined {
    return findNodeInTree(this._fileTree, normalizePath(targetPath))
  }

  openFileFromTree(path: string): void {
    if (!isMarkdownFile(path)) return
    this.openFile(path).catch(console.error)
  }

  /** 当前会话快照：工作目录、打开的文件（按标签顺序）、最后显示的文件 */
  snapshotSession(): SessionData {
    return {
      workingDirectory: this._workingDirectory,
      openPaths: this._tabs.filter((t) => !t.isUntitled).map((t) => t.path),
      activePath: this.activeTab && !this.activeTab.isUntitled ? this.activeTab.path : null,
      fileActivity: this._tabs.filter(tab => !tab.isUntitled).map(tab => ({ path: tab.path, lastAccessedAt: tab.lastAccessedAt ?? Date.now(), accessCount: tab.accessCount ?? 1 })),
      inactiveFiles: this._inactiveFiles.map(file => ({ ...file })),
    }
  }

  /** 启动恢复先筛选上限，再读正文；休眠文件不做 exists/read，也不持有快照。 */
  async restoreSession(session: SessionData): Promise<void> {
    const root = normalizePath(session.workingDirectory || this._workingDirectory)
    const virtual = this._isVirtualWorkspace && root === this._workingDirectory
    const workspaceChanged = this.changeWorkspace(root, virtual, true)
    const generation = this._directoryGeneration
    if (workspaceChanged) this.emit()
    const now = Date.now()
    const activity = new Map((session.fileActivity ?? []).map(raw => sanitizeActivity(raw, now))
      .filter(item => item !== null).map(item => [filePathKey(item.path), item]))
    const activeNormalized = session.activePath ? normalizePath(session.activePath) : null
    const paths: string[] = []
    const seenPaths = new Set<string>()
    for (const path of activeNormalized ? [activeNormalized, ...session.openPaths] : session.openPaths) {
      const normalized = normalizePath(path)
      const key = filePathKey(normalized)
      if (!seenPaths.has(key)) { seenPaths.add(key); paths.push(normalized) }
    }
    const known = new Set(this._tabs.filter(tab => !tab.isUntitled).map(tab => filePathKey(tab.path)))
    const ranked = paths.filter(path => !known.has(filePathKey(path))).sort((a, b) => {
      if (a === activeNormalized) return -1
      if (b === activeNormalized) return 1
      return (activity.get(filePathKey(b))?.lastAccessedAt ?? 0) - (activity.get(filePathKey(a))?.lastAccessedAt ?? 0)
    })
    const selected = ranked.slice(0, Math.max(0, this._filePolicy.maxOpenFiles - this._tabs.length))
    const dormant = (session.inactiveFiles ?? []).map(raw => sanitizeInactive(raw, now)).filter(item => item !== null)
      .filter(item => now - item.inactiveSince < this._filePolicy.inactiveRetentionDays * DAY_MS)
    for (const path of ranked.slice(selected.length)) {
      dormant.push({ ...(activity.get(filePathKey(path)) ?? { path, lastAccessedAt: now, accessCount: 1 }), path, inactiveSince: now })
    }
    const restoreT0 = performance.now()
    const results = await Promise.all(selected.map(async path => {
      try {
        const content = this._virtualFiles.has(path) ? this._virtualFiles.get(path) ?? ''
          : await (await import('../lib/fsAccess')).allowAndReadTextFile(path)
        return { path, content }
      } catch (error) {
        console.error('[Tabs] Failed to restore session file:', path, error)
        dormant.push({ ...(activity.get(filePathKey(path)) ?? { path, lastAccessedAt: now, accessCount: 1 }), path, inactiveSince: now })
        return null
      }
    }))
    void perfLog(`frontend: session file reads generation=${generation} done in ${(performance.now() - restoreT0).toFixed(0)}ms`)
    if (generation !== this._directoryGeneration) return
    this.beforeDocumentChange()
    let changed = false
    for (const result of results) {
      if (!result || this._tabs.some(tab => filePathKey(tab.path) === filePathKey(result.path) && !tab.isUntitled)) continue
      const metadata = activity.get(filePathKey(result.path))
      this._tabs.push({ id: `tab-${Date.now()}-${++this._tabCounter}`, path: result.path, name: getBaseName(result.path),
        content: result.content, isModified: false, isUntitled: false, lastAccessedAt: metadata?.lastAccessedAt ?? now, accessCount: metadata?.accessCount ?? 1 })
      changed = true
    }
    const loaded = new Set(this._tabs.filter(tab => !tab.isUntitled).map(tab => filePathKey(tab.path)))
    const inactive = new Map(this._inactiveFiles.map(file => [filePathKey(file.path), file]))
    for (const file of dormant) if (!loaded.has(filePathKey(file.path))) inactive.set(filePathKey(file.path), { ...file, path: normalizePath(file.path) })
    if (JSON.stringify(this._inactiveFiles) !== JSON.stringify([...inactive.values()])) changed = true
    this._inactiveFiles = [...inactive.values()]
    if (!this._workingDirectory && this._tabs.length) changed = this.changeWorkspace(getDirName(this._tabs[0].path), virtual) || changed
    const target = this._tabs.find(tab => activeNormalized && filePathKey(tab.path) === filePathKey(activeNormalized))
      ?? (this._activeTabId ? null : this._tabs[0])
    if (target && this._activeTabId !== target.id) { this._activeTabId = target.id; target.lastAccessedAt = now; changed = true }
    changed = this.maintainFiles(now) || changed
    if (changed) this.emit()
    if (this._workingDirectory) void this.refreshFileTree()
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
