// 会话持久化：打开文件和不活跃路径的生命周期元数据，不保存正文。
// 数据存于应用数据目录 session.json，读写走 Rust 命令。
import { invoke } from '@tauri-apps/api/core'
import { sanitizeActivity, sanitizeInactive, type FileActivity, type InactiveFile } from './fileActivity'

export interface SessionData {
  workingDirectory: string
  openPaths: string[]
  activePath: string | null
  fileActivity?: FileActivity[]
  inactiveFiles?: InactiveFile[]
}

const SESSION_FILE = 'session.json'
const SESSION_STORAGE_KEY = 'madureader-session'
const inTauri = typeof window !== 'undefined' &&
  typeof (window as { __TAURI_INTERNALS__?: { invoke?: unknown } }).__TAURI_INTERNALS__?.invoke === 'function'

export const EMPTY_SESSION: SessionData = { workingDirectory: '', openPaths: [], activePath: null }

export function sanitizeSession(data: unknown): SessionData {
  if (!data || typeof data !== 'object') return { ...EMPTY_SESSION }
  const raw = data as Partial<SessionData>
  return {
    workingDirectory: typeof raw.workingDirectory === 'string' ? raw.workingDirectory : '',
    openPaths: Array.isArray(raw.openPaths)
      ? raw.openPaths.filter((path): path is string => typeof path === 'string' && Boolean(path.trim()) && path.length <= 32768)
      : [],
    activePath: typeof raw.activePath === 'string' ? raw.activePath : null,
    fileActivity: Array.isArray(raw.fileActivity)
      ? raw.fileActivity.slice(-5000).map(item => sanitizeActivity(item)).filter((item): item is FileActivity => item !== null)
      : [],
    inactiveFiles: Array.isArray(raw.inactiveFiles)
      ? raw.inactiveFiles.slice(-5000).map(item => sanitizeInactive(item)).filter((item): item is InactiveFile => item !== null)
      : [],
  }
}

export async function loadSession(): Promise<SessionData> {
  try {
    const data = inTauri
      ? await invoke<string>('read_data_file', { fileName: SESSION_FILE })
      : window.localStorage.getItem(SESSION_STORAGE_KEY)
    return data ? sanitizeSession(JSON.parse(data)) : { ...EMPTY_SESSION }
  } catch { return { ...EMPTY_SESSION } }
}

let writes: Promise<void> = Promise.resolve()

/** 每次调用先冻结快照，再串行写入，避免迟到旧写覆盖当前会话。 */
export function saveSession(session: SessionData): Promise<void> {
  const snapshot = JSON.stringify(session)
  writes = writes.then(async () => {
    try {
      if (inTauri) await invoke('write_data_file', { fileName: SESSION_FILE, content: snapshot })
      else window.localStorage.setItem(SESSION_STORAGE_KEY, snapshot)
    } catch (error) { console.error('[Session] Failed to save session:', error) }
  })
  return writes
}
