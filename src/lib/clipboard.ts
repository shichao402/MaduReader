/** 保持在用户点击的调用链中写剪贴板，兼容没有 Clipboard API 的 WebView。 */
export async function copyText(text: string): Promise<void> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return
    }
  } catch {
    // 某些 WebView 不提供异步剪贴板权限，尝试原生编辑命令。
  }

  const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
  const selection = window.getSelection()
  const ranges = selection ? Array.from({ length: selection.rangeCount }, (_, i) => selection.getRangeAt(i).cloneRange()) : []
  const input = document.createElement('textarea')
  input.value = text
  input.setAttribute('aria-hidden', 'true')
  input.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0;'
  document.body.appendChild(input)
  try {
    input.select()
    if (!document.execCommand?.('copy')) throw new Error('Clipboard write failed')
  } finally {
    input.remove()
    previousFocus?.focus({ preventScroll: true })
    if (selection) {
      selection.removeAllRanges()
      ranges.forEach((range) => selection.addRange(range))
    }
  }
}
