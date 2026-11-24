import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import OpenFilesGroup from '../../src/components/OpenFilesGroup'
import SettingsDialog from '../../src/components/SettingsDialog'
import { settingsStore } from '../../src/stores/settings'
import { useStores } from '../../src/hooks/useStores'

vi.mock('../../src/lib/fileAssociations', () => ({ getAssociationStatus: async () => [], openDefaultAppsSettings: () => {}, setFileAssociation: () => {} }))
vi.mock('../../src/components/UpdateSection', () => ({ default: () => null }))
let host: HTMLDivElement, root: Root
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); settingsStore.reset()
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
})
afterEach(() => { act(() => root.unmount()); host.remove(); vi.unstubAllGlobals() })

function SettingsHarness() { useStores(); return createElement(SettingsDialog, { open: true, onOpenChange: () => {} }) }

describe('file settings and inactive group', () => {
  it('offers bounded counts, retention and all sort choices', async () => {
    await act(async () => root.render(createElement(SettingsHarness)))
    const limit = document.querySelector<HTMLInputElement>('#max-open-files')!
    expect(limit.value).toBe('20'); expect(limit.min).toBe('1'); expect(limit.max).toBe('200')
    expect(document.querySelector<HTMLInputElement>('#inactive-retention-days')?.value).toBe('7')
    const sort = document.querySelector<HTMLSelectElement>('#open-files-sort')!
    expect([...sort.options].map(option => option.value)).toEqual(['recent', 'frequent', 'name'])
    act(() => { sort.value = 'frequent'; sort.dispatchEvent(new Event('change', { bubbles: true })) })
    expect(settingsStore.settings.openFilesSort).toBe('frequent')
  })
  it('input commits on blur and sanitizes out-of-range values', async () => {
    await act(async () => root.render(createElement(SettingsHarness)))
    const input = document.querySelector<HTMLInputElement>('#max-open-files')!
    act(() => { input.value = '999'; input.dispatchEvent(new FocusEvent('focusout', { bubbles: true })) })
    expect(settingsStore.settings.maxOpenFiles).toBe(200)
    const days = document.querySelector<HTMLInputElement>('#inactive-retention-days')!
    act(() => { days.value = '0'; days.dispatchEvent(new FocusEvent('focusout', { bubbles: true })) })
    expect(settingsStore.settings.inactiveRetentionDays).toBe(1)
  })
  it('inactive entry supports reactivation, path context menu and manual close without content', () => {
    const reopen = vi.fn(), close = vi.fn()
    act(() => root.render(createElement(OpenFilesGroup, {
      label: '不活跃', inactive: true, tabs: [{ id: '/docs/a.md', path: '/docs/a.md', name: 'a.md' }], activeTabId: null,
      workingDirectory: '/docs', onSetActive: reopen, onCloseTab: close,
    })))
    expect(host.textContent).toContain('仅保留路径，点击重新读取')
    const row = host.querySelector<HTMLElement>('[data-file-path]')!
    act(() => row.click()); expect(reopen).toHaveBeenCalledWith('/docs/a.md')
    act(() => row.querySelector<HTMLButtonElement>('[title="关闭"]')!.click())
    expect(close).toHaveBeenCalledWith('/docs/a.md'); expect(reopen).toHaveBeenCalledTimes(1)
  })
  it('closing using Enter cannot reactivate the parent row', () => {
    const reopen = vi.fn()
    act(() => root.render(createElement(OpenFilesGroup, {
      tabs: [{ id: '/a.md', path: '/a.md', name: 'a.md' }], activeTabId: null,
      workingDirectory: '/', onSetActive: reopen, onCloseTab: () => {},
    })))
    const button = host.querySelector<HTMLButtonElement>('[title="关闭"]')!
    act(() => button.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })))
    expect(reopen).not.toHaveBeenCalled()
  })
})
