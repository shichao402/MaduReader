import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  openUrl,
  extractLinks,
  hasExternalLinks
} from '../../src/composables/useLinkHandler'

// Mock @tauri-apps/plugin-shell
vi.mock('@tauri-apps/plugin-shell', () => ({
  open: vi.fn().mockResolvedValue(undefined)
}))

describe('useLinkHandler', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('openUrl', () => {
    it('should open http URL', async () => {
      const { open } = await import('@tauri-apps/plugin-shell')
      
      const result = await openUrl('https://example.com')
      
      expect(open).toHaveBeenCalledWith('https://example.com')
      expect(result).toBe(true)
    })

    it('should open https URL', async () => {
      const { open } = await import('@tauri-apps/plugin-shell')
      
      const result = await openUrl('http://example.com')
      
      expect(open).toHaveBeenCalledWith('http://example.com')
      expect(result).toBe(true)
    })

    it('should open mailto URL', async () => {
      const { open } = await import('@tauri-apps/plugin-shell')
      
      const result = await openUrl('mailto://test@example.com')
      
      expect(open).toHaveBeenCalledWith('mailto://test@example.com')
      expect(result).toBe(true)
    })

    it('should open tel URL', async () => {
      const { open } = await import('@tauri-apps/plugin-shell')
      
      const result = await openUrl('tel://+1234567890')
      
      expect(open).toHaveBeenCalledWith('tel://+1234567890')
      expect(result).toBe(true)
    })

    it('should reject invalid URL format', async () => {
      const result = await openUrl('not-a-url')
      
      expect(result).toBe(false)
    })

    it('should reject URL without protocol', async () => {
      const result = await openUrl('example.com')
      
      expect(result).toBe(false)
    })

    it('should handle open error gracefully', async () => {
      const { open } = await import('@tauri-apps/plugin-shell')
      open.mockRejectedValueOnce(new Error('Open failed'))
      
      const result = await openUrl('https://example.com')
      
      expect(result).toBe(false)
    })

    it('should handle URL with query parameters', async () => {
      const { open } = await import('@tauri-apps/plugin-shell')
      
      const result = await openUrl('https://example.com/path?query=value')
      
      expect(open).toHaveBeenCalledWith('https://example.com/path?query=value')
      expect(result).toBe(true)
    })

    it('should handle URL with path', async () => {
      const { open } = await import('@tauri-apps/plugin-shell')
      
      const result = await openUrl('https://example.com/path/to/resource')
      
      expect(open).toHaveBeenCalledWith('https://example.com/path/to/resource')
      expect(result).toBe(true)
    })

    it('should confirm before opening custom protocol', async () => {
      const mockConfirm = vi.fn(() => true)
      Object.defineProperty(window, 'confirm', { value: mockConfirm, writable: true })
      
      const result = await openUrl('myapp://custom')
      
      expect(mockConfirm).toHaveBeenCalled()
      expect(result).toBe(true)
    })

    it('should not open custom protocol if user cancels', async () => {
      const mockConfirm = vi.fn(() => false)
      Object.defineProperty(window, 'confirm', { value: mockConfirm, writable: true })
      
      const result = await openUrl('myapp://custom')
      
      expect(mockConfirm).toHaveBeenCalled()
      expect(result).toBe(false)
    })
  })

  describe('extractLinks', () => {
    it('should extract single link', () => {
      const html = '<a href="https://example.com">Example</a>'
      const links = extractLinks(html)
      
      expect(links).toEqual(['https://example.com'])
    })

    it('should extract multiple links', () => {
      const html = `
        <a href="https://example.com">Example</a>
        <a href="https://test.com">Test</a>
      `
      const links = extractLinks(html)
      
      expect(links).toEqual(['https://example.com', 'https://test.com'])
    })

    it('should handle empty HTML', () => {
      const links = extractLinks('')
      
      expect(links).toEqual([])
    })

    it('should handle no links', () => {
      const links = extractLinks('<p>No links here</p>')
      
      expect(links).toEqual([])
    })

    it('should handle mixed content', () => {
      const html = `
        <p>Some text</p>
        <a href="https://example.com">Link</a>
        <div>More text</div>
        <a href="https://test.com">Another link</a>
      `
      const links = extractLinks(html)
      
      expect(links).toEqual(['https://example.com', 'https://test.com'])
    })

    it('should handle links with other attributes', () => {
      const html = '<a href="https://example.com" class="btn" target="_blank">Link</a>'
      const links = extractLinks(html)
      
      expect(links).toEqual(['https://example.com'])
    })
  })

  describe('hasExternalLinks', () => {
    it('should return true for HTML with http link', () => {
      const html = '<a href="https://example.com">Link</a>'
      
      expect(hasExternalLinks(html)).toBe(true)
    })

    it('should return true for HTML with https link', () => {
      const html = '<a href="http://example.com">Link</a>'
      
      expect(hasExternalLinks(html)).toBe(true)
    })

    it('should return false for HTML without external links', () => {
      const html = '<p>No external links</p>'
      
      expect(hasExternalLinks(html)).toBe(false)
    })

    it('should return false for empty HTML', () => {
      expect(hasExternalLinks('')).toBe(false)
    })

    it('should return false for mailto links', () => {
      const html = '<a href="mailto:test@example.com">Email</a>'
      
      expect(hasExternalLinks(html)).toBe(false)
    })

    it('should return true for mixed links with http', () => {
      const html = `
        <a href="mailto:test@example.com">Email</a>
        <a href="https://example.com">Website</a>
      `
      
      expect(hasExternalLinks(html)).toBe(true)
    })
  })
})
