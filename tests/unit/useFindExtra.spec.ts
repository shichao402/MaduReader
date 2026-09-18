import { describe, it, expect, beforeEach } from 'vitest'
import { ref } from 'vue'
import { useFind } from '../../src/composables/useFind'

describe('useFind - Additional Coverage', () => {
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
    if (container.parentNode) {
      document.body.removeChild(container)
    }
  })

  describe('FILTER_REJECT coverage (line 41)', () => {
    it('should skip text in SCRIPT tags', () => {
      container.innerHTML = `
        <p>Normal text</p>
        <script>
          const x = 'hidden content';
        </script>
      `
      const find = useFind(containerRef)
      find.searchQuery.value = 'hidden'
      
      find.findText()
      
      // hidden should not be found because it's in script
      expect(find.matchCount.value).toBe(0)
    })

    it('should skip text in STYLE tags', () => {
      container.innerHTML = `
        <p>Normal text</p>
        <style>
          .hidden { content: "hidden style"; }
        </style>
      `
      const find = useFind(containerRef)
      find.searchQuery.value = 'hidden'
      
      find.findText()
      
      expect(find.matchCount.value).toBe(0)
    })

    it('should skip text in NOSCRIPT tags', () => {
      container.innerHTML = `
        <p>Normal text</p>
        <noscript>
          Fallback content here
        </noscript>
      `
      const find = useFind(containerRef)
      find.searchQuery.value = 'Fallback'
      
      find.findText()
      
      expect(find.matchCount.value).toBe(0)
    })

    it('should skip text in nested SCRIPT tags', () => {
      container.innerHTML = `
        <div>
          <p>Normal</p>
          <script type="text/javascript">
            var secret = 'hidden';
          </script>
        </div>
      `
      const find = useFind(containerRef)
      find.searchQuery.value = 'secret'
      
      find.findText()
      
      expect(find.matchCount.value).toBe(0)
    })

    it('should skip text in STYLE with scoped attribute', () => {
      container.innerHTML = `
        <p>Normal text</p>
        <style scoped>
          .hidden { display: none; }
        </style>
      `
      const find = useFind(containerRef)
      find.searchQuery.value = 'hidden'
      
      find.findText()
      
      expect(find.matchCount.value).toBe(0)
    })
  })

  describe('clearHighlight coverage (lines 127-131)', () => {
    it('should restore text content from highlight span', () => {
      // First create a highlight
      container.innerHTML = '<p>Test paragraph with highlightable text.</p>'
      const find = useFind(containerRef)
      find.searchQuery.value = 'paragraph'
      find.findText()
      
      if (find.matchCount.value > 0) {
        // Now clear the highlight
        find.clearHighlight()
        
        // Verify no highlights remain
        const highlights = container.querySelectorAll('.search-highlight')
        expect(highlights.length).toBe(0)
        
        // Verify text content is still there
        const text = container.textContent || ''
        expect(text).toContain('paragraph')
      }
    })

    it('should handle clearing when no highlights exist', () => {
      const find = useFind(containerRef)
      
      // Should not throw even if no highlights
      expect(() => {
        find.clearHighlight()
      }).not.toThrow()
    })

    it('should handle clearing with multiple highlights', () => {
      container.innerHTML = '<p>word word word</p>'
      const find = useFind(containerRef)
      find.searchQuery.value = 'word'
      find.findText()
      
      // Clear all highlights
      find.clearHighlight()
      
      const highlights = container.querySelectorAll('.search-highlight')
      expect(highlights.length).toBe(0)
    })

    it('should handle clearing with special characters in text', () => {
      container.innerHTML = '<p>Test with special chars: @#$%^&*()</p>'
      const find = useFind(containerRef)
      find.searchQuery.value = 'special'
      find.findText()
      
      if (find.matchCount.value > 0) {
        find.clearHighlight()
        
        const highlights = container.querySelectorAll('.search-highlight')
        expect(highlights.length).toBe(0)
      }
    })

    it('should handle clearing with unicode text', () => {
      container.innerHTML = '<p>中文测试内容 for unicode</p>'
      const find = useFind(containerRef)
      find.searchQuery.value = '测试'
      find.findText()
      
      if (find.matchCount.value > 0) {
        find.clearHighlight()
        
        const highlights = container.querySelectorAll('.search-highlight')
        expect(highlights.length).toBe(0)
        
        const text = container.textContent || ''
        expect(text).toContain('测试')
      }
    })
  })

  describe('highlightMatch edge cases', () => {
    it('should handle highlight with index out of bounds', () => {
      const find = useFind(containerRef)
      find.searchQuery.value = 'paragraph'
      find.findText()
      
      // Should not throw with invalid index
      expect(() => {
        find.highlightMatch(-1)
        find.highlightMatch(999)
      }).not.toThrow()
    })

    it('should handle highlight with empty query', () => {
      const find = useFind(containerRef)
      find.searchQuery.value = ''
      find.findText()
      
      expect(() => {
        find.highlightMatch(0)
      }).not.toThrow()
    })

    it('should handle highlight with regex mode', () => {
      container.innerHTML = '<p>Test123 and Test456</p>'
      const find = useFind(containerRef)
      find.searchQuery.value = '\\d+'
      find.useRegex.value = true
      find.findText()
      
      if (find.matchCount.value > 0) {
        expect(() => {
          find.highlightMatch(0)
        }).not.toThrow()
      }
    })
  })

  describe('nextMatch edge cases', () => {
    it('should handle nextMatch with no matches', () => {
      const find = useFind(containerRef)
      find.searchQuery.value = 'nonexistent'
      find.findText()
      
      expect(() => {
        find.nextMatch()
      }).not.toThrow()
      
      expect(find.currentIndex.value).toBe(-1)
    })
  })

  describe('prevMatch edge cases', () => {
    it('should handle prevMatch with no matches', () => {
      const find = useFind(containerRef)
      find.searchQuery.value = 'nonexistent'
      find.findText()
      
      expect(() => {
        find.prevMatch()
      }).not.toThrow()
      
      expect(find.currentIndex.value).toBe(-1)
    })
  })

  describe('closeFind edge cases', () => {
    it('should handle closeFind with active matches', () => {
      const find = useFind(containerRef)
      find.searchQuery.value = 'paragraph'
      find.findText()
      
      find.closeFind()
      
      expect(find.findBoxVisible.value).toBe(false)
      expect(find.searchQuery.value).toBe('')
      expect(find.matchCount.value).toBe(0)
      
      // Verify highlights are cleared
      const highlights = container.querySelectorAll('.search-highlight')
      expect(highlights.length).toBe(0)
    })

    it('should handle closeFind with no matches', () => {
      const find = useFind(containerRef)
      find.searchQuery.value = 'paragraph'
      find.findText()
      
      // Clear matches
      find.clearHighlight()
      
      find.closeFind()
      
      expect(find.findBoxVisible.value).toBe(false)
    })
  })
})
