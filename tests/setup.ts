// Setup file for vitest
// Note: Do not import vitest in this file as it causes issues with the runner detection
// Use vitest globals directly (configured in vitest.config.ts with globals: true)

// Set window.config before any module imports
;(window as any).config = {}
;(window as any).mermaid = { initialize: async () => {}, render: async () => ({ svg: '' }) }
;(window as any).katex = { renderToString: (s: string) => s }
;(window as any).__TAURI_INTERNALS__ = {}

// Mock matchMedia globally for jsdom
const mockMatchMedia = (query: string) => ({
  matches: false,
  media: query,
  onchange: null,
  addEventListener: () => {},
  removeEventListener: () => {},
  dispatchEvent: () => false,
  removeListener: () => {}
})
Object.defineProperty(window, 'matchMedia', { value: mockMatchMedia, writable: true, configurable: true })

// Keep Vitest output small; individual tests can still spy on warn/error when needed.
console.log = () => {}

// Mock document.dispatchEvent
const mockDispatchEvent = () => true
Object.defineProperty(document, 'dispatchEvent', { value: mockDispatchEvent, writable: true, configurable: true })
