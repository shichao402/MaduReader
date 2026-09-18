import { describe, it, expect, vi, beforeEach } from 'vitest'

// Use vi.hoisted to ensure mocks are hoisted to the top
const { mockMermaid, mockKatex, mockHljs } = vi.hoisted(() => ({
  mockMermaid: vi.fn().mockResolvedValue({
    initialize: async () => {},
    render: async () => ({ svg: '<svg></svg>' })
  }),
  mockKatex: vi.fn((code: string) => `<span class="katex">${code}</span>`),
  mockHljs: vi.fn().mockResolvedValue({
    getLanguage: (lang: string) => ['javascript', 'typescript', 'python'].includes(lang) ? { name: lang } : null,
    highlight: (code: string) => ({ value: code }),
    utils: { escapeHtml: (s: string) => s }
  })
}))

// Mock mermaid module
vi.mock('mermaid', () => ({
  default: {
    initialize: async () => {},
    render: async () => ({ svg: '<svg></svg>' })
  }
}))

// Mock katex module
vi.mock('katex', () => ({
  renderToString: (code: string) => `<span class="katex">${code}</span>`
}))

// Mock highlight.js
vi.mock('highlight.js', () => ({
  default: {
    getLanguage: (lang: string) => ['javascript', 'typescript', 'python'].includes(lang) ? { name: lang } : null,
    highlight: (code: string) => ({ value: code }),
    utils: { escapeHtml: (s: string) => s }
  }
}))

// Mock markdown-it plugins
vi.mock('markdown-it-task-lists', () => ({ default: (md: any) => md }))
vi.mock('markdown-it-footnote', () => ({ default: (md: any) => md }))
vi.mock('markdown-it-sub', () => ({ default: (md: any) => md }))
vi.mock('markdown-it-sup', () => ({ default: (md: any) => md }))
vi.mock('markdown-it-abbr', () => ({ default: (md: any) => md }))
vi.mock('markdown-it-ins', () => ({ default: (md: any) => md }))
vi.mock('markdown-it-mark', () => ({ default: (md: any) => md }))

// Mock Tauri plugins
vi.mock('@tauri-apps/api', () => ({
  listen: () => {}, listenAll: () => {}, emit: () => {}, open: () => {},
  dialog: { open: () => {}, save: () => {} },
  fs: { readTextFile: () => {}, writeTextFile: () => {}, exists: () => {}, readDir: () => {}, mkdir: () => {}, remove: () => {} }
}))
vi.mock('@tauri-apps/api/core', () => ({ invoke: async () => '/app/data/dir' }))
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: () => {}, save: () => {} }))
vi.mock('@tauri-apps/plugin-fs', () => ({
  default: { readTextFile: async () => '# Test', writeTextFile: () => {}, readDir: async () => [] },
  readTextFile: async () => '# Test', writeTextFile: () => {}, readDir: async () => [],
  exists: () => {}, mkdir: () => {}, remove: () => {}
}))
vi.mock('@tauri-apps/plugin-shell', () => ({ open: () => {} }))

describe('basic test', () => {
  beforeEach(() => {
    // Set up window properties
    ;(window as any).config = {}
    ;(window as any).mermaid = { initialize: async () => {}, render: async () => ({ svg: '' }) }
    ;(window as any).katex = { renderToString: (s: string) => s }

    // Mock matchMedia
    const mockMatchMedia = (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
      removeListener: vi.fn()
    })
    Object.defineProperty(window, 'matchMedia', { value: mockMatchMedia, writable: true })

    // Mock document.dispatchEvent
    const mockDispatchEvent = vi.fn()
    Object.defineProperty(document, 'dispatchEvent', { value: mockDispatchEvent, writable: true })

    vi.clearAllMocks()
  })

  it('should render markdown', async () => {
    const { renderMarkdown } = await import('../../src/composables/useMarkdown')
    const html = renderMarkdown('# Hello')
    expect(html).toContain('h1')
  })

  it('should detect mermaid code', async () => {
    const { isMermaidCode } = await import('../../src/composables/useMermaid')
    expect(isMermaidCode('flowchart TD\n    A --> B')).toBe(true)
    expect(isMermaidCode('```javascript\nconst x = 1;```')).toBe(false)
  })

  it('should get mermaid type', async () => {
    const { getMermaidType } = await import('../../src/composables/useMermaid')
    expect(getMermaidType('flowchart TD')).toBe('flowchart')
    expect(getMermaidType('sequenceDiagram')).toBe('sequenceDiagram')
  })
})
