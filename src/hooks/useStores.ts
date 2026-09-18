import { useEffect, useState, useRef } from 'react'
import { useTabStore } from '../stores/tabs'
import { useSettingsStore } from '../stores/settings'

function useDeepSnapshot<T>(source: unknown): T {
  const [snapshot, setSnapshot] = useState<T>(() => JSON.parse(JSON.stringify(source)))
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    const schedule = () => {
      if (timerRef.current) clearTimeout(timerRef.current)
      timerRef.current = setTimeout(() => {
        setSnapshot(JSON.parse(JSON.stringify(source)))
      }, 16)
    }
    const unwatch = (source as { $subscribe: (cb: () => void, opts?: unknown) => () => void })[
      '$subscribe'
    ](schedule, { detached: true })
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

  const tabsSnap = useDeepSnapshot<any>(tabStore)
  const settingsSnap = useDeepSnapshot<any>(settingsStore)

  const snapshot = {
    tabs: tabsSnap.tabs as any[],
    activeTabId: tabsSnap.activeTabId as string | null,
    workingDirectory: tabsSnap.workingDirectory as string,
    fileTree: tabsSnap.fileTree as any[],
    sidebarView: tabsSnap.sidebarView as 'tree' | 'tabs',
    activeContent: tabsSnap.activeContent as string,
    settings: settingsSnap.settings,
    isDark: settingsSnap.isDark as boolean,
    currentZoom: settingsSnap.currentZoom as number,
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
