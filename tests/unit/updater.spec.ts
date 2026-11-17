import { describe, expect, it } from 'vitest'
import { describeUpdate, formatBytes, progressPercent, type UpdateView } from '../../src/lib/updater'

function view(patch: Partial<UpdateView>): UpdateView {
  return {
    enabled: true,
    channel: 'stable',
    currentVersion: '0.1.0+1',
    currentCode: 1,
    phase: 'idle',
    message: null,
    available: null,
    progress: null,
    manualUrl: null,
    checkedAt: null,
    ...patch,
  }
}

const offer = {
  planId: 'p',
  version: '0.2.0+5',
  code: 5,
  mandatory: false,
  releaseNotes: '',
  releaseNotesUrl: '',
}

describe('updater view helpers', () => {
  it('progressPercent 在总大小未知时返回 null', () => {
    expect(progressPercent(null)).toBeNull()
    expect(progressPercent({ received: 10, total: 0, bytesPerSecond: 0 })).toBeNull()
    expect(progressPercent({ received: 50, total: 200, bytesPerSecond: 0 })).toBe(25)
    expect(progressPercent({ received: 300, total: 200, bytesPerSecond: 0 })).toBe(100)
  })

  it('formatBytes 分档', () => {
    expect(formatBytes(512)).toBe('512 B')
    expect(formatBytes(2048)).toBe('2.0 KB')
    expect(formatBytes(3 * 1024 * 1024)).toBe('3.0 MB')
  })

  it('describeUpdate 覆盖主要阶段', () => {
    expect(describeUpdate(view({ phase: 'disabled', enabled: false, message: '此构建未接入自动更新' }))).toBe(
      '此构建未接入自动更新',
    )
    expect(describeUpdate(view({ phase: 'up-to-date' }))).toBe('已是最新版本')
    expect(describeUpdate(view({ phase: 'available', available: offer }))).toBe('发现新版本 0.2.0+5')
    expect(
      describeUpdate(
        view({ phase: 'downloading', available: offer, progress: { received: 1, total: 4, bytesPerSecond: 0 } }),
      ),
    ).toBe('正在下载 0.2.0+5 25%')
    expect(describeUpdate(view({ phase: 'downloaded', available: offer }))).toContain('重启即可完成安装')
    expect(describeUpdate(view({ phase: 'error', message: 'boom' }))).toBe('更新失败：boom')
  })
})
