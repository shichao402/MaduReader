import { getTabStore } from '../bridge'
import { allowAndReadDir, isDirectory } from './fsAccess'

export interface PathOutcome {
  path: string
  error: string | null
}

export interface OpenResult {
  error: string | null
  outcomes: PathOutcome[]
}

export interface OpenErrorNotice {
  title: string
  details: string
  requestId?: number
  retry?: boolean
}

export interface OpenPathsDependencies {
  store: Pick<ReturnType<typeof getTabStore>, 'openFile' | 'setWorkingDirectory' | 'isVirtualWorkspace'>
  isDirectory: typeof isDirectory
  readDirectory: typeof allowAndReadDir
}

/** 只做路径分隔符规范化，不折叠 UNC 前缀、不改变大小写。 */
export function parentDirectory(path: string): string {
  const normalized = path.replace(/\\/g, '/')
  const index = normalized.lastIndexOf('/')
  if (index < 0) return ''
  if (index === 0) return '/'
  const parent = normalized.slice(0, index)
  return /^[a-z]:$/i.test(parent) ? `${parent}/` : parent
}

export function joinDirectory(directory: string, name: string): string {
  const separator = directory.includes('\\') ? '\\' : '/'
  return `${directory.replace(/[\\/]+$/, '')}${separator}${name}`
}

/** 每个路径都执行，单个失败不吞掉其余请求；不替用户重载已有正文快照。 */
export async function openPaths(
  paths: string[],
  options: { updateWorkspace?: boolean } = {},
  dependencies: OpenPathsDependencies = {
    store: getTabStore(), isDirectory, readDirectory: allowAndReadDir,
  },
): Promise<OpenResult> {
  const outcomes: PathOutcome[] = []
  const { store } = dependencies
  for (const path of paths) {
    try {
      if (!path) throw new Error('路径为空')
      const directory = !store.isVirtualWorkspace && await dependencies.isDirectory(path)
      if (directory) {
        const files = await dependencies.readDirectory(path)
        const markdown = files.filter((file) => !file.isDirectory && /\.(md|markdown)$/i.test(file.name))
        const first = markdown.find((file) => /^readme\.(md|markdown)$/i.test(file.name)) || markdown[0]
        // 目录读取成功后才切换工作区；空目录也算成功打开。
        store.setWorkingDirectory(path)
        if (first) await store.openFile(joinDirectory(path, first.name))
      } else {
        await store.openFile(path)
        if (options.updateWorkspace !== false) {
          const parent = parentDirectory(path)
          if (parent) store.setWorkingDirectory(parent)
        }
      }
      outcomes.push({ path, error: null })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      console.error('[Open] Failed to open path:', path, error)
      outcomes.push({ path, error: message })
    }
  }
  return { error: paths.length ? null : '没有可打开的路径', outcomes }
}

export function noticeForResult(result: OpenResult, requestId?: number): OpenErrorNotice | null {
  const failures = result.outcomes.filter((outcome) => outcome.error !== null)
  if (!result.error && !failures.length) return null
  return {
    title: '无法打开文件或目录',
    details: [result.error, ...failures.map((outcome) => `${outcome.path}\n${outcome.error}`)].filter(Boolean).join('\n\n'),
    requestId,
  }
}

export function reportOpenError(notice: OpenErrorNotice) {
  window.dispatchEvent(new CustomEvent('madu:open-error', { detail: notice }))
}

/** 用户交互入口与外部请求共用 openPaths，失败统一显示而非成为未处理 Promise。 */
export async function openUserPaths(paths: string[], options: { updateWorkspace?: boolean } = {}) {
  const result = await openPaths(paths, options)
  const notice = noticeForResult(result)
  if (notice) reportOpenError(notice)
  return result
}
