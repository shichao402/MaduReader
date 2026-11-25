import { beforeEach, describe, expect, it, vi } from 'vitest'

const { initialize, render } = vi.hoisted(() => ({
  initialize: vi.fn(),
  render: vi.fn(),
}))
vi.mock('mermaid', () => ({ default: { initialize, render } }))

import { renderMermaidCode } from '../../src/composables/useMermaid'
import { renderPlantUmlCode, withPlantUmlTheme } from '../../src/composables/usePlantUml'
import { decorateViewableMedia, mediaPayloadFromEventTarget } from '../../src/lib/mediaView'

describe('diagram palette follows the reader', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    render.mockResolvedValue({ svg: '<svg viewBox="0 0 100 80"><text>readable</text></svg>' })
    document.documentElement.classList.remove('dark')
  })

  it('reconfigures Mermaid and keeps its background with the same SVG in preview', async () => {
    const code = '<pre><code class="language-mermaid">sequenceDiagram\n Alice->>Bob: Hello</code></pre>'
    const light = await renderMermaidCode(code, { dark: false })
    const dark = await renderMermaidCode(code, { dark: true })
    expect(initialize.mock.calls.map(([config]) => config.theme)).toEqual(['default', 'dark'])
    expect(initialize.mock.calls[1][0].themeVariables.background).toBe('#1c1917')
    expect(initialize.mock.calls[1][0].themeVariables.primaryTextColor).toBeUndefined()
    expect(light).toContain('data-diagram-theme="light"')
    expect(dark).toContain('data-diagram-theme="dark"')
    const doc = new DOMParser().parseFromString(decorateViewableMedia(dark), 'text/html')
    const frame = doc.querySelector<HTMLElement>('.media-frame')!
    expect(frame.dataset.diagramTheme).toBe('dark')
    expect(mediaPayloadFromEventTarget(frame)?.diagramTheme).toBe('dark')
  })

  it('serializes concurrent light and dark renders without leaking a global Mermaid theme', async () => {
    const code = '<pre><code class="language-mermaid">flowchart TD\n A-->B</code></pre>'
    await renderMermaidCode(code, { dark: false })
    vi.clearAllMocks()
    await Promise.all([renderMermaidCode(code, { dark: true }), renderMermaidCode(code, { dark: false })])
    expect(initialize.mock.calls.map(([config]) => config.theme)).toEqual(['dark', 'default'])
    expect(render).toHaveBeenCalledTimes(2)
  })

  it('honors an explicit Mermaid palette instead of overriding it with the reader theme', async () => {
    const html = await renderMermaidCode('<pre><code class="language-mermaid">flowchart TD\n A-->B</code></pre>', {
      dark: true, theme: 'forest',
    })
    expect(initialize.mock.lastCall?.[0].theme).toBe('forest')
    expect(html).toContain('data-diagram-theme="light"')
  })

  it('injects a complete dark PlantUML palette while preserving explicit author themes', () => {
    const source = '@startuml\nAlice -> Bob: Hello\n@enduml'
    expect(withPlantUmlTheme(source, true)).toContain('@startuml\n!theme cyborg\nskinparam backgroundColor transparent\n')
    expect(withPlantUmlTheme(source, false)).not.toContain('!theme cyborg')
    expect(withPlantUmlTheme(source, false)).toContain('skinparam backgroundColor transparent')
    const explicit = '@startuml\n!theme plain\nAlice -> Bob\n@enduml'
    expect(withPlantUmlTheme(explicit, true)).toBe(explicit)
    const html = '<pre><code class="language-plantuml">@startuml\nAlice -> Bob\n@enduml</code></pre>'
    const doc = new DOMParser().parseFromString(renderPlantUmlCode(html, 'https://example.org/plantuml', true), 'text/html')
    const figure = doc.querySelector<HTMLElement>('figure')!
    expect(figure.dataset.diagramTheme).toBe('dark')
    expect(figure.querySelector('img')?.getAttribute('src')).toContain('/svg/')
    const wrapped = new DOMParser().parseFromString(decorateViewableMedia(doc.body.innerHTML), 'text/html')
    expect(mediaPayloadFromEventTarget(wrapped.querySelector('figure'))?.diagramTheme).toBe('dark')
  })
})
