import { describe, it, expect, beforeEach } from 'vitest'
import { renderMarkdown, renderMermaid, initCodeCopy } from '../../src/composables/useMarkdown'

describe('useMarkdown', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
  })

  describe('renderMarkdown', () => {
    it('should render headings', () => {
      const markdown = '# Title\n## Subtitle'
      const html = renderMarkdown(markdown)
      
      expect(html).toContain('<h1')
      expect(html).toContain('<h2')
      expect(html).toContain('Title')
      expect(html).toContain('Subtitle')
    })

    it('should render paragraphs', () => {
      const markdown = 'Paragraph 1\n\nParagraph 2'
      const html = renderMarkdown(markdown)
      
      expect(html).toContain('<p>')
      expect(html).toContain('</p>')
    })

    it('should render bold and italic text', () => {
      const markdown = '**bold** and *italic* and ***bold italic***'
      const html = renderMarkdown(markdown)
      
      expect(html).toContain('<strong>bold</strong>')
      expect(html).toContain('<em>italic</em>')
    })

    it('should render code blocks', () => {
      const markdown = '```javascript\nconst x = 1;\n```'
      const html = renderMarkdown(markdown)
      
      expect(html).toContain('<pre')
      expect(html).toContain('<code')
    })

    it('should render inline code', () => {
      const markdown = 'Use `console.log()` for debugging'
      const html = renderMarkdown(markdown)
      
      expect(html).toContain('<code')
      expect(html).toContain('console.log')
    })

    it('should render lists', () => {
      const markdown = '- Item 1\n- Item 2\n- Item 3'
      const html = renderMarkdown(markdown)
      
      expect(html).toContain('<ul')
      expect(html).toContain('<li>')
      expect((html.match(/<li>/g) || []).length).toBe(3)
    })

    it('should render ordered lists', () => {
      const markdown = '1. First\n2. Second\n3. Third'
      const html = renderMarkdown(markdown)
      
      expect(html).toContain('<ol')
      expect(html).toContain('<li>')
    })

    it('should render blockquotes', () => {
      const markdown = '> This is a quote'
      const html = renderMarkdown(markdown)
      
      expect(html).toContain('<blockquote')
      expect(html).toContain('This is a quote')
    })

    it('should render links', () => {
      const markdown = '[Example](https://example.com)'
      const html = renderMarkdown(markdown)
      
      expect(html).toContain('<a')
      expect(html).toContain('href')
      expect(html).toContain('Example')
    })

    it('should render images', () => {
      const markdown = '![Alt text](image.png)'
      const html = renderMarkdown(markdown)
      
      expect(html).toContain('<img')
      expect(html).toContain('alt')
      expect(html).toContain('src')
    })

    it('should render tables', () => {
      const markdown = '| Header 1 | Header 2 |\n| --- | --- |\n| Cell 1 | Cell 2 |'
      const html = renderMarkdown(markdown)
      
      expect(html).toContain('<table')
      expect(html).toContain('<tr')
      expect(html).toContain('<td')
    })

    it('should render task lists', () => {
      const markdown = '- [x] Done\n- [ ] Todo'
      const html = renderMarkdown(markdown)
      
      expect(html).toContain('task-list-item')
    })

    it('should render footnotes', () => {
      const markdown = 'Text[^1]\n\n[^1]: Footnote content'
      const html = renderMarkdown(markdown)
      
      expect(html).toContain('sup')
    })

    it('should render subscripts', () => {
      const markdown = 'H~2~O'
      const html = renderMarkdown(markdown)
      
      expect(html).toContain('<sub')
      expect(html).toContain('2')
    })

    it('should render superscripts', () => {
      const markdown = 'x^2^'
      const html = renderMarkdown(markdown)
      
      expect(html).toContain('<sup')
      expect(html).toContain('2')
    })

    it('should render abbreviations', () => {
      const markdown = '*[HTML]: Hyper Text Markup Language\nHTML is great!'
      const html = renderMarkdown(markdown)
      
      expect(html).toContain('Hyper Text Markup Language')
    })

    it('should render inserted text', () => {
      const markdown = '++inserted++'
      const html = renderMarkdown(markdown)
      
      expect(html).toContain('<ins')
    })

    it('should render highlighted text', () => {
      const markdown = '==highlighted=='
      const html = renderMarkdown(markdown)
      
      expect(html).toContain('mark')
    })

    it('should render empty content', () => {
      const markdown = ''
      const html = renderMarkdown(markdown)
      
      expect(html).toBeDefined()
    })

    it('should handle mixed content', () => {
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
      const html = renderMarkdown(markdown)
      
      expect(html).toContain('<h1')
      expect(html).toContain('<p>')
      expect(html).toContain('<ul')
      expect(html).toContain('<pre')
      expect(html).toContain('<blockquote')
      expect(html).toContain('<table')
    })

    it('should render code blocks with language label', () => {
      const markdown = '```python\ndef hello():\n    print("Hi")\n```'
      const html = renderMarkdown(markdown)
      
      expect(html).toContain('language-python')
      expect(html).toContain('python')
    })

    it('should render code blocks without highlighting when language unknown', () => {
      const markdown = '```xyzunknown\ntest code\n```'
      const html = renderMarkdown(markdown)
      
      expect(html).toContain('<pre')
      expect(html).toContain('test code')
    })
  })

  describe('renderMermaid', () => {
    it('should return mermaid code unchanged', () => {
      const code = 'flowchart TD\n    A --> B'
      const result = renderMermaid(code)
      
      expect(result).toBe(code)
    })

    it('should handle empty code', () => {
      const code = ''
      const result = renderMermaid(code)
      
      expect(result).toBe('')
    })
  })

  describe('initCodeCopy', () => {
    it('should add click handler to document', () => {
      // This test verifies initCodeCopy doesn't throw
      expect(() => {
        initCodeCopy()
      }).not.toThrow()
    })
  })
})
