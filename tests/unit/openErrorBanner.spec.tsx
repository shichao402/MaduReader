import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import OpenErrorBanner from '../../src/components/OpenErrorBanner'

const noop = () => {}
function render(retry = false) {
  return renderToStaticMarkup(createElement(OpenErrorBanner, {
    notice: { title: '无法打开', details: '<script>error</script>\nD:\\notes\\a.md', requestId: 42, retry },
    onDismiss: noop, onRetry: noop,
  }))
}

describe('open result notice', () => {
  it('shows correlated errors with an accessible alert and dismissal', () => {
    const html = render()
    expect(html).toContain('role="alert"')
    expect(html).toContain('请求 42')
    expect(html).toContain('关闭打开错误提示')
  })
  it('escapes file names and errors rather than inserting HTML', () => {
    expect(render()).toContain('&lt;script&gt;error&lt;/script&gt;')
    expect(render()).not.toContain('<script>error</script>')
  })
  it('only offers retry for an uncompleted transport request', () => {
    expect(render(true)).toContain('重试处理')
    expect(render(false)).not.toContain('重试处理')
  })
})
