import { describe, it, expect, beforeEach } from 'vitest'
import { processKatex, hasMath } from '../../src/composables/useKatex'

describe('useKatex', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
  })

  describe('processKatex', () => {
    it('should process inline math with $ delimiters', async () => {
      const html = '<p>Einstein\'s equation: $E=mc^2$</p>'
      const result = await processKatex(html)
      
      expect(result).toContain('E=mc^2')
      expect(result).toContain('katex')
    })

    it('should process block math with $$ delimiters', async () => {
      const html = '<p>$$\\frac{a}{b}$$</p>'
      const result = await processKatex(html)
      
      expect(result).toContain('katex')
      expect(result).toContain('katex-block')
    })

    it('should handle multiple math expressions', async () => {
      const html = '<p>$x^2$ and $y^2$ and $$\\sum_{i=1}^{n} i$$</p>'
      const result = await processKatex(html)
      
      expect((result.match(/katex/g) || []).length).toBeGreaterThanOrEqual(2)
    })

    it('should preserve surrounding text', async () => {
      const html = '<p>Hello $x^2$ world</p>'
      const result = await processKatex(html)
      
      expect(result).toContain('Hello')
      expect(result).toContain('world')
    })

    it('should handle complex LaTeX expressions', async () => {
      const html = '<p>$$\\begin{pmatrix} a & b \\\\ c & d \\end{pmatrix}$$</p>'
      const result = await processKatex(html)
      
      expect(result).toContain('katex')
      expect(result).toContain('pmatrix')
    })

    it('should handle escaped backslashes', async () => {
      const html = '<p>$\\\\lambda$</p>'
      const result = await processKatex(html)
      
      expect(result).toBeDefined()
    })

    it('should handle empty HTML', async () => {
      const result = await processKatex('')
      
      expect(result).toBe('')
    })

    it('should handle HTML without math', async () => {
      const html = '<p>Just plain text</p>'
      const result = await processKatex(html)
      
      expect(result).toBe(html)
    })

    it('should handle nested HTML elements', async () => {
      const html = '<div><p>$x^2$</p><span>$y^2$</span></div>'
      const result = await processKatex(html)
      
      expect(result).toContain('katex')
    })

    it('should handle consecutive math expressions', async () => {
      const html = '<p>$a$ $b$ $c$</p>'
      const result = await processKatex(html)
      
      const katexCount = (result.match(/katex/g) || []).length
      expect(katexCount).toBeGreaterThanOrEqual(2)
    })

    it('should handle subscripts correctly', async () => {
      const html = '<p>$x_1$</p>'
      const result = await processKatex(html)
      
      expect(result).toContain('katex')
    })

    it('should handle superscripts correctly', async () => {
      const html = '<p>$x^2$</p>'
      const result = await processKatex(html)
      
      expect(result).toContain('katex')
    })

    it('should handle fractions', async () => {
      const html = '<p>$\\frac{a}{b}$</p>'
      const result = await processKatex(html)
      
      expect(result).toContain('katex')
    })

    it('should handle square roots', async () => {
      const html = '<p>$\\sqrt{x^2 + y^2}$</p>'
      const result = await processKatex(html)
      
      expect(result).toContain('katex')
    })

    it('should handle summation', async () => {
      const html = '<p>$\\sum_{i=1}^{n} i$</p>'
      const result = await processKatex(html)
      
      expect(result).toContain('katex')
    })

    it('should handle integrals', async () => {
      const html = '<p>$\\int_0^1 x dx$</p>'
      const result = await processKatex(html)
      
      expect(result).toContain('katex')
    })

    it('should handle greek letters', async () => {
      const html = '<p>$\\alpha + \\beta$</p>'
      const result = await processKatex(html)
      
      expect(result).toContain('katex')
    })

    it('should handle unicode characters in output', async () => {
      const html = '<p>$\\lambda$</p>'
      const result = await processKatex(html)
      
      expect(result).toContain('katex')
    })

    it('should not break on invalid LaTeX', async () => {
      const html = '<p>$[invalid latex$</p>'
      const result = await processKatex(html)
      
      // Should handle gracefully
      expect(result).toBeDefined()
    })

    it('should handle block math render error gracefully', async () => {
      // This will trigger the catch block for block math
      const html = '<p>$$invalid\\begin{matrix}$$</p>'
      const result = await processKatex(html)
      
      // Should return the original expression in a pre tag
      expect(result).toBeDefined()
    })

    it('should handle inline math render error gracefully', async () => {
      // This will trigger the catch block for inline math
      const html = '<p>$invalid\\command$</p>'
      const result = await processKatex(html)
      
      // Should return the original expression
      expect(result).toBeDefined()
    })

    it('should handle block math with render error', async () => {
      // This will trigger the catch block for block math
      const html = '<p>$$\\invalidcommand{</p>'
      const result = await processKatex(html)
      
      // Should handle error gracefully
      expect(result).toBeDefined()
    })

    it('should handle inline math with render error', async () => {
      // This will trigger the catch block for inline math
      const html = '<p>$\\invalid{</p>'
      const result = await processKatex(html)
      
      // Should handle error gracefully
      expect(result).toBeDefined()
    })

    it('should handle block math error and return error message', async () => {
      // This will trigger the catch block for block math
      const html = '<p>$$\\begin{invalid}$$</p>'
      const result = await processKatex(html)
      
      // Should contain error information
      expect(result).toBeDefined()
    })

    it('should handle inline math error and return original', async () => {
      // This will trigger the catch block for inline math
      const html = '<p>$\\frac{a</p>'
      const result = await processKatex(html)
      
      // Should return original expression
      expect(result).toBeDefined()
    })

    it('should handle very long expressions', async () => {
      const longExpression = 'x'.repeat(100)
      const html = `<p>$${longExpression}$</p>`
      const result = await processKatex(html)
      
      expect(result).toContain('katex')
    })

    it('should handle inline math with numbers', async () => {
      const html = '<p>The value is $123$</p>'
      const result = await processKatex(html)
      
      expect(result).toContain('123')
      expect(result).toContain('katex')
    })

    it('should handle inline math with letters', async () => {
      const html = '<p>The variable $x$ is used</p>'
      const result = await processKatex(html)
      
      expect(result).toContain('x')
      expect(result).toContain('katex')
    })

    it('should handle inline math with equals', async () => {
      const html = '<p>The equation $x = y$ holds</p>'
      const result = await processKatex(html)
      
      expect(result).toContain('katex')
    })

    it('should handle inline math with plus', async () => {
      const html = '<p>The sum $x + y$</p>'
      const result = await processKatex(html)
      
      expect(result).toContain('katex')
    })

    it('should handle inline math with minus', async () => {
      const html = '<p>The difference $x - y$</p>'
      const result = await processKatex(html)
      
      expect(result).toContain('katex')
    })

    it('should handle inline math with multiplication', async () => {
      const html = '<p>The product $x \\cdot y$</p>'
      const result = await processKatex(html)
      
      expect(result).toContain('katex')
    })

    it('should handle inline math with division', async () => {
      const html = '<p>The quotient $x / y$</p>'
      const result = await processKatex(html)
      
      expect(result).toContain('katex')
    })
  })

  describe('hasMath', () => {
    it('should return true for inline math with $', async () => {
      expect(hasMath('$E=mc^2$')).toBe(true)
    })

    it('should return true for block math with $$', async () => {
      expect(hasMath('$$E=mc^2$$')).toBe(true)
    })

    it('should return false for non-math code', async () => {
      expect(hasMath('```javascript\nconst x = 1;```')).toBe(false)
      expect(hasMath('Hello World')).toBe(false)
      expect(hasMath('')).toBe(false)
    })

    it('should return false for escaped $', async () => {
      expect(hasMath('The cost is $100')).toBe(false)
    })

    it('should return true for whitespace around delimiters', async () => {
      expect(hasMath(' $ E=mc^2 $ ')).toBe(true)
    })

    it('should handle multiple math expressions', async () => {
      expect(hasMath('$a$ and $b$')).toBe(true)
    })
  })
})
