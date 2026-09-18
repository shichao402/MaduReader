import DOMPurify from 'dompurify'

export function sanitizeHtml(html: string): string {
  const allowedTags = [
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    'p', 'br', 'hr',
    'strong', 'em', 'u', 's', 'del', 'ins',
    'ul', 'ol', 'li',
    'blockquote', 'pre', 'code',
    'a', 'img', 'video', 'audio', 'source',
    'table', 'thead', 'tbody', 'tr', 'th', 'td',
    'div', 'span', 'section', 'article',
    'sup', 'sub', 'abbr',
    'details', 'summary',
    'figure', 'figcaption',
    'mark', 'time',
    'svg', 'path', 'circle', 'rect', 'ellipse', 'line', 'polyline', 'polygon', 'g', 'use', 'defs', 'symbol', 'marker', 'stop', 'linearGradient', 'radialGradient',
    'math', 'semantics', 'annotation', 'mrow', 'mi', 'mo', 'mn', 'msup', 'msub', 'msubsup', 'mfrac', 'msqrt', 'mroot', 'mtable', 'mtr', 'mtd', 'mspace', 'mtext', 'mpadded', 'mstyle', 'mover', 'munder', 'munderover', 'mmultiscripts', 'mprescripts', 'none', 'menclose', 'merror', 'mphantom'
  ]

  const allowedAttrs = [
    'href', 'src', 'alt', 'title', 'class', 'id',
    'width', 'height', 'style',
    'target', 'rel', 'type',
    'start', 'align', 'valign',
    'scope', 'rowspan', 'colspan',
    'viewBox', 'xmlns', 'd', 'cx', 'cy', 'r', 'x', 'y',
    'fill', 'stroke', 'stroke-width',
    'data-code', 'data-language', 'language',
    'xlink:href', 'data-copy',
    'loading',
    'encoding', 'mathvariant', 'displaystyle', 'stretchy', 'fence', 'separator', 'lspace', 'rspace', 'width', 'height', 'depth', 'linethickness', 'columnalign', 'rowalign', 'columnlines', 'rowlines', 'frame', 'open', 'close', 'form'
  ]

  DOMPurify.addHook('beforeSanitizeAttributes', (node: Element) => {
    // 确保所有链接都有 target="_blank" 和 rel="noopener noreferrer"
    if (node.tagName === 'A' && node.getAttribute('href')) {
      if (!node.hasAttribute('target')) {
        node.setAttribute('target', '_blank')
      }
      if (!node.hasAttribute('rel')) {
        node.setAttribute('rel', 'noopener noreferrer')
      }
    }

    // 确保所有图片都有 alt 属性
    if (node.tagName === 'IMG' && !node.hasAttribute('alt')) {
      node.setAttribute('alt', '')
    }
  })

  DOMPurify.addHook('uponSanitizeAttribute', (_node: Element, data: { attrName: string; attrValue: string }) => {
    if (data.attrName === 'href' || data.attrName === 'src') {
      const value = data.attrValue.toLowerCase()
      const hasScheme = /^[a-z][a-z0-9+.-]*:/i.test(value)
      const isBlocked = value.startsWith('javascript:') || value.startsWith('vbscript:')
      const isUnsafeData = value.startsWith('data:') && !value.startsWith('data:image/')

      if (isBlocked || isUnsafeData) {
        return false
      }

      // 允许相对路径、本地 file/asset 路径、常见外部协议和经过用户确认的自定义协议。
      if (!hasScheme) return true
    }
    return true
  })

  const clean = DOMPurify.sanitize(html, {
    ALLOWED_TAGS: allowedTags,
    ALLOWED_ATTR: allowedAttrs,
    ADD_ATTR: ['target', 'rel'],
    ALLOWED_URI_REGEXP: /^(?:(?!(?:javascript|vbscript):)[a-z][a-z0-9+.-]*:|[^a-z]|[a-z+.-]+(?:[^a-z+.-:]|$))/i,
    ALLOW_DATA_ATTR: false,
    KEEP_CONTENT: true
  })

  return clean
}
