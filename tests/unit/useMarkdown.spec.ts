import { describe, it, expect, beforeEach } from 'vitest'
import { renderMarkdownAsync, renderMermaid, initCodeCopy } from '../../src/composables/useMarkdown'

describe('useMarkdown', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
  })

  describe('renderMarkdownAsync', () => {
    it('should render headings', async () => {
      const markdown = '# Title\n## Subtitle'
      const html = await renderMarkdownAsync(markdown)
      
      expect(html).toContain('<h1')
      expect(html).toContain('<h2')
      expect(html).toContain('Title')
      expect(html).toContain('Subtitle')
    })

    it('should render paragraphs', async () => {
      const markdown = 'Paragraph 1\n\nParagraph 2'
      const html = await renderMarkdownAsync(markdown)
      
      expect(html).toContain('<p>')
      expect(html).toContain('</p>')
    })

    it('should render bold and italic text', async () => {
      const markdown = '**bold** and *italic* and ***bold italic***'
      const html = await renderMarkdownAsync(markdown)
      
      expect(html).toContain('<strong>bold</strong>')
      expect(html).toContain('<em>italic</em>')
    })

    it('should render code blocks', async () => {
      const markdown = '```javascript\nconst x = 1;\n```'
      const html = await renderMarkdownAsync(markdown)
      
      expect(html).toContain('<pre')
      expect(html).toContain('<code')
    })

    it('should render inline code', async () => {
      const markdown = 'Use `console.log()` for debugging'
      const html = await renderMarkdownAsync(markdown)
      
      expect(html).toContain('<code')
      expect(html).toContain('console.log')
    })

    it('should render lists', async () => {
      const markdown = '- Item 1\n- Item 2\n- Item 3'
      const html = await renderMarkdownAsync(markdown)
      
      expect(html).toContain('<ul')
      expect(html).toContain('<li>')
      expect((html.match(/<li>/g) || []).length).toBe(3)
    })

    it('should render ordered lists', async () => {
      const markdown = '1. First\n2. Second\n3. Third'
      const html = await renderMarkdownAsync(markdown)
      
      expect(html).toContain('<ol')
      expect(html).toContain('<li>')
    })

    it('should render blockquotes', async () => {
      const markdown = '> This is a quote'
      const html = await renderMarkdownAsync(markdown)
      
      expect(html).toContain('<blockquote')
      expect(html).toContain('This is a quote')
    })

    it('should render links', async () => {
      const markdown = '[Example](https://example.com)'
      const html = await renderMarkdownAsync(markdown)
      
      expect(html).toContain('<a')
      expect(html).toContain('href')
      expect(html).toContain('Example')
    })

    it('should render images', async () => {
      const markdown = '![Alt text](image.png)'
      const html = await renderMarkdownAsync(markdown)
      
      expect(html).toContain('<img')
      expect(html).toContain('alt')
      expect(html).toContain('src')
    })

    it('should render tables', async () => {
      const markdown = '| Header 1 | Header 2 |\n| --- | --- |\n| Cell 1 | Cell 2 |'
      const html = await renderMarkdownAsync(markdown)
      
      expect(html).toContain('<table')
      expect(html).toContain('<tr')
      expect(html).toContain('<td')
    })

    it('should render task lists', async () => {
      const markdown = '- [x] Done\n- [ ] Todo'
      const html = await renderMarkdownAsync(markdown)
      
      expect(html).toContain('task-list-item')
    })

    it('should render footnotes', async () => {
      const markdown = 'Text[^1]\n\n[^1]: Footnote content'
      const html = await renderMarkdownAsync(markdown)
      
      expect(html).toContain('sup')
    })

    it('should render subscripts', async () => {
      const markdown = 'H~2~O'
      const html = await renderMarkdownAsync(markdown)
      
      expect(html).toContain('<sub')
      expect(html).toContain('2')
    })

    it('should render superscripts', async () => {
      const markdown = 'x^2^'
      const html = await renderMarkdownAsync(markdown)
      
      expect(html).toContain('<sup')
      expect(html).toContain('2')
    })

    it('should render abbreviations', async () => {
      const markdown = '*[HTML]: Hyper Text Markup Language\nHTML is great!'
      const html = await renderMarkdownAsync(markdown)
      
      expect(html).toContain('Hyper Text Markup Language')
    })

    it('should render inserted text', async () => {
      const markdown = '++inserted++'
      const html = await renderMarkdownAsync(markdown)
      
      expect(html).toContain('<ins')
    })

    it('should render highlighted text', async () => {
      const markdown = '==highlighted=='
      const html = await renderMarkdownAsync(markdown)
      
      expect(html).toContain('mark')
    })

    it('should render empty content', async () => {
      const markdown = ''
      const html = await renderMarkdownAsync(markdown)
      
      expect(html).toBeDefined()
    })

    it('should handle mixed content', async () => {
      const markdown = `# Title

Paragraph with **bold** and *italic*.

- Item 1
- Item 2

\`\`\`javascript
const x = 1;
\`\`\`

> Quote

| A | B |
|---|---|
| 1 | 2 |`
      const html = await renderMarkdownAsync(markdown)
      
      expect(html).toContain('<h1')
      expect(html).toContain('<p>')
      expect(html).toContain('<ul')
      expect(html).toContain('<pre')
      expect(html).toContain('<blockquote')
      expect(html).toContain('<table')
    })

    it('should render code blocks with language label', async () => {
      const markdown = '```python\ndef hello():\n    print("Hi")\n```'
      const html = await renderMarkdownAsync(markdown)
      
      expect(html).toContain('language-python')
      expect(html).toContain('python')
    })

    it('should render code blocks without highlighting when language unknown', async () => {
      const markdown = '```xyzunknown\ntest code\n```'
      const html = await renderMarkdownAsync(markdown)
      
      expect(html).toContain('<pre')
      expect(html).toContain('test code')
    })
  })

  describe('renderMermaid', () => {
    it('should return mermaid code unchanged', async () => {
      const code = 'flowchart TD\n    A --> B'
      const result = renderMermaid(code)
      
      expect(result).toBe(code)
    })

    it('should handle empty code', async () => {
      const code = ''
      const result = renderMermaid(code)
      
      expect(result).toBe('')
    })
  })

  describe('initCodeCopy', () => {
    it('should add click handler to document', async () => {
      // This test verifies initCodeCopy doesn't throw
      expect(() => {
        initCodeCopy()
      }).not.toThrow()
    })
  })
})
