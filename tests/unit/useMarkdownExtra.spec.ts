import { describe, it, expect, beforeEach } from 'vitest'
import { renderMarkdownAsync } from '../../src/composables/useMarkdown'

describe('useMarkdown - Additional Coverage', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
  })

  describe('Code block handling', () => {
    it('should handle code with special characters in language', async () => {
      const markdown = '```python3.11\ndef test():\n    pass\n```'
      const html = await renderMarkdownAsync(markdown)
      
      expect(html).toContain('<pre')
    })

    it('should handle code with empty content', async () => {
      const markdown = '```python\n\n```'
      const html = await renderMarkdownAsync(markdown)
      
      expect(html).toContain('<pre')
    })

    it('should handle code with only whitespace', async () => {
      const markdown = '```python\n   \t  \n```'
      const html = await renderMarkdownAsync(markdown)
      
      expect(html).toContain('<pre')
    })

    it('should handle multiple code blocks', async () => {
      const markdown = '```javascript\nconst x = 1;\n```\n\n```python\nx = 1\n```'
      const html = await renderMarkdownAsync(markdown)
      
      const preCount = (html.match(/<pre/g) || []).length
      expect(preCount).toBeGreaterThanOrEqual(2)
    })

    it('should handle code block with very long content', async () => {
      const longCode = 'const x = '.repeat(1000)
      const markdown = `\`\`\`javascript\n${longCode}\n\`\`\``
      const html = await renderMarkdownAsync(markdown)
      
      expect(html).toContain('<pre')
    })

    it('should handle code block with unicode characters', async () => {
      const markdown = '```python\ndef 你好():\n    print("你好")\n```'
      const html = await renderMarkdownAsync(markdown)
      
      expect(html).toContain('<pre')
    })

    it('should handle code block with comments', async () => {
      const markdown = '```javascript\n// This is a comment\n/* Multi-line comment */\nconst x = 1;\n```'
      const html = await renderMarkdownAsync(markdown)
      
      expect(html).toContain('<pre')
    })

    it('should handle code block with strings', async () => {
      const markdown = '```javascript\nconst msg = "Hello \'world\'";\nconst path = `user/${name}`;\n```'
      const html = await renderMarkdownAsync(markdown)
      
      expect(html).toContain('<pre')
    })
  })

  describe('Image lazy loading', () => {
    it('should add loading="lazy" to images', async () => {
      const markdown = '![Test](image.png)'
      const html = await renderMarkdownAsync(markdown)
      
      expect(html).toContain('loading="lazy"')
    })

    it('should handle multiple images', async () => {
      const markdown = '![A](a.png)\n\n![B](b.png)'
      const html = await renderMarkdownAsync(markdown)
      
      const matches = html.match(/loading="lazy"/g) || []
      expect(matches.length).toBe(2)
    })

    it('should handle images with title attribute', async () => {
      const markdown = '![Test](image.png "title")'
      const html = await renderMarkdownAsync(markdown)
      
      expect(html).toContain('loading="lazy"')
    })
  })

  describe('Complex markdown combinations', () => {
    it('should handle code blocks inside lists', async () => {
      const markdown = '- Item 1\n- ```python\nx = 1\n```'
      const html = await renderMarkdownAsync(markdown)
      
      expect(html).toContain('<ul')
      expect(html).toContain('<pre')
    })

    it('should handle nested emphasis', async () => {
      const markdown = '***bold italic*** and **bold *italic* bold**'
      const html = await renderMarkdownAsync(markdown)
      
      expect(html).toContain('<strong')
      expect(html).toContain('<em')
    })

    it('should handle links and images together', async () => {
      const markdown = '[Link](url) and ![Image](img.png)'
      const html = await renderMarkdownAsync(markdown)
      
      expect(html).toContain('<a')
      expect(html).toContain('<img')
    })

    it('should handle tables with code', async () => {
      const markdown = '| Code | Output |\n|---|---|\n| ```python\nx=1\n``` | 1 |'
      const html = await renderMarkdownAsync(markdown)
      
      expect(html).toContain('<table')
      expect(html).toContain('<pre')
    })

    it('should handle multiple headings', async () => {
      const markdown = '# H1\n## H2\n### H3\n#### H4\n##### H5\n###### H6'
      const html = await renderMarkdownAsync(markdown)
      
      expect(html).toContain('<h1')
      expect(html).toContain('<h2')
      expect(html).toContain('<h3')
    })
  })

  describe('Edge cases', () => {
    it('should handle empty markdown', async () => {
      const html = await renderMarkdownAsync('')
      
      expect(html).toBeDefined()
    })

    it('should handle whitespace only markdown', async () => {
      const html = await renderMarkdownAsync('   \n\n   ')
      
      expect(html).toBeDefined()
    })

    it('should handle markdown with only special characters', async () => {
      const markdown = '***\n###\n---'
      const html = await renderMarkdownAsync(markdown)
      
      expect(html).toBeDefined()
    })

    it('should handle very long markdown', async () => {
      const longContent = '# Title\n\n'.repeat(1000)
      const html = await renderMarkdownAsync(longContent)
      
      expect(html).toBeDefined()
      expect(html).toContain('<h1')
    })
  })
})
