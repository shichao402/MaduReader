import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import SettingsDialog from '../../src/components/SettingsDialog'
import { settingsStore } from '../../src/stores/settings'
import { useStores } from '../../src/hooks/useStores'

vi.mock('../../src/lib/fileAssociations', () => ({
  getAssociationStatus: async () => [],
  openDefaultAppsSettings: () => {},
  setFileAssociation: () => {},
}))
vi.mock('../../src/components/UpdateSection', () => ({ default: () => null }))

let host: HTMLDivElement
let root: Root
let tauri: unknown
const STORAGE_KEY = 'madureader-settings'

function SettingsHarness() {
  useStores()
  return createElement(SettingsDialog, { open: true, onOpenChange: () => {} })
}

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  tauri = (window as any).__TAURI_INTERNALS__
  delete (window as any).__TAURI_INTERNALS__
  window.localStorage.removeItem(STORAGE_KEY)
  settingsStore.reset()
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
  window.localStorage.removeItem(STORAGE_KEY)
  ;(window as any).__TAURI_INTERNALS__ = tauri
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('image preview settings', () => {
  it('旧配置不包含开关时默认关闭，并且保留原有设置', async () => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ fontSize: 18 }))
    await settingsStore.loadSettings()
    expect(settingsStore.settings.closePreviewOnBlankDoubleClick).toBe(false)
    expect(settingsStore.settings.previewModifierWheelPan).toBe(false)
    expect(settingsStore.settings.fontSize).toBe(18)
  })

  it('设置开关立即提交、保存并在重新加载后保持启用', async () => {
    await act(async () => root.render(createElement(SettingsHarness)))
    const toggle = document.querySelector<HTMLInputElement>('#close-preview-on-blank-double-click')!
    expect(toggle.checked).toBe(false)
    expect(toggle.parentElement?.textContent).toContain('双击空白处关闭图片预览')
    act(() => toggle.click())
    expect(toggle.checked).toBe(true)
    expect(settingsStore.settings.closePreviewOnBlankDoubleClick).toBe(true)
    expect(JSON.parse(window.localStorage.getItem(STORAGE_KEY)!).closePreviewOnBlankDoubleClick).toBe(true)
    act(() => settingsStore.reset())
    await act(async () => settingsStore.loadSettings())
    expect(settingsStore.settings.closePreviewOnBlankDoubleClick).toBe(true)
    expect(toggle.checked).toBe(true)
  })

  it('修饰键滚轮开关独立保存，重新加载后保持启用且能关闭', async () => {
    await act(async () => root.render(createElement(SettingsHarness)))
    const toggle = document.querySelector<HTMLInputElement>('#preview-modifier-wheel-pan')!
    expect(toggle.checked).toBe(false)
    expect(toggle.parentElement?.textContent).toContain('Ctrl / Shift + 滚轮平移图片预览')
    act(() => toggle.click())
    expect(toggle.checked).toBe(true)
    expect(settingsStore.settings.previewModifierWheelPan).toBe(true)
    expect(settingsStore.settings.closePreviewOnBlankDoubleClick).toBe(false)
    expect(JSON.parse(window.localStorage.getItem(STORAGE_KEY)!).previewModifierWheelPan).toBe(true)
    act(() => settingsStore.reset())
    await act(async () => settingsStore.loadSettings())
    expect(toggle.checked).toBe(true)
    expect(settingsStore.settings.previewModifierWheelPan).toBe(true)
    act(() => toggle.click())
    expect(settingsStore.settings.previewModifierWheelPan).toBe(false)
    expect(JSON.parse(window.localStorage.getItem(STORAGE_KEY)!).previewModifierWheelPan).toBe(false)
  })

  it('重置默认设置会关闭辅助选项并持久化', async () => {
    settingsStore.update({ closePreviewOnBlankDoubleClick: true, previewModifierWheelPan: true }, { save: false })
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    await act(async () => root.render(createElement(SettingsHarness)))
    const button = Array.from(document.querySelectorAll('button')).find(node => node.textContent === '重置为默认')!
    act(() => button.click())
    expect(settingsStore.settings.closePreviewOnBlankDoubleClick).toBe(false)
    expect(document.querySelector<HTMLInputElement>('#close-preview-on-blank-double-click')?.checked).toBe(false)
    expect(JSON.parse(window.localStorage.getItem(STORAGE_KEY)!).closePreviewOnBlankDoubleClick).toBe(false)
    expect(settingsStore.settings.previewModifierWheelPan).toBe(false)
    expect(document.querySelector<HTMLInputElement>('#preview-modifier-wheel-pan')?.checked).toBe(false)
    expect(JSON.parse(window.localStorage.getItem(STORAGE_KEY)!).previewModifierWheelPan).toBe(false)
  })
})
