import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderMarkdown, renderMermaid, initCodeCopy } from '../../src/composables/useMarkdown'

describe('useMarkdown - Error Handling Coverage', () => {
  let mockClipboard: {
    writeText: ReturnType<typeof vi.fn>
  }

  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    document.body.innerHTML = ''
    
    // Mock clipboard API
    mockClipboard = {
      writeText: vi.fn().mockResolvedValue(undefined)
    }
    
    Object.defineProperty(navigator, 'clipboard', {
      value: mockClipboard,
      writable: true
    })
  })

  describe('renderMarkdown - Highlight Error Handling', () => {
    it('should catch highlight error for invalid language', () => {
      // This will trigger the catch block for highlight
      const markdown = '```invalidlang12345\nconst x = 1;\n```'
      const html = renderMarkdown(markdown)
      
      // Should still produce valid HTML
      expect(html).toContain('<pre')
      expect(html).toContain('const x = 1')
    })

    it('should handle code block with special characters', () => {
      const markdown = '```javascript\nconst x = "test\";\n```'
      const html = renderMarkdown(markdown)
      
      expect(html).toContain('<pre')
    })

    it('should handle code block with unicode', () => {
      const markdown = '```python\nprint("你好世界")\n```'
      const html = renderMarkdown(markdown)
      
      expect(html).toContain('<pre')
      expect(html).toContain('你好世界')
    })

    it('should handle code block with escaped characters', () => {
      const markdown = '```bash\necho "test\\nvalue"\n```'
      const html = renderMarkdown(markdown)
      
      expect(html).toContain('<pre')
    })

    it('should handle code block with very long content', () => {
      const longCode = 'const x = '.repeat(100)
      const markdown = `\`\`\`javascript\n${longCode}\n\`\`\``
      const html = renderMarkdown(markdown)
      
      expect(html).toContain('<pre')
    })
  })

  describe('renderMarkdown - InitCodeCopy Coverage', () => {
    it('should handle code copy button click', () => {
      // Create a copy button
      const button = document.createElement('button')
      button.className = 'copy-btn'
      button.setAttribute('data-code', 'const x = 1;')
      document.body.appendChild(button)

      initCodeCopy()

      // Simulate click
      button.click()

      // Wait for async operation
      return new Promise(resolve => {
        setTimeout(() => {
          document.body.innerHTML = ''
          resolve()
        }, 100)
      })
    })

    it('should handle code copy with empty code', () => {
      const button = document.createElement('button')
      button.className = 'copy-btn'
      button.setAttribute('data-code', '')
      document.body.appendChild(button)

      initCodeCopy()
      button.click()

      return new Promise(resolve => {
        setTimeout(() => {
          document.body.innerHTML = ''
          resolve()
        }, 100)
      })
    })

    it('should handle code copy with special characters', () => {
      const button = document.createElement('button')
      button.className = 'copy-btn'
      button.setAttribute('data-code', 'const x = "test\";')
      document.body.appendChild(button)

      initCodeCopy()
      button.click()

      return new Promise(resolve => {
        setTimeout(() => {
          document.body.innerHTML = ''
          resolve()
        }, 100)
      })
    })

    it('should not error on non-copy-btn clicks', () => {
      const button = document.createElement('button')
      button.className = 'other-btn'
      document.body.appendChild(button)

      initCodeCopy()
      button.click()

      // Should not throw
      expect(true).toBe(true)
    })

    it('should handle multiple copy buttons', () => {
      for (let i = 0; i < 3; i++) {
        const button = document.createElement('button')
        button.className = 'copy-btn'
        button.setAttribute('data-code', `code ${i}`)
        document.body.appendChild(button)
      }

      initCodeCopy()

      // Click each button
      document.querySelectorAll('.copy-btn').forEach((btn, index) => {
        btn.click()
      })

      return new Promise(resolve => {
        setTimeout(() => {
          document.body.innerHTML = ''
          resolve()
        }, 100)
      })
    })
  })

  describe('renderMarkdown - Edge Cases', () => {
    it('should handle markdown with only whitespace', () => {
      const markdown = '   \n\n   '
      const html = renderMarkdown(markdown)
      
      expect(html).toBeDefined()
    })

    it('should handle markdown with special HTML entities', () => {
      const markdown = 'Use &amp; for ampersand, &lt; for less than, &gt; for greater than'
      const html = renderMarkdown(markdown)
      
      expect(html).toContain('&amp;')
      expect(html).toContain('&lt;')
      expect(html).toContain('&gt;')
    })

    it('should handle markdown with emoji', () => {
      const markdown = 'Hello 😀 world 🎉'
      const html = renderMarkdown(markdown)
      
      expect(html).toContain('😀')
      expect(html).toContain('🎉')
    })

    it('should handle markdown with CJK characters', () => {
      const markdown = '你好世界\n\n这是中文内容\n\n- 列表项1\n- 列表项2'
      const html = renderMarkdown(markdown)
      
      expect(html).toContain('你好世界')
      expect(html).toContain('这是中文内容')
      expect(html).toContain('<li>')
    })

    it('should handle markdown with RTL text', () => {
      const markdown = 'Hello مرحبا Hello'
      const html = renderMarkdown(markdown)
      
      expect(html).toContain('مرحبا')
    })

    it('should handle very long markdown document', () => {
      let longMarkdown = ''
      for (let i = 0; i < 100; i++) {
        longMarkdown += `## Section ${i}\n\nThis is content for section ${i}.\n\n`
      }
      const html = renderMarkdown(longMarkdown)
      
      expect(html).toContain('<h2')
    })

    it('should handle markdown with many code blocks', () => {
      let markdown = ''
      for (let i = 0; i < 10; i++) {
        markdown += `\`\`\`javascript\nconst x${i} = ${i};\n\`\`\`\n\n`
      }
      const html = renderMarkdown(markdown)
      
      const preCount = (html.match(/<pre/g) || []).length
      expect(preCount).toBe(10)
    })

    it('should handle markdown with nested emphasis', () => {
      const markdown = '***bold italic***'
      const html = renderMarkdown(markdown)
      
      expect(html).toContain('<strong')
      expect(html).toContain('<em')
    })

    it('should handle markdown with strikethrough', () => {
      const markdown = '~~strikethrough~~'
      const html = renderMarkdown(markdown)
      
      // markdown-it uses <s> for strikethrough by default
      expect(html).toContain('<s>strikethrough</s>')
    })

    it('should handle markdown with horizontal rule', () => {
      const markdown = '---'
      const html = renderMarkdown(markdown)
      
      expect(html).toContain('<hr')
    })

    it('should handle markdown with nested lists', () => {
      const markdown = '- Item 1\n  - Subitem 1\n    - Subsubitem 1\n  - Subitem 2\n- Item 2'
      const html = renderMarkdown(markdown)
      
      expect(html).toContain('<ul')
      expect(html).toContain('<li')
    })

    it('should handle markdown with definition lists', () => {
      const markdown = 'Term 1\n: Definition 1\n\nTerm 2\n: Definition 2'
      const html = renderMarkdown(markdown)
      
      expect(html).toBeDefined()
    })
  })

  describe('renderMermaid - Additional Coverage', () => {
    it('should handle mermaid code with special characters', () => {
      const code = 'flowchart TD\n    A["Start"] --> B["End"]'
      const result = renderMermaid(code)
      
      expect(result).toBe(code)
    })

    it('should handle mermaid code with unicode', () => {
      const code = 'flowchart TD\n    A["你好"] --> B["世界"]'
      const result = renderMermaid(code)
      
      expect(result).toBe(code)
    })

    it('should handle very long mermaid code', () => {
      let longCode = 'flowchart TD\n'
      for (let i = 0; i < 50; i++) {
        longCode += `    A${i} --> A${i + 1}\n`
      }
      const result = renderMermaid(longCode)
      
      expect(result).toBe(longCode)
    })

    it('should handle empty mermaid code string', () => {
      const code = ''
      const result = renderMermaid(code)
      
      expect(result).toBe('')
    })

    it('should handle mermaid code with numbers', () => {
      const code = 'gantt\n    title Project\n    section Section\n    Task 1 :a1, 2024-01-01, 3d'
      const result = renderMermaid(code)
      
      expect(result).toBe(code)
    })

    it('should handle mermaid code with quotes', () => {
      const code = 'sequenceDiagram\n    Alice->>Bob: "Hello"'
      const result = renderMermaid(code)
      
      expect(result).toBe(code)
    })
  })
})
