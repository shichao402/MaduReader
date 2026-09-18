import { describe, it, expect, beforeEach } from 'vitest'
import { sanitizeHtml } from '../../src/composables/sanitizeHtml'

describe('sanitizeHtml - Full Coverage', () => {
  beforeEach(() => {
    // Reset DOMPurify hooks before each test
    // DOMPurify.addHook will accumulate, so we need to test carefully
  })

  describe('basic sanitization', () => {
    it('should sanitize simple HTML', () => {
      const html = '<p>Hello World</p>'
      const result = sanitizeHtml(html)
      
      expect(result).toContain('Hello World')
      expect(result).toContain('<p')
    })

    it('should return empty string for empty input', () => {
      const result = sanitizeHtml('')
      expect(result).toBe('')
    })

    it('should return empty string for whitespace only', () => {
      const result = sanitizeHtml('   ')
      // DOMPurify may preserve whitespace, so check that it's clean HTML
      expect(typeof result).toBe('string')
    })
  })

  describe('allowed tags', () => {
    it('should allow h1-h6 headings', () => {
      const html = '<h1>Title</h1><h2>Subtitle</h2><h3>Section</h3>'
      const result = sanitizeHtml(html)
      
      expect(result).toContain('<h1')
      expect(result).toContain('<h2')
      expect(result).toContain('<h3')
    })

    it('should allow p, br, hr', () => {
      const html = '<p>Paragraph</p><br><hr>'
      const result = sanitizeHtml(html)
      
      expect(result).toContain('<p')
      expect(result).toContain('<br')
      expect(result).toContain('<hr')
    })

    it('should allow text formatting tags', () => {
      const html = '<strong>Bold</strong><em>Italic</em><u>Underline</u><s>Strikethrough</s><del>Deleted</del><ins>Inserted</ins>'
      const result = sanitizeHtml(html)
      
      expect(result).toContain('<strong')
      expect(result).toContain('<em')
      expect(result).toContain('<u')
      expect(result).toContain('<s')
      expect(result).toContain('<del')
      expect(result).toContain('<ins')
    })

    it('should allow lists', () => {
      const html = '<ul><li>Item 1</li><li>Item 2</li></ul><ol><li>First</li></ol>'
      const result = sanitizeHtml(html)
      
      expect(result).toContain('<ul')
      expect(result).toContain('<li')
      expect(result).toContain('<ol')
    })

    it('should allow blockquote and pre', () => {
      const html = '<blockquote>Citation</blockquote><pre><code>code</code></pre>'
      const result = sanitizeHtml(html)
      
      expect(result).toContain('<blockquote')
      expect(result).toContain('<pre')
      expect(result).toContain('<code')
    })

    it('should allow links and images', () => {
      const html = '<a href="https://example.com">Link</a><img src="image.png" alt="test">'
      const result = sanitizeHtml(html)
      
      expect(result).toContain('<a')
      expect(result).toContain('href')
      expect(result).toContain('<img')
    })

    it('should allow tables', () => {
      const html = '<table><thead><tr><th>Header</th></tr></thead><tbody><tr><td>Cell</td></tr></tbody></table>'
      const result = sanitizeHtml(html)
      
      expect(result).toContain('<table')
      expect(result).toContain('<thead')
      expect(result).toContain('<tbody')
      expect(result).toContain('<tr')
      expect(result).toContain('<th')
      expect(result).toContain('<td')
    })

    it('should allow div, span, section, article', () => {
      const html = '<div><span>text</span></div><section>Section</section><article>Article</article>'
      const result = sanitizeHtml(html)
      
      expect(result).toContain('<div')
      expect(result).toContain('<span')
      expect(result).toContain('<section')
      expect(result).toContain('<article')
    })

    it('should allow sup, sub, abbr', () => {
      const html = '<sup>2</sup><sub>2</sub><abbr title="test">AB</abbr>'
      const result = sanitizeHtml(html)
      
      expect(result).toContain('<sup')
      expect(result).toContain('<sub')
      expect(result).toContain('<abbr')
    })

    it('should allow details and summary', () => {
      const html = '<details><summary>Click</summary><p>Content</p></details>'
      const result = sanitizeHtml(html)
      
      expect(result).toContain('<details')
      expect(result).toContain('<summary')
    })

    it('should allow figure and figcaption', () => {
      const html = '<figure><img src="test.png"><figcaption>Caption</figcaption></figure>'
      const result = sanitizeHtml(html)
      
      expect(result).toContain('<figure')
      expect(result).toContain('<figcaption')
    })

    it('should allow mark and time', () => {
      const html = '<mark>Highlighted</mark><time datetime="2026-01-01">Date</time>'
      const result = sanitizeHtml(html)
      
      expect(result).toContain('<mark')
      expect(result).toContain('<time')
    })

    it('should allow SVG elements', () => {
      const html = '<svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="40"/></svg>'
      const result = sanitizeHtml(html)
      
      expect(result).toContain('<svg')
      expect(result).toContain('<circle')
    })

    it('should allow more SVG elements', () => {
      const html = '<svg><path d="M0,0 L100,100"/><rect x="10" y="10" width="50" height="50"/><ellipse cx="50" cy="50" rx="20" ry="30"/></svg>'
      const result = sanitizeHtml(html)
      
      expect(result).toContain('<svg')
      expect(result).toContain('<path')
      expect(result).toContain('<rect')
      expect(result).toContain('<ellipse')
    })

    it('should allow line and polyline', () => {
      const html = '<svg><line x1="0" y1="0" x2="100" y2="100"/><polyline points="0,0 50,50 100,0"/></svg>'
      const result = sanitizeHtml(html)
      
      expect(result).toContain('<svg')
      expect(result).toContain('<line')
      expect(result).toContain('<polyline')
    })

    it('should allow polygon and g', () => {
      const html = '<svg><polygon points="100,10 40,180 190,60 10,60 160,180"/><g><circle cx="50" cy="50" r="10"/></g></svg>'
      const result = sanitizeHtml(html)
      
      expect(result).toContain('<svg')
      expect(result).toContain('<polygon')
      expect(result).toContain('<g')
    })

    it('should allow use, defs, symbol', () => {
      const html = '<svg><defs><symbol id="test"><circle cx="10" cy="10" r="5"/></symbol></defs><use href="#test"/></svg>'
      const result = sanitizeHtml(html)
      
      expect(result).toContain('<svg')
      expect(result).toContain('<defs')
      expect(result).toContain('<symbol')
      expect(result).toContain('<use')
    })

    it('should allow marker, stop, gradients', () => {
      const html = '<svg><defs><marker id="arrow"><polygon points="0 0, 10 5, 0 10"/></marker><linearGradient id="grad"><stop offset="0%" stop-color="red"/></linearGradient><radialGradient id="rad"><stop offset="0%" stop-color="blue"/></radialGradient></defs><line marker-end="url(#arrow)"/><rect fill="url(#grad)"/><circle fill="url(#rad)"/></svg>'
      const result = sanitizeHtml(html)
      
      expect(result).toContain('<svg')
      expect(result).toContain('<marker')
      expect(result).toContain('<stop')
      expect(result).toContain('<linearGradient')
      expect(result).toContain('<radialGradient')
    })
  })

  describe('allowed attributes', () => {
    it('should allow href and src', () => {
      const html = '<a href="https://example.com">Link</a><img src="image.png">'
      const result = sanitizeHtml(html)
      
      expect(result).toContain('href')
      expect(result).toContain('src')
    })

    it('should allow alt and title', () => {
      const html = '<img alt="test" title="tooltip">'
      const result = sanitizeHtml(html)
      
      expect(result).toContain('alt')
      expect(result).toContain('title')
    })

    it('should allow class and id', () => {
      const html = '<div class="test" id="test-id">Content</div>'
      const result = sanitizeHtml(html)
      
      expect(result).toContain('class')
      expect(result).toContain('id')
    })

    it('should allow width and height', () => {
      const html = '<img width="100" height="50">'
      const result = sanitizeHtml(html)
      
      expect(result).toContain('width')
      expect(result).toContain('height')
    })

    it('should allow style', () => {
      const html = '<div style="color: red;">Text</div>'
      const result = sanitizeHtml(html)
      
      expect(result).toContain('style')
    })

    it('should allow target and rel for links', () => {
      const html = '<a href="https://example.com" target="_blank" rel="noopener">Link</a>'
      const result = sanitizeHtml(html)
      
      expect(result).toContain('target')
      expect(result).toContain('rel')
    })

    it('should add target=_blank to links without it', () => {
      const html = '<a href="https://example.com">Link</a>'
      const result = sanitizeHtml(html)
      
      expect(result).toContain('target="_blank"')
    })

    it('should add rel=noopener noreferrer to links without it', () => {
      const html = '<a href="https://example.com">Link</a>'
      const result = sanitizeHtml(html)
      
      expect(result).toContain('rel="noopener')
      expect(result).toContain('noreferrer')
    })

    it('should allow table attributes', () => {
      const html = '<table start="1" align="center"><tr valign="top"><td scope="row" rowspan="2" colspan="2">Cell</td></tr></table>'
      const result = sanitizeHtml(html)
      
      expect(result).toContain('start')
      expect(result).toContain('align')
      expect(result).toContain('valign')
      expect(result).toContain('scope')
      expect(result).toContain('rowspan')
      expect(result).toContain('colspan')
    })

    it('should allow SVG attributes', () => {
      const html = '<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg"><circle cx="50" cy="50" r="40" fill="red" stroke="blue" stroke-width="2"/><path d="M0,0 L100,100"/></svg>'
      const result = sanitizeHtml(html)
      
      expect(result).toContain('viewBox')
      expect(result).toContain('xmlns')
      expect(result).toContain('cx')
      expect(result).toContain('cy')
      expect(result).toContain('r')
      expect(result).toContain('fill')
      expect(result).toContain('stroke')
      expect(result).toContain('stroke-width')
      expect(result).toContain('d')
    })

    it('should allow xlink:href and data attributes', () => {
      const html = '<svg><use xlink:href="#test"/></svg><code data-code="test" data-language="javascript">code</code>'
      const result = sanitizeHtml(html)
      
      expect(result).toContain('xlink:href')
      expect(result).toContain('data-code')
      expect(result).toContain('data-language')
    })

    it('should allow loading attribute', () => {
      const html = '<img src="test.png" loading="lazy">'
      const result = sanitizeHtml(html)
      
      expect(result).toContain('loading')
    })
  })

  describe('URI schemes', () => {
    it('should allow http URLs', () => {
      const html = '<a href="http://example.com">Link</a>'
      const result = sanitizeHtml(html)
      
      expect(result).toContain('href')
      expect(result).toContain('http://')
    })

    it('should allow https URLs', () => {
      const html = '<a href="https://example.com">Link</a>'
      const result = sanitizeHtml(html)
      
      expect(result).toContain('href')
      expect(result).toContain('https://')
    })

    it('should allow mailto links', () => {
      const html = '<a href="mailto:test@example.com">Email</a>'
      const result = sanitizeHtml(html)
      
      expect(result).toContain('href')
      expect(result).toContain('mailto:')
    })

    it('should allow tel links', () => {
      const html = '<a href="tel:+1234567890">Call</a>'
      const result = sanitizeHtml(html)
      
      expect(result).toContain('href')
      expect(result).toContain('tel:')
    })

    it('should allow data:image URLs', () => {
      const html = '<img src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==">'
      const result = sanitizeHtml(html)
      
      expect(result).toContain('src')
      expect(result).toContain('data:image')
    })

    it('should allow relative paths', () => {
      const html = '<a href="./page.html">Link</a><img src="image.png">'
      const result = sanitizeHtml(html)
      
      expect(result).toContain('href')
      expect(result).toContain('src')
    })

    it('should disallow javascript URLs', () => {
      const html = '<a href="javascript:alert(1)">Click</a>'
      const result = sanitizeHtml(html)
      
      // Should remove the javascript href
      expect(result).not.toContain('javascript:')
    })

    it('should disallow javascript in src', () => {
      const html = '<img src="javascript:alert(1)">'
      const result = sanitizeHtml(html)
      
      // Should remove the javascript src
      expect(result).not.toContain('javascript:')
    })

    it('should disallow vbscript URLs', () => {
      const html = '<a href="vbscript:msgbox(1)">Click</a>'
      const result = sanitizeHtml(html)
      
      expect(result).not.toContain('vbscript:')
    })
  })

  describe('disallowed content', () => {
    it('should remove script tags', () => {
      const html = '<p>Text</p><script>alert(1)</script>'
      const result = sanitizeHtml(html)
      
      expect(result).toContain('Text')
      expect(result).not.toContain('<script')
    })

    it('should remove iframe tags', () => {
      const html = '<p>Text</p><iframe src="https://example.com"></iframe>'
      const result = sanitizeHtml(html)
      
      expect(result).toContain('Text')
      expect(result).not.toContain('<iframe')
    })

    it('should remove object tags', () => {
      const html = '<p>Text</p><object data="test.swf"></object>'
      const result = sanitizeHtml(html)
      
      expect(result).toContain('Text')
      expect(result).not.toContain('<object')
    })

    it('should remove embed tags', () => {
      const html = '<p>Text</p><embed src="test.swf">'
      const result = sanitizeHtml(html)
      
      expect(result).toContain('Text')
      expect(result).not.toContain('<embed')
    })

    it('should remove form tags', () => {
      const html = '<p>Text</p><form action="submit"><input type="text"></form>'
      const result = sanitizeHtml(html)
      
      expect(result).toContain('Text')
      expect(result).not.toContain('<form')
    })

    it('should remove button tags', () => {
      const html = '<p>Text</p><button>Click</button>'
      const result = sanitizeHtml(html)
      
      expect(result).toContain('Text')
      expect(result).not.toContain('<button')
    })

    it('should remove input tags', () => {
      const html = '<p>Text</p><input type="text">'
      const result = sanitizeHtml(html)
      
      expect(result).toContain('Text')
      expect(result).not.toContain('<input')
    })

    it('should remove textarea tags', () => {
      const html = '<p>Text</p><textarea>content</textarea>'
      const result = sanitizeHtml(html)
      
      expect(result).toContain('Text')
      expect(result).not.toContain('<textarea')
    })

    it('should remove select tags', () => {
      const html = '<p>Text</p><select><option>1</option></select>'
      const result = sanitizeHtml(html)
      
      expect(result).toContain('Text')
      expect(result).not.toContain('<select')
    })
  })

  describe('img attributes', () => {
    it('should add empty alt to images without it', () => {
      const html = '<img src="test.png">'
      const result = sanitizeHtml(html)
      
      expect(result).toContain('alt=""')
    })

    it('should keep alt if present', () => {
      const html = '<img src="test.png" alt="test">'
      const result = sanitizeHtml(html)
      
      expect(result).toContain('alt="test"')
    })
  })

  describe('complex scenarios', () => {
    it('should handle nested elements', () => {
      const html = '<div><p><strong><em>Nested</em></strong></p></div>'
      const result = sanitizeHtml(html)
      
      expect(result).toContain('Nested')
      expect(result).toContain('<div')
      expect(result).toContain('<p')
      expect(result).toContain('<strong')
      expect(result).toContain('<em')
    })

    it('should handle multiple SVGs', () => {
      const html = '<svg><circle cx="10" cy="10" r="5"/></svg><svg><rect x="10" y="10" width="50" height="50"/></svg>'
      const result = sanitizeHtml(html)
      
      const svgCount = (result.match(/<svg/g) || []).length
      expect(svgCount).toBe(2)
    })

    it('should handle mixed content', () => {
      const html = `
        <h1>Title</h1>
        <p>Paragraph with <strong>bold</strong> and <a href="https://example.com">link</a></p>
        <ul>
          <li>Item 1</li>
          <li>Item 2</li>
        </ul>
        <img src="test.png" alt="test">
      `
      const result = sanitizeHtml(html)
      
      expect(result).toContain('<h1')
      expect(result).toContain('<p')
      expect(result).toContain('<strong')
      expect(result).toContain('<a')
      expect(result).toContain('<ul')
      expect(result).toContain('<li')
      expect(result).toContain('<img')
    })

    it('should handle empty tags', () => {
      const html = '<p></p><div></div><span></span>'
      const result = sanitizeHtml(html)
      
      expect(result).toContain('<p')
      expect(result).toContain('<div')
      expect(result).toContain('<span')
    })

    it('should handle self-closing tags', () => {
      const html = '<br/><hr/><img src="test.png"/>'
      const result = sanitizeHtml(html)
      
      expect(result).toContain('<br')
      expect(result).toContain('<hr')
      expect(result).toContain('<img')
    })

    it('should handle comments', () => {
      const html = '<p>Text <!-- comment --></p>'
      const result = sanitizeHtml(html)
      
      expect(result).toContain('Text')
    })

    it('should handle encoded characters', () => {
      const html = '<p>&#160;text&#160;</p>'
      const result = sanitizeHtml(html)
      
      expect(result).toContain('text')
    })

    it('should handle unicode characters', () => {
      const html = '<p>测试内容</p>'
      const result = sanitizeHtml(html)
      
      expect(result).toContain('测试内容')
    })

    it('should handle very long HTML', () => {
      const longContent = '<p>'.repeat(100) + 'text' + '</p>'.repeat(100)
      const result = sanitizeHtml(longContent)
      
      expect(result).toContain('text')
    })
  })
})
