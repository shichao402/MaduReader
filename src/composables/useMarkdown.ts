import MarkdownIt from 'markdown-it'
import hljs from 'highlight.js'
import markdownItTaskLists from 'markdown-it-task-lists'
import markdownItFootnote from 'markdown-it-footnote'
import markdownItSub from 'markdown-it-sub'
import markdownItSup from 'markdown-it-sup'
import markdownItAbbr from 'markdown-it-abbr'
import markdownItIns from 'markdown-it-ins'
import markdownItMark from 'markdown-it-mark'
import { sanitizeHtml } from './sanitizeHtml'
import { processKatex } from './useKatex'

export interface MarkdownOptions {
  html?: boolean
  xhtmlOut?: boolean
  breaks?: boolean
  linkify?: boolean
  typographer?: boolean
  langPrefix?: string
  highlight?: (str: string, lang: string) => string
}

let mdInstance: MarkdownIt | null = null

function createMarkdownIt() {
  const md = new MarkdownIt({
    html: true,
    xhtmlOut: true,
    breaks: true,
    linkify: true,
    typographer: true,
    langPrefix: 'language-'
  })

  // 代码高亮
  md.set({
    highlight: (str: string, lang: string) => {
      if (lang && hljs.getLanguage(lang)) {
        try {
          const result = hljs.highlight(str, { language: lang }).value
          return `<pre class="hljs"><div class="code-header"><span class="language-label">${lang}</span><button class="copy-btn" data-code="${str.replace(/"/g, '&quot;')}">复制</button></div><code class="language-${lang}">${result}</code></pre>`
        } catch (err) {
          console.error('Highlight error:', err)
        }
      }
      const languageClass = lang ? ` class="language-${md.utils.escapeHtml(lang)}"` : ''
      return `<pre class="hljs"><code${languageClass}>${md.utils.escapeHtml(str)}</code></pre>`
    }
  })

  // 任务列表
  md.use(markdownItTaskLists, { enabled: true })

  // 脚注
  md.use(markdownItFootnote)

  // 下标
  md.use(markdownItSub)

  // 上标
  md.use(markdownItSup)

  // 缩写
  md.use(markdownItAbbr)

  // 删除线
  md.use(markdownItIns)

  // 高亮标记
  md.use(markdownItMark)

  return md
}

export function getMarkdownInstance(): MarkdownIt {
  if (!mdInstance) {
    mdInstance = createMarkdownIt()
  }
  return mdInstance
}

export function renderMarkdown(source: string): string {
  const md = getMarkdownInstance()
  let html = md.render(source)
  
  // 处理 KaTeX 数学公式
  html = processKatex(html)
  
  // 添加图片懒加载
  html = html.replace(/<img([^>]*)>/gi, (_, attrs) => {
    return `<img loading="lazy"${attrs}>`
  })
  
  // 清理和消毒 HTML
  html = sanitizeHtml(html)
  html = restoreCodeCopyButtons(html)
  
  return html
}

function restoreCodeCopyButtons(html: string): string {
  if (typeof DOMParser === 'undefined') return html

  const parser = new DOMParser()
  const doc = parser.parseFromString(html, 'text/html')

  doc.querySelectorAll('pre.hljs').forEach(pre => {
    const code = pre.querySelector('code')
    if (!code) return

    let header = pre.querySelector('.code-header')
    if (!header) {
      header = doc.createElement('div')
      header.className = 'code-header'
      const language = Array.from(code.classList)
        .find(className => className.startsWith('language-'))
        ?.replace('language-', '')

      if (language) {
        const label = doc.createElement('span')
        label.className = 'language-label'
        label.textContent = language
        header.appendChild(label)
      }
      pre.insertBefore(header, code)
    }

    header.childNodes.forEach(child => {
      if (child.nodeType === Node.TEXT_NODE) {
        child.textContent = ''
      }
    })

    if (!header.querySelector('.copy-btn')) {
      const button = doc.createElement('button')
      button.className = 'copy-btn'
      button.setAttribute('data-code', code.textContent || '')
      button.textContent = '复制'
      header.appendChild(button)
    }
  })

  return doc.body.innerHTML
}

export function renderMermaid(code: string): string {
  // Mermaid 代码块的处理由 ContentArea.vue 中的 mermaid 库处理
  return code
}

// 代码复制功能
export function initCodeCopy() {
  document.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest('.copy-btn') as HTMLElement
    if (btn) {
      const code = btn.getAttribute('data-code') || ''
      navigator.clipboard.writeText(code).then(() => {
        const originalText = btn.textContent
        btn.textContent = '已复制'
        setTimeout(() => {
          btn.textContent = originalText
        }, 2000)
      })
    }
  })
}
