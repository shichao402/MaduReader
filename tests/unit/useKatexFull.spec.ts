import { describe, it, expect, vi, beforeEach } from 'vitest'
import { processKatex, hasMath } from '../../src/composables/useKatex'

describe('useKatex - Full Error Handling Coverage', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  describe('processKatex - Block Math with Various Errors', () => {
    it('should handle deeply nested invalid commands', async () => {
      const html = '<p>$$\frac{\frac{\frac{\invalid}}{2}}{3}$$</p>'
      const result = await processKatex(html)
      
      expect(result).toBeDefined()
      expect(result).toContain('katex-block')
    })

    it('should handle array with missing entries', async () => {
      const html = '<p>$$\begin{array}{cc} a & b \\ c & $$</p>'
      const result = await processKatex(html)
      
      expect(result).toBeDefined()
    })

    it('should handle cases environment with incomplete cases', async () => {
      const html = '<p>$$f(x) = \begin{cases} x & \text{if } x > 0 \\ $$</p>'
      const result = await processKatex(html)
      
      expect(result).toBeDefined()
    })

    it('should handle align environment with missing ampersands', async () => {
      const html = '<p>$$\begin{align} a = b \\ c = d $$</p>'
      const result = await processKatex(html)
      
      expect(result).toBeDefined()
    })

    it('should handle gather environment with missing content', async () => {
      const html = '<p>$$\begin{gather} a = b \\ $$</p>'
      const result = await processKatex(html)
      
      expect(result).toBeDefined()
    })

    it('should handle equation with unmatched delimiters', async () => {
      const html = '<p>$$\left(\frac{a}{b}$$</p>'
      const result = await processKatex(html)
      
      expect(result).toBeDefined()
    })

    it('should handle sqrt with invalid content', async () => {
      const html = '<p>$$\sqrt{\frac{a}{}}$$</p>'
      const result = await processKatex(html)
      
      expect(result).toBeDefined()
    })

    it('should handle frac with missing denominator', async () => {
      const html = '<p>$$\frac{a}$$</p>'
      const result = await processKatex(html)
      
      expect(result).toBeDefined()
    })

    it('should handle subscript with invalid content', async () => {
      const html = '<p>$$x_$$</p>'
      const result = await processKatex(html)
      
      expect(result).toBeDefined()
    })

    it('should handle superscript with invalid content', async () => {
      const html = '<p>$$x^$$</p>'
      const result = await processKatex(html)
      
      expect(result).toBeDefined()
    })
  })

  describe('processKatex - Inline Math with Various Errors', () => {
    it('should handle inline math with nested invalid commands', async () => {
      const html = '<p>Text $\frac{\invalid}{b}$ more text</p>'
      const result = await processKatex(html)
      
      expect(result).toBeDefined()
    })

    it('should handle inline math with array', async () => {
      const html = '<p>$\begin{array}{c} a \\ b $$</p>'
      const result = await processKatex(html)
      
      expect(result).toBeDefined()
    })

    it('should handle inline math with cases', async () => {
      const html = '<p>$\begin{cases} a & \text{if } x > 0 $$</p>'
      const result = await processKatex(html)
      
      expect(result).toBeDefined()
    })

    it('should handle inline math with align', async () => {
      const html = '<p>$\begin{align} a = b $$</p>'
      const result = await processKatex(html)
      
      expect(result).toBeDefined()
    })

    it('should handle inline math with gather', async () => {
      const html = '<p>$\begin{gather} a = b $$</p>'
      const result = await processKatex(html)
      
      expect(result).toBeDefined()
    })

    it('should handle inline math with missing delimiters', async () => {
      const html = '<p>$\left(\frac{a}{b}</p>'
      const result = await processKatex(html)
      
      expect(result).toBeDefined()
    })

    it('should handle inline math with invalid sqrt', async () => {
      const html = '<p>$\sqrt{</p>'
      const result = await processKatex(html)
      
      expect(result).toBeDefined()
    })

    it('should handle inline math with invalid frac', async () => {
      const html = '<p>$\frac{a}</p>'
      const result = await processKatex(html)
      
      expect(result).toBeDefined()
    })

    it('should handle inline math with invalid subscripts', async () => {
      const html = '<p>$x_{</p>'
      const result = await processKatex(html)
      
      expect(result).toBeDefined()
    })

    it('should handle inline math with invalid superscripts', async () => {
      const html = '<p>$x^{</p>'
      const result = await processKatex(html)
      
      expect(result).toBeDefined()
    })

    it('should handle inline math with invalid text command', async () => {
      const html = '<p>$\text{</p>'
      const result = await processKatex(html)
      
      expect(result).toBeDefined()
    })

    it('should handle inline math with invalid bold command', async () => {
      const html = '<p>$\mathbf{</p>'
      const result = await processKatex(html)
      
      expect(result).toBeDefined()
    })
  })

  describe('processKatex - Mixed Content', () => {
    it('should handle multiple block math with mixed validity', async () => {
      const html = '<p>$$E=mc^2$$</p><p>$$\invalidcmd$$</p><p>$$a^2 + b^2 = c^2$$</p>'
      const result = await processKatex(html)
      
      // Should contain at least some rendered content
      expect(result).toBeDefined()
    })

    it('should handle multiple inline math with mixed validity', async () => {
      const html = '<p>This is $x^2$ and $\invalid$ and $y^2$</p>'
      const result = await processKatex(html)
      
      expect(result).toBeDefined()
    })

    it('should handle inline and block math together', async () => {
      const html = '<p>The equation $E=mc^2$ can also be written as:</p><p>$$E=mc^2$$</p>'
      const result = await processKatex(html)
      
      expect(result).toContain('katex-block')
    })

    it('should handle math with surrounding text', async () => {
      const html = '<p>Before $$\frac{a}{b}$$ after</p>'
      const result = await processKatex(html)
      
      expect(result).toContain('katex-block')
    })

    it('should handle math at very beginning of HTML', async () => {
      const html = '$$\frac{a}{b}$$<p>text</p>'
      const result = await processKatex(html)
      
      expect(result).toContain('katex-block')
    })

    it('should handle math at very end of HTML', async () => {
      const html = '<p>text</p>$$\frac{a}{b}$$'
      const result = await processKatex(html)
      
      expect(result).toContain('katex-block')
    })

    it('should handle math with newlines around it', async () => {
      const html = '<p>Line 1</p>\n$$\frac{a}{b}$$\n<p>Line 2</p>'
      const result = await processKatex(html)
      
      expect(result).toContain('katex-block')
    })

    it('should handle math with extra whitespace', async () => {
      const html = '<p>  $$  \frac{a}{b}  $$  </p>'
      const result = await processKatex(html)
      
      expect(result).toContain('katex-block')
    })
  })

  describe('hasMath - Additional Edge Cases', () => {
    it('should detect math with special characters', async () => {
      expect(hasMath('$$a^2 + b^2 = c^2$$')).toBe(true)
      expect(hasMath('$E=mc^2$')).toBe(true)
      expect(hasMath('$\frac{a}{b}$')).toBe(true)
      expect(hasMath('$$\sum_{i=1}^{n} i$$')).toBe(true)
      expect(hasMath('$\int_{0}^{\infty} e^{-x} dx$')).toBe(true)
    })

    it('should not detect math in regular text', async () => {
      expect(hasMath('This is a normal sentence.')).toBe(false)
      expect(hasMath('No math here!')).toBe(false)
      expect(hasMath('Just $ symbol without matching')).toBe(false)
      expect(hasMath('Just $$ symbol without matching')).toBe(false)
    })

    it('should handle multiple math expressions in content', async () => {
      expect(hasMath('First: $x^2$, Second: $$y^2$$')).toBe(true)
      expect(hasMath('Multiple: $a$ $b$ $c$')).toBe(true)
    })
  })
})
