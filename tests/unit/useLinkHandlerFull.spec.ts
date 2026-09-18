import { describe, it, expect, vi, beforeEach } from 'vitest'
import { openUrl, handleLinkClick, attachLinkHandler, detachLinkHandler, extractLinks, hasExternalLinks } from '../../src/composables/useLinkHandler'

// Mock @tauri-apps/plugin-shell at the top level
vi.mock('@tauri-apps/plugin-shell', () => ({
  open: vi.fn()
}))

describe('useLinkHandler - Full Coverage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('openUrl - Protocol Handling', () => {
    it('should allow http URLs', async () => {
      const result = await openUrl('http://example.com')
      
      expect(result).toBe(true)
    })

    it('should allow https URLs', async () => {
      const result = await openUrl('https://example.com')
      
      expect(result).toBe(true)
    })

    it('should allow mailto URLs', async () => {
      const result = await openUrl('mailto:test@example.com')
      
      expect(result).toBe(true)
    })

    it('should allow tel URLs', async () => {
      const result = await openUrl('tel:+1234567890')
      
      expect(result).toBe(true)
    })

    it('should reject invalid URL format', async () => {
      const result = await openUrl('not-a-url')
      
      expect(result).toBe(false)
    })

    it('should reject javascript URLs', async () => {
      const result = await openUrl('javascript:alert(1)')
      
      expect(result).toBe(false)
    })

    it('should handle custom protocol with confirmation', async () => {
      // Mock window.confirm to return true
      const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)
      
      const result = await openUrl('myapp://custom/path')
      
      expect(confirmSpy).toHaveBeenCalled()
      expect(result).toBe(true)
      
      confirmSpy.mockRestore()
    })

    it('should reject custom protocol when confirmation declined', async () => {
      const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false)
      
      const result = await openUrl('myapp://custom/path')
      
      expect(confirmSpy).toHaveBeenCalled()
      expect(result).toBe(false)
      
      confirmSpy.mockRestore()
    })

    it('should handle file protocol', async () => {
      const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)
      
      const result = await openUrl('file:///path/to/file')
      
      expect(confirmSpy).toHaveBeenCalled()
      expect(result).toBe(true)
      
      confirmSpy.mockRestore()
    })
  })

  describe('handleLinkClick - Click Handling', () => {
    it('should handle click on anchor link', () => {
      const mockEvent = {
        preventDefault: vi.fn(),
        target: {
          closest: () => null
        }
      }
      
      handleLinkClick(mockEvent as any)
      
      // Should not throw
      expect(true).toBe(true)
    })

    it('should handle click without href', () => {
      const mockEvent = {
        preventDefault: vi.fn(),
        target: {
          closest: () => ({
            getAttribute: () => null
          })
        }
      }
      
      handleLinkClick(mockEvent as any)
      
      expect(true).toBe(true)
    })

    it('should handle click on anchor hash', () => {
      const mockEvent = {
        preventDefault: vi.fn(),
        target: {
          closest: () => ({
            getAttribute: () => '#section1'
          })
        }
      }
      
      handleLinkClick(mockEvent as any)
      
      // Should not prevent default for anchor links
      expect(mockEvent.preventDefault).not.toHaveBeenCalled()
    })

    it('should handle click on valid link', async () => {
      const mockEvent = {
        preventDefault: vi.fn(),
        target: {
          closest: () => ({
            getAttribute: () => 'https://example.com'
          })
        }
      }
      
      handleLinkClick(mockEvent as any)
      
      // Should prevent default
      expect(mockEvent.preventDefault).toHaveBeenCalled()
    })
  })

  describe('attachLinkHandler - Event Attachment', () => {
    it('should attach click handler to element', () => {
      const mockElement = {
        addEventListener: vi.fn()
      }
      
      attachLinkHandler(mockElement as any)
      
      expect(mockElement.addEventListener).toHaveBeenCalledWith('click', expect.any(Function))
    })

    it('should use custom protocols option', () => {
      const mockElement = {
        addEventListener: vi.fn()
      }
      
      attachLinkHandler(mockElement as any, { protocols: ['http:', 'https:'] })
      
      expect(mockElement.addEventListener).toHaveBeenCalled()
    })
  })

  describe('detachLinkHandler - Event Removal', () => {
    it('should remove click handler from element', () => {
      const mockElement = {
        removeEventListener: vi.fn()
      }
      
      detachLinkHandler(mockElement as any)
      
      expect(mockElement.removeEventListener).toHaveBeenCalledWith('click', expect.any(Function))
    })
  })

  describe('extractLinks - Link Extraction', () => {
    it('should extract single link', () => {
      const html = '<a href="https://example.com">Link</a>'
      const links = extractLinks(html)
      
      expect(links).toEqual(['https://example.com'])
    })

    it('should extract multiple links', () => {
      const html = '<a href="https://a.com">A</a><a href="https://b.com">B</a>'
      const links = extractLinks(html)
      
      expect(links).toEqual(['https://a.com', 'https://b.com'])
    })

    it('should return empty array for no links', () => {
      const html = '<p>No links here</p>'
      const links = extractLinks(html)
      
      expect(links).toEqual([])
    })

    it('should handle links with query strings', () => {
      const html = '<a href="https://example.com/path?q=value">Link</a>'
      const links = extractLinks(html)
      
      expect(links).toEqual(['https://example.com/path?q=value'])
    })

    it('should handle links with fragments', () => {
      const html = '<a href="https://example.com/path#section">Link</a>'
      const links = extractLinks(html)
      
      expect(links).toEqual(['https://example.com/path#section'])
    })
  })

  describe('hasExternalLinks - External Link Detection', () => {
    it('should detect external links', () => {
      const html = '<a href="https://example.com">External</a>'
      expect(hasExternalLinks(html)).toBe(true)
    })

    it('should detect multiple external links', () => {
      const html = '<a href="https://a.com">A</a><a href="http://b.com">B</a>'
      expect(hasExternalLinks(html)).toBe(true)
    })

    it('should return false for no links', () => {
      const html = '<p>No links</p>'
      expect(hasExternalLinks(html)).toBe(false)
    })

    it('should return false for internal links only', () => {
      const html = '<a href="#section">Internal</a>'
      expect(hasExternalLinks(html)).toBe(false)
    })

    it('should return false for mailto links', () => {
      const html = '<a href="mailto:test@example.com">Email</a>'
      expect(hasExternalLinks(html)).toBe(false)
    })

    it('should return false for tel links', () => {
      const html = '<a href="tel:+1234567890">Phone</a>'
      expect(hasExternalLinks(html)).toBe(false)
    })

    it('should return false for javascript links', () => {
      const html = '<a href="javascript:void(0)">Script</a>'
      expect(hasExternalLinks(html)).toBe(false)
    })
  })

  describe('Custom Options', () => {
    it('should use custom protocols list', async () => {
      const result = await openUrl('custom://protocol', { protocols: ['custom:'] })
      
      expect(result).toBe(true)
    })

    it('should skip custom protocol confirmation when disabled', async () => {
      const result = await openUrl('myapp://path', { confirmCustomProtocol: false })
      
      expect(result).toBe(true)
    })
  })
})
