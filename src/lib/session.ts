// 会话持久化：记录工作目录、打开的文件与最后活动文件，供下次启动恢复。
// 数据存于应用数据目录 session.json，读写走 Rust 命令（绕开 fs 作用域限制）。

import { invoke } from '@tauri-apps/api/core'

export interface SessionData {
  workingDirectory: string
  openPaths: string[]
  activePath: string | null
}

const SESSION_FILE = 'session.json'
const SESSION_STORAGE_KEY = 'madureader-session'

const inTauri =
  typeof window !== 'undefined' &&
  '__TAURI_INTERNALS__' in window &&
  typeof (
    window as { __TAURI_INTERNALS__?: { invoke?: unknown } }
  ).__TAURI_INTERNALS__?.invoke === 'function'

export const EMPTY_SESSION: SessionData = {
  workingDirectory: '',
  openPaths: [],
  activePath: null,
}

function sanitize(data: unknown): SessionData {
  if (!data || typeof data !== 'object') return { ...EMPTY_SESSION }
  const raw = data as Partial<SessionData>
  return {
    workingDirectory: typeof raw.workingDirectory === 'string' ? raw.workingDirectory : '',
    openPaths: Array.isArray(raw.openPaths)
      ? raw.openPaths.filter((p): p is string => typeof p === 'string')
      : [],
    activePath: typeof raw.activePath === 'string' ? raw.activePath : null,
  }
}

/** 读取会话；不存在或解析失败返回空会话 */
export async function loadSession(): Promise<SessionData> {
  try {
    if (!inTauri) {
      const data = window.localStorage.getItem(SESSION_STORAGE_KEY)
      return data ? sanitize(JSON.parse(data)) : { ...EMPTY_SESSION }
    }
    const data = await invoke<string>('read_data_file', { fileName: SESSION_FILE })
    return sanitize(JSON.parse(data))
  } catch {
    return { ...EMPTY_SESSION }
  }
}

/** 保存会话；失败仅记录日志，不影响主流程 */
export async function saveSession(session: SessionData): Promise<void> {
  try {
    if (!inTauri) {
      window.localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session))
      return
    }
    await invoke('write_data_file', {
      fileName: SESSION_FILE,
      content: JSON.stringify(session, null, 2),
    })
  } catch (e) {
    console.error('[Session] Failed to save session:', e)
  }
}
