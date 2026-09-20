import { useEffect, useState, useRef } from 'react'
import { toRaw } from 'vue'
import { useTabStore } from '../stores/tabs'
import { useSettingsStore } from '../stores/settings'

/**
 * 深拷贝一个包含 Vue ref/computed 的 Pinia store 对象。
 * 直接 JSON.stringify 会因 ComputedRefImpl/EffectScope 的内部循环引用抛 TypeError，
 * 导致组件首次渲染崩溃（release 白屏的根因）。
 *
 * 策略：只挑选白名单字段并解包 .value，绕开所有响应式内部结构。
 */
function snapshotStore<T extends object>(source: T): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const key of Object.keys(source)) {
    // 跳过 Pinia 内部字段：_p（含 EffectScope 循环引用）、_hmrPayload（含 ComputedRefImpl）、$ 开头的方法/状态
    if (key.startsWith('_') || key.startsWith('$')) continue
    const raw = toRaw((source as Record<string, unknown>)[key])
    if (raw && typeof raw === 'object' && 'value' in (raw as Record<string, unknown>) && !(raw instanceof Date)) {
      // ref / computed：用解包后的纯值
      out[key] = JSON.parse(JSON.stringify((raw as { value: unknown }).value))
    } else if (typeof raw === 'function') {
      continue
    } else {
      out[key] = JSON.parse(JSON.stringify(raw))
    }
  }
  return out
}

function useDeepSnapshot<T extends object>(source: T): Record<string, unknown> {
  const [snapshot, setSnapshot] = useState(() => snapshotStore(source))
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    const schedule = () => {
      if (timerRef.current) clearTimeout(timerRef.current)
      timerRef.current = setTimeout(() => {
        setSnapshot(snapshotStore(source))
      }, 16)
    }
    const unwatch = (source as unknown as { $subscribe: (cb: () => void, opts?: unknown) => () => void })[
      '$subscribe'
    ](schedule, { detached: true })
    schedule()
    return () => {
      unwatch()
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [source])

  return snapshot
}

export function useStores() {
  const tabStore = useTabStore()
  const settingsStore = useSettingsStore()

  const tabsSnap = useDeepSnapshot(tabStore)
  const settingsSnap = useDeepSnapshot(settingsStore)

  const snapshot = {
    tabs: (tabsSnap.tabs as any[]) ?? [],
    activeTabId: (tabsSnap.activeTabId as string | null) ?? null,
    workingDirectory: (tabsSnap.workingDirectory as string) ?? '',
    fileTree: (tabsSnap.fileTree as any[]) ?? [],
    sidebarView: (tabsSnap.sidebarView as 'tree' | 'tabs') ?? 'tree',
    activeContent: (tabsSnap.activeContent as string) ?? '',
    settings: (settingsSnap.settings as import('../stores/settings').Settings | undefined) ?? undefined,
    isDark: (settingsSnap.isDark as boolean) ?? false,
    currentZoom: (settingsSnap.currentZoom as number) ?? 1,
  }

  return { tabStore, settingsStore, snapshot }
}

// 供事件回调/渲染管线中使用的非响应式访问入口
export function getTabStore() {
  return useTabStore()
}

export function getSettingsStore() {
  return useSettingsStore()
}
