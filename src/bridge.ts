import { tabStore } from './stores/tabs'
import { settingsStore } from './stores/settings'

export function getTabStore() {
  return tabStore
}

export function getSettingsStore() {
  return settingsStore
}

export { tabStore as useTabStore, settingsStore as useSettingsStore }
