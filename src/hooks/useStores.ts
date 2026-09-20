import { useSyncExternalStore } from 'react'
import { tabStore } from '../stores/tabs'
import { settingsStore } from '../stores/settings'

/**
 * React 19 标准外部 store 订阅：useSyncExternalStore + version 计数器。
 * 组件直接读取 store 字段（tabStore.tabs / settingsStore.settings 等），
 * 无快照对象、无白名单、无序列化 —— 旧架构的所有 hack 均已移除。
 */
function useStoreVersion(store: { subscribe: (l: () => void) => () => void; version: number }): number {
  return useSyncExternalStore(store.subscribe, () => store.version)
}

export function useStores() {
  useStoreVersion(tabStore)
  useStoreVersion(settingsStore)

  return { tabStore, settingsStore }
}

// 供事件回调/渲染管线中使用的直接访问入口
export function getTabStore() {
  return tabStore
}

export function getSettingsStore() {
  return settingsStore
}
