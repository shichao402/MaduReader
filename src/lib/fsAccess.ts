// 文件系统授权与打开的统一入口。
// Tauri 的 fs 权限作用域默认只放行通过对话框选择的目录第一层，
// 深层子目录/文件会报 forbidden path。这里统一调用 Rust 命令 add_allowed_path
// 把用户显式选择的目录（递归）或文件加入作用域，再做后续打开动作。

import { invoke } from '@tauri-apps/api/core'

const fsModule = () => import('@tauri-apps/plugin-fs')

/** 当前是否运行在 Tauri 桌面环境（需 __TAURI_INTERNALS__ 且 invoke 可用；单测/jsdom 为 false） */
const inTauri =
  typeof window !== 'undefined' &&
  '__TAURI_INTERNALS__' in window &&
  typeof (
    window as { __TAURI_INTERNALS__?: { invoke?: unknown } }
  ).__TAURI_INTERNALS__?.invoke === 'function'

/** 把目录（递归）或文件加入 fs 读取作用域 */
export async function allowPath(path: string): Promise<void> {
  if (!inTauri) return
  try {
    await invoke('add_allowed_path', { path })
  } catch (e) {
    console.error('[fsAccess] Failed to allow path:', path, e)
    throw e
  }
}

/** 授权并读取目录内容（readDir 前先放行该目录递归作用域） */
export async function allowAndReadDir(path: string) {
  await allowPath(path)
  const fs = await fsModule()
  return fs.readDir(path)
}

/** 授权并读取文本文件（readTextFile 前先放行该文件） */
export async function allowAndReadTextFile(path: string): Promise<string> {
  await allowPath(path)
  const fs = await fsModule()
  return fs.readTextFile(path)
}

/** 判断路径是否为目录（不做授权，存在性探测失败按非目录处理） */
export async function isDirectory(path: string): Promise<boolean> {
  try {
    const fs = await fsModule()
    await fs.readDir(path)
    return true
  } catch {
    return false
  }
}
