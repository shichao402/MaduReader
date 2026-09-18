import { ref } from 'vue'

export function useFind(containerRef: { value: HTMLElement | null }) {
  const searchQuery = ref('')
  const caseSensitive = ref(false)
  const useRegex = ref(false)
  const findBoxVisible = ref(false)
  const matchCount = ref(0)
  const currentIndex = ref(-1)
  const matches: HTMLElement[] = []

  function findText(): void {
    findBoxVisible.value = true
    if (!containerRef.value || !searchQuery.value) {
      return
    }

    // 清除之前的高亮
    clearHighlight()

    const container = containerRef.value
    const query = searchQuery.value

    try {
      let regex: RegExp
      if (useRegex.value) {
        regex = caseSensitive.value ? new RegExp(query, 'g') : new RegExp(query, 'gi')
      } else {
        const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        regex = caseSensitive.value ? new RegExp(escaped, 'g') : new RegExp(escaped, 'gi')
      }

      const walker = document.createTreeWalker(
        container,
        NodeFilter.SHOW_TEXT,
        {
          acceptNode: (node) => {
            if (node.parentElement?.tagName === 'SCRIPT' || 
                node.parentElement?.tagName === 'STYLE' ||
                node.parentElement?.tagName === 'NOSCRIPT') {
              return NodeFilter.FILTER_REJECT
            }
            return NodeFilter.FILTER_ACCEPT
          }
        }
      )

      const textNodes: Text[] = []
      let textNode: Text | null
      while ((textNode = walker.nextNode() as Text)) {
        textNodes.push(textNode)
      }

      for (const node of textNodes) {
        const nodeText = node.textContent || ''
        const fragment = document.createDocumentFragment()
        let lastIndex = 0
        let foundInNode = false
        let match

        while ((match = regex.exec(nodeText)) !== null) {
          foundInNode = true
          fragment.appendChild(document.createTextNode(nodeText.slice(lastIndex, match.index)))

          const span = document.createElement('span')
          span.className = 'search-highlight'
          span.textContent = match[0]
          fragment.appendChild(span)
          matches.push(span)

          lastIndex = match.index + match[0].length
          if (match[0].length === 0) {
            regex.lastIndex += 1
          }
        }

        if (foundInNode && node.parentNode) {
          fragment.appendChild(document.createTextNode(nodeText.slice(lastIndex)))
          node.parentNode.replaceChild(fragment, node)
        }
      }

      matchCount.value = matches.length
      currentIndex.value = matches.length > 0 ? 0 : -1

      if (matches.length > 0) {
        highlightMatch(0)
      }

    } catch (e) {
      console.error('Search error:', e)
    }
  }

  function highlightMatch(index: number): void {
    if (index < 0 || index >= matches.length) return

    try {
      matches.forEach(match => match.classList.remove('active'))
      const span = matches[index]
      span.classList.add('active')

      // 滚动到视图
      span.scrollIntoView({ behavior: 'smooth', block: 'center' })

      // 选中
      const selection = window.getSelection()
      selection?.removeAllRanges()
    } catch (e) {
      console.error('Highlight error:', e)
    }
  }

  function clearHighlight(): void {
    // 清除高亮
    document.querySelectorAll('.search-highlight').forEach(el => {
      const text = el.textContent
      const parent = el.parentNode
      if (parent && text) {
        parent.insertBefore(document.createTextNode(text), el)
        parent.removeChild(el)
        parent.normalize()
      }
    })

    matches.length = 0
    matchCount.value = 0
    currentIndex.value = -1
  }

  function nextMatch(): void {
    if (matches.length === 0) return
    currentIndex.value = (currentIndex.value + 1) % matches.length
    highlightMatch(currentIndex.value)
  }

  function prevMatch(): void {
    if (matches.length === 0) return
    currentIndex.value = (currentIndex.value - 1 + matches.length) % matches.length
    highlightMatch(currentIndex.value)
  }

  function closeFind(): void {
    findBoxVisible.value = false
    clearHighlight()
    matches.length = 0
    matchCount.value = 0
    currentIndex.value = -1
    searchQuery.value = ''
  }

  return {
    searchQuery,
    caseSensitive,
    useRegex,
    findBoxVisible,
    matchCount,
    currentIndex,
    findText,
    highlightMatch,
    clearHighlight,
    nextMatch,
    prevMatch,
    closeFind
  }
}
