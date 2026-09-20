// 启动性能埋点：统一走 tauri-plugin-log 落盘（LogDir/madureader.log），
// 非 Tauri 环境（浏览器预览/单测）退回 console，方便直接观察。

const inTauri =
  typeof window !== 'undefined' &&
  '__TAURI_INTERNALS__' in window &&
  typeof (
    window as { __TAURI_INTERNALS__?: { invoke?: unknown } }
  ).__TAURI_INTERNALS__?.invoke === 'function'

export async function perfLog(message: string): Promise<void> {
  const line = `[perf] ${message}`
  if (!inTauri) {
    console.log(line)
    return
  }
  try {
    const log = await import('@tauri-apps/plugin-log')
    await log.info(line)
  } catch {
    console.log(line)
  }
}
