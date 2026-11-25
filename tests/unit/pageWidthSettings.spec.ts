import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { invoke } from '@tauri-apps/api/core'
import { DEFAULT_SETTINGS, settingsStore } from '../../src/stores/settings'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn().mockResolvedValue(null) }))
let tauri: unknown
const key = 'madureader-settings'
beforeEach(() => {
  tauri = (window as any).__TAURI_INTERNALS__
  delete (window as any).__TAURI_INTERNALS__
  localStorage.removeItem(key); settingsStore.reset(); vi.clearAllMocks()
})
afterEach(async () => {
  await settingsStore.flushPageWidth()
  settingsStore.reset(); localStorage.removeItem(key)
  ;(window as any).__TAURI_INTERNALS__ = tauri
  vi.useRealTimers(); vi.restoreAllMocks()
})

describe('page width configuration', () => {
  it.each([undefined, null, 100, '1000', -800])('旧配置和非法页宽 %s 回默认，但不覆盖其他偏好', async pageWidth => {
    localStorage.setItem(key, JSON.stringify({ fontSize: 18, pageWidth }))
    await settingsStore.loadSettings()
    expect(settingsStore.settings.pageWidth).toBe(800)
    expect(settingsStore.settings.fontSize).toBe(18)
  })
  it('加载前的拖动和刷新不把默认值写回配置', async () => {
    localStorage.setItem(key, JSON.stringify({ pageWidth: 1600 }))
    settingsStore.setPageWidth(900)
    await settingsStore.flushPageWidth()
    expect(JSON.parse(localStorage.getItem(key)!).pageWidth).toBe(1600)
    await settingsStore.loadSettings()
    expect(settingsStore.settings.pageWidth).toBe(1600)
  })
  it('连续拖动只更新内存，停止 600ms 合并一次持久化', async () => {
    await settingsStore.loadSettings(); vi.useFakeTimers()
    const write = vi.spyOn(Storage.prototype, 'setItem')
    settingsStore.setPageWidth(880); settingsStore.setPageWidth(1000); settingsStore.setPageWidth(1200)
    expect(settingsStore.settings.pageWidth).toBe(1200)
    expect(write).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(599); expect(write).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1); expect(write).toHaveBeenCalledOnce()
    expect(JSON.parse(localStorage.getItem(key)!).pageWidth).toBe(1200)
  })
  it.each(['madu:hide-before-close', 'pagehide'])('%s 补充刷新待保存页宽', async event => {
    await settingsStore.loadSettings(); vi.useFakeTimers()
    settingsStore.setPageWidth(960)
    window.dispatchEvent(new Event(event))
    expect(JSON.parse(localStorage.getItem(key)!).pageWidth).toBe(960)
    await vi.advanceTimersByTimeAsync(600)
    expect(settingsStore.settings.pageWidth).toBe(960)
  })
  it('正常设置提交包含最新页宽，取消额外延迟写；导入和默认也兼容', async () => {
    await settingsStore.loadSettings(); vi.useFakeTimers()
    settingsStore.setPageWidth(1000)
    const write = vi.spyOn(Storage.prototype, 'setItem')
    settingsStore.update({ fontSize: 20 })
    expect(JSON.parse(localStorage.getItem(key)!).pageWidth).toBe(1000)
    await vi.advanceTimersByTimeAsync(600); expect(write).toHaveBeenCalledOnce()
    settingsStore.update({ pageWidth: 1400 })
    expect(JSON.parse(localStorage.getItem(key)!).pageWidth).toBe(1400)
    settingsStore.update(DEFAULT_SETTINGS)
    expect(JSON.parse(localStorage.getItem(key)!).pageWidth).toBe(800)
  })
  it('原生保存串行执行，失败不阻断下一次保存，最新偏好不会被旧写覆盖', async () => {
    ;(window as any).__TAURI_INTERNALS__ = {}
    const writes: string[] = []
    let finish: () => void = () => {}
    vi.mocked(invoke).mockImplementation((command, args: any) => {
      if (command !== 'write_data_file') return Promise.resolve(null) as any
      writes.push(args.content)
      if (writes.length === 1) return new Promise<void>(resolve => { finish = resolve }) as any
      if (writes.length === 2) return Promise.reject(new Error('disk'))
      return Promise.resolve(null) as any
    })
    settingsStore.update({ pageWidth: 880 }, { save: false }); const one = settingsStore.saveSettings()
    settingsStore.update({ pageWidth: 1000 }, { save: false }); const two = settingsStore.saveSettings()
    settingsStore.update({ pageWidth: 1200 }, { save: false }); const three = settingsStore.saveSettings()
    await Promise.resolve(); expect(writes).toHaveLength(1)
    finish(); expect(await one).toBe(true); expect(await two).toBe(false); expect(await three).toBe(true)
    expect(writes.map(s => JSON.parse(s).pageWidth)).toEqual([880, 1000, 1200])
  })
})
