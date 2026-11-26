import { describe, expect, it } from 'vitest'
import { renderMarkdownAsync } from '../../src/composables/useMarkdown'

describe('markdown source line map', () => {
  it('为标题和多行段落保留 1-based 源码起止行', async () => {
    const html = await renderMarkdownAsync('# 标题\n\n第一行\n第二行\n\n最后一段')
    const doc = new DOMParser().parseFromString(html, 'text/html')
    const heading = doc.querySelector('h1')!
    const paragraphs = doc.querySelectorAll('p')
    expect(heading.getAttribute('data-source-line')).toBe('1')
    expect(heading.getAttribute('data-source-line-end')).toBe('1')
    expect(paragraphs[0].getAttribute('data-source-line')).toBe('3')
    expect(paragraphs[0].getAttribute('data-source-line-end')).toBe('4')
    expect(paragraphs[1].getAttribute('data-source-line')).toBe('6')
    expect(paragraphs[1].getAttribute('data-source-line-end')).toBe('6')
  })

  it('自定义高亮代码块也保留完整源码范围', async () => {
    const html = await renderMarkdownAsync('```ts\nconst value = 1\n```')
    const doc = new DOMParser().parseFromString(html, 'text/html')
    const pre = doc.querySelector('pre')!
    expect(pre.getAttribute('data-source-line')).toBe('1')
    expect(pre.getAttribute('data-source-line-end')).toBe('3')
  })
})
