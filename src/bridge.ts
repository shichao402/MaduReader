import { useTabStore } from './stores/tabs'
import { useSettingsStore } from './stores/settings'

export function getTabStore() {
  return useTabStore()
}

export function getSettingsStore() {
  return useSettingsStore()
}

export { useTabStore, useSettingsStore }
