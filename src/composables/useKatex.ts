import katex from 'katex'

/**
 * 处理 KaTeX 数学公式
 * 支持行内公式 $...$ 和块级公式 $$...$$
 */
export function processKatex(html: string): string {
  // 处理块级公式 $$...$$
  html = html.replace(/\$\$([\s\S]+?)\$\$/g, (_match, code: string) => {
    try {
      const cleaned = code
        .replace(/<br\s*\/?>/gi, ' ')
        .replace(/<[^>]+>/g, '')
        .replace(/\s+/g, ' ')
        .trim()
      const rendered = katex.renderToString(cleaned, {
        displayMode: true,
        throwOnError: false,
        trust: true
      })
      return `<div class="katex-block">${rendered}</div>`
    } catch (error) {
      console.error('KaTeX block render error:', error)
      return `<pre class="katex-error">\${error instanceof Error ? error.message : 'Error'}</pre>`
    }
  })

  // 处理行内公式 $...$ (需要更精确的匹配，避免误匹配 URL 等)
  html = html.replace(/(?<!\$)\$([^\$\n]+?)\$(?!\$)/g, (_match, code: string) => {
    try {
      const cleaned = code.replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, '').trim()
      const rendered = katex.renderToString(cleaned, {
        displayMode: false,
        throwOnError: false,
        trust: true
      })
      return rendered
    } catch (error) {
      console.error('KaTeX inline render error:', error)
      return `$${code}$`
    }
  })

  return html
}

/**
 * 检查内容是否包含数学公式
 */
export function hasMath(content: string): boolean {
  return /\$\$[\s\S]+?\$\$/.test(content) || /\$[^\$\n]+?\$/.test(content)
}
