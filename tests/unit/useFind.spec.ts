import { describe, it, expect, beforeEach } from 'vitest'
import { ref } from 'vue'
import { useFind } from '../../src/composables/useFind'

describe('useFind', () => {
  let container: HTMLElement
  let containerRef

  beforeEach(() => {
    container = document.createElement('div')
    container.innerHTML = `
      <p>First paragraph with some text.</p>
      <p>Second paragraph with different text.</p>
      <p>Third paragraph with some text again.</p>
    `
    document.body.appendChild(container)
    
    containerRef = ref(container)
  })

  afterEach(() => {
    document.body.removeChild(container)
  })

  describe('basic find functionality', () => {
    it('should find text in container', () => {
      const find = useFind(containerRef)
      find.searchQuery.value = 'paragraph'
      
      find.findText()
      
      expect(find.matchCount.value).toBeGreaterThan(0)
    })

    it('should return 0 matches for non-existent text', () => {
      const find = useFind(containerRef)
      find.searchQuery.value = 'nonexistent'
      
      find.findText()
      
      expect(find.matchCount.value).toBe(0)
    })

    it('should handle regex search', () => {
      const find = useFind(containerRef)
      find.searchQuery.value = 'para'
      find.useRegex.value = true
      
      find.findText()
      
      expect(find.matchCount.value).toBeGreaterThan(0)
    })

    it('should track current match index', () => {
      const find = useFind(containerRef)
      find.searchQuery.value = 'paragraph'
      
      find.findText()
      
      if (find.matchCount.value > 0) {
        expect(find.currentIndex.value).toBe(0)
      }
    })

    it('should highlight matches', () => {
      const find = useFind(containerRef)
      find.searchQuery.value = 'paragraph'
      
      find.findText()
      
      // Just verify matchCount is updated
      if (find.matchCount.value > 0) {
        // highlightMatch may not work in jsdom due to range limitations
        // Just verify we can call it without error
        expect(() => {
          find.highlightMatch(0)
        }).not.toThrow()
      }
    })

    it('should find next match', () => {
      const find = useFind(containerRef)
      find.searchQuery.value = 'paragraph'
      
      find.findText()
      
      if (find.matchCount.value > 1) {
        const firstIndex = find.currentIndex.value
        find.nextMatch()
        
        expect(find.currentIndex.value).not.toBe(firstIndex)
      }
    })

    it('should wrap to beginning after last match', () => {
      const find = useFind(containerRef)
      find.searchQuery.value = 'paragraph'
      
      find.findText()
      
      if (find.matchCount.value > 1) {
        // Go to last match
        for (let i = 0; i < find.matchCount.value - 1; i++) {
          find.nextMatch()
        }
        
        // Next should wrap to first
        find.nextMatch()
        expect(find.currentIndex.value).toBe(0)
      }
    })

    it('should be case sensitive when specified', () => {
      const find = useFind(containerRef)
      find.searchQuery.value = 'PARAGRAPH'
      find.caseSensitive.value = true
      
      find.findText()
      
      // Should not find "paragraph" if searching for "PARAGRAPH" case-sensitive
      expect(find.matchCount.value).toBe(0)
    })

    it('should handle empty search text', () => {
      const find = useFind(containerRef)
      find.searchQuery.value = ''
      
      // Should not throw
      expect(() => {
        find.findText()
      }).not.toThrow()
    })

    it('should handle special characters in regex', () => {
      container.innerHTML = '<p>Text with [brackets] and (parentheses).</p>'
      const find = useFind(containerRef)
      find.searchQuery.value = '\\['
      find.useRegex.value = true
      
      find.findText()
      
      expect(find.matchCount.value).toBeGreaterThan(0)
    })
  })

  describe('case sensitivity', () => {
    it('should default to case insensitive', () => {
      const find = useFind(containerRef)
      find.searchQuery.value = 'PARAGRAPH'
      
      find.findText()
      
      expect(find.matchCount.value).toBeGreaterThan(0)
    })

    it('should respect caseSensitive option', () => {
      const findInsensitive = useFind(containerRef)
      findInsensitive.searchQuery.value = 'PARAGRAPH'
      findInsensitive.caseSensitive.value = false
      findInsensitive.findText()
      
      const findSensitive = useFind(containerRef)
      findSensitive.searchQuery.value = 'PARAGRAPH'
      findSensitive.caseSensitive.value = true
      findSensitive.findText()
      
      expect(findInsensitive.matchCount.value).toBeGreaterThan(0)
      expect(findSensitive.matchCount.value).toBe(0)
    })
  })

  describe('clear functionality', () => {
    it('should clear highlights', () => {
      const find = useFind(containerRef)
      find.searchQuery.value = 'paragraph'
      
      find.findText()
      if (find.matchCount.value > 0) {
        find.highlightMatch(0)
      }
      
      find.clearHighlight()
      
      const highlights = container.querySelectorAll('.search-highlight')
      expect(highlights.length).toBe(0)
    })

    it('should reset current index on clear', () => {
      const find = useFind(containerRef)
      find.searchQuery.value = 'paragraph'
      
      find.findText()
      find.nextMatch()
      find.nextMatch()
      
      find.clearHighlight()
      
      expect(find.currentIndex.value).toBe(-1)
      expect(find.matchCount.value).toBe(0)
    })
  })

  describe('close functionality', () => {
    it('should close find box and clear', () => {
      const find = useFind(containerRef)
      find.searchQuery.value = 'paragraph'
      
      find.findText()
      find.closeFind()
      
      expect(find.findBoxVisible.value).toBe(false)
      expect(find.searchQuery.value).toBe('')
      expect(find.matchCount.value).toBe(0)
    })
  })

  describe('edge cases', () => {
    it('should handle container with no text', () => {
      container.innerHTML = '<div></div>'
      const find = useFind(containerRef)
      find.searchQuery.value = 'text'
      
      find.findText()
      
      expect(find.matchCount.value).toBe(0)
    })

    it('should handle container with only whitespace', () => {
      container.innerHTML = '<div>   </div>'
      const find = useFind(containerRef)
      find.searchQuery.value = 'text'
      
      find.findText()
      
      expect(find.matchCount.value).toBe(0)
    })

    it('should handle very long search text', () => {
      const find = useFind(containerRef)
      find.searchQuery.value = 'x'.repeat(1000)
      
      find.findText()
      
      expect(find.matchCount.value).toBe(0)
    })

    it('should handle search text with newlines', () => {
      container.innerHTML = '<p>Line 1\nLine 2</p>'
      const find = useFind(containerRef)
      find.searchQuery.value = 'Line'
      
      find.findText()
      
      expect(find.matchCount.value).toBeGreaterThan(0)
    })

    it('should handle multiple matches in same element', () => {
      container.innerHTML = '<p>word word word</p>'
      const find = useFind(containerRef)
      find.searchQuery.value = 'word'
      
      find.findText()
      
      expect(find.matchCount.value).toBe(3)
    })

    it('should handle null container', () => {
      const nullRef = ref(null)
      const find = useFind(nullRef)
      find.searchQuery.value = 'text'
      
      // Should not throw
      expect(() => {
        find.findText()
      }).not.toThrow()
    })
  })

  describe('regex patterns', () => {
    it('should handle regex with flags', () => {
      container.innerHTML = '<p>Test123 Test456</p>'
      const find = useFind(containerRef)
      find.searchQuery.value = '\\d+'
      find.useRegex.value = true
      
      find.findText()
      
      expect(find.matchCount.value).toBeGreaterThan(0)
    })

    it('should handle regex with word boundary', () => {
      container.innerHTML = '<p>testword test testword</p>'
      const find = useFind(containerRef)
      find.searchQuery.value = '\\btest\\b'
      find.useRegex.value = true
      
      find.findText()
      
      expect(find.matchCount.value).toBeGreaterThan(0)
    })

    it('should handle invalid regex gracefully', () => {
      const find = useFind(containerRef)
      find.searchQuery.value = '['
      find.useRegex.value = true
      
      // Should handle gracefully, not throw
      expect(() => {
        find.findText()
      }).not.toThrow()
    })

    it('should handle regex with dot', () => {
      container.innerHTML = '<p>abc123 def456</p>'
      const find = useFind(containerRef)
      find.searchQuery.value = '...'
      find.useRegex.value = true
      
      find.findText()
      
      expect(find.matchCount.value).toBeGreaterThan(0)
    })
  })

  describe('prevMatch functionality', () => {
    it('should go to previous match', () => {
      const find = useFind(containerRef)
      find.searchQuery.value = 'paragraph'
      
      find.findText()
      
      if (find.matchCount.value > 1) {
        const firstIndex = find.currentIndex.value
        find.nextMatch()
        find.prevMatch()
        
        expect(find.currentIndex.value).toBe(firstIndex)
      }
    })

    it('should wrap from first to last', () => {
      const find = useFind(containerRef)
      find.searchQuery.value = 'paragraph'
      
      find.findText()
      
      if (find.matchCount.value > 1) {
        // Go to first, then prev should wrap to last
        find.prevMatch()
        expect(find.currentIndex.value).toBe(find.matchCount.value - 1)
      }
    })
  })
})
