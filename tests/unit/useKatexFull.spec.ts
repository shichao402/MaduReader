import { describe, it, expect, vi, beforeEach } from 'vitest'
import { processKatex, hasMath } from '../../src/composables/useKatex'

describe('useKatex - Full Error Handling Coverage', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  describe('processKatex - Block Math with Various Errors', () => {
    it('should handle deeply nested invalid commands', () => {
      const html = '<p>$$\frac{\frac{\frac{\invalid}}{2}}{3}$$</p>'
      const result = processKatex(html)
      
      expect(result).toBeDefined()
      expect(result).toContain('katex-block')
    })

    it('should handle array with missing entries', () => {
      const html = '<p>$$\begin{array}{cc} a & b \\ c & $$</p>'
      const result = processKatex(html)
      
      expect(result).toBeDefined()
    })

    it('should handle cases environment with incomplete cases', () => {
      const html = '<p>$$f(x) = \begin{cases} x & \text{if } x > 0 \\ $$</p>'
      const result = processKatex(html)
      
      expect(result).toBeDefined()
    })

    it('should handle align environment with missing ampersands', () => {
      const html = '<p>$$\begin{align} a = b \\ c = d $$</p>'
      const result = processKatex(html)
      
      expect(result).toBeDefined()
    })

    it('should handle gather environment with missing content', () => {
      const html = '<p>$$\begin{gather} a = b \\ $$</p>'
      const result = processKatex(html)
      
      expect(result).toBeDefined()
    })

    it('should handle equation with unmatched delimiters', () => {
      const html = '<p>$$\left(\frac{a}{b}$$</p>'
      const result = processKatex(html)
      
      expect(result).toBeDefined()
    })

    it('should handle sqrt with invalid content', () => {
      const html = '<p>$$\sqrt{\frac{a}{}}$$</p>'
      const result = processKatex(html)
      
      expect(result).toBeDefined()
    })

    it('should handle frac with missing denominator', () => {
      const html = '<p>$$\frac{a}$$</p>'
      const result = processKatex(html)
      
      expect(result).toBeDefined()
    })

    it('should handle subscript with invalid content', () => {
      const html = '<p>$$x_$$</p>'
      const result = processKatex(html)
      
      expect(result).toBeDefined()
    })

    it('should handle superscript with invalid content', () => {
      const html = '<p>$$x^$$</p>'
      const result = processKatex(html)
      
      expect(result).toBeDefined()
    })
  })

  describe('processKatex - Inline Math with Various Errors', () => {
    it('should handle inline math with nested invalid commands', () => {
      const html = '<p>Text $\frac{\invalid}{b}$ more text</p>'
      const result = processKatex(html)
      
      expect(result).toBeDefined()
    })

    it('should handle inline math with array', () => {
      const html = '<p>$\begin{array}{c} a \\ b $$</p>'
      const result = processKatex(html)
      
      expect(result).toBeDefined()
    })

    it('should handle inline math with cases', () => {
      const html = '<p>$\begin{cases} a & \text{if } x > 0 $$</p>'
      const result = processKatex(html)
      
      expect(result).toBeDefined()
    })

    it('should handle inline math with align', () => {
      const html = '<p>$\begin{align} a = b $$</p>'
      const result = processKatex(html)
      
      expect(result).toBeDefined()
    })

    it('should handle inline math with gather', () => {
      const html = '<p>$\begin{gather} a = b $$</p>'
      const result = processKatex(html)
      
      expect(result).toBeDefined()
    })

    it('should handle inline math with missing delimiters', () => {
      const html = '<p>$\left(\frac{a}{b}</p>'
      const result = processKatex(html)
      
      expect(result).toBeDefined()
    })

    it('should handle inline math with invalid sqrt', () => {
      const html = '<p>$\sqrt{</p>'
      const result = processKatex(html)
      
      expect(result).toBeDefined()
    })

    it('should handle inline math with invalid frac', () => {
      const html = '<p>$\frac{a}</p>'
      const result = processKatex(html)
      
      expect(result).toBeDefined()
    })

    it('should handle inline math with invalid subscripts', () => {
      const html = '<p>$x_{</p>'
      const result = processKatex(html)
      
      expect(result).toBeDefined()
    })

    it('should handle inline math with invalid superscripts', () => {
      const html = '<p>$x^{</p>'
      const result = processKatex(html)
      
      expect(result).toBeDefined()
    })

    it('should handle inline math with invalid text command', () => {
      const html = '<p>$\text{</p>'
      const result = processKatex(html)
      
      expect(result).toBeDefined()
    })

    it('should handle inline math with invalid bold command', () => {
      const html = '<p>$\mathbf{</p>'
      const result = processKatex(html)
      
      expect(result).toBeDefined()
    })
  })

  describe('processKatex - Mixed Content', () => {
    it('should handle multiple block math with mixed validity', () => {
      const html = '<p>$$E=mc^2$$</p><p>$$\invalidcmd$$</p><p>$$a^2 + b^2 = c^2$$</p>'
      const result = processKatex(html)
      
      // Should contain at least some rendered content
      expect(result).toBeDefined()
    })

    it('should handle multiple inline math with mixed validity', () => {
      const html = '<p>This is $x^2$ and $\invalid$ and $y^2$</p>'
      const result = processKatex(html)
      
      expect(result).toBeDefined()
    })

    it('should handle inline and block math together', () => {
      const html = '<p>The equation $E=mc^2$ can also be written as:</p><p>$$E=mc^2$$</p>'
      const result = processKatex(html)
      
      expect(result).toContain('katex-block')
    })

    it('should handle math with surrounding text', () => {
      const html = '<p>Before $$\frac{a}{b}$$ after</p>'
      const result = processKatex(html)
      
      expect(result).toContain('katex-block')
    })

    it('should handle math at very beginning of HTML', () => {
      const html = '$$\frac{a}{b}$$<p>text</p>'
      const result = processKatex(html)
      
      expect(result).toContain('katex-block')
    })

    it('should handle math at very end of HTML', () => {
      const html = '<p>text</p>$$\frac{a}{b}$$'
      const result = processKatex(html)
      
      expect(result).toContain('katex-block')
    })

    it('should handle math with newlines around it', () => {
      const html = '<p>Line 1</p>\n$$\frac{a}{b}$$\n<p>Line 2</p>'
      const result = processKatex(html)
      
      expect(result).toContain('katex-block')
    })

    it('should handle math with extra whitespace', () => {
      const html = '<p>  $$  \frac{a}{b}  $$  </p>'
      const result = processKatex(html)
      
      expect(result).toContain('katex-block')
    })
  })

  describe('hasMath - Additional Edge Cases', () => {
    it('should detect math with special characters', () => {
      expect(hasMath('$$a^2 + b^2 = c^2$$')).toBe(true)
      expect(hasMath('$E=mc^2$')).toBe(true)
      expect(hasMath('$\frac{a}{b}$')).toBe(true)
      expect(hasMath('$$\sum_{i=1}^{n} i$$')).toBe(true)
      expect(hasMath('$\int_{0}^{\infty} e^{-x} dx$')).toBe(true)
    })

    it('should not detect math in regular text', () => {
      expect(hasMath('This is a normal sentence.')).toBe(false)
      expect(hasMath('No math here!')).toBe(false)
      expect(hasMath('Just $ symbol without matching')).toBe(false)
      expect(hasMath('Just $$ symbol without matching')).toBe(false)
    })

    it('should handle multiple math expressions in content', () => {
      expect(hasMath('First: $x^2$, Second: $$y^2$$')).toBe(true)
      expect(hasMath('Multiple: $a$ $b$ $c$')).toBe(true)
    })
  })
})
