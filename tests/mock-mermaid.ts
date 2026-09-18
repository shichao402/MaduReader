import { vi } from 'vitest'

const mockRender = vi.fn().mockResolvedValue({
  svg: '<svg id="mermaid-svg" viewBox="0 0 100 100"><rect x="10" y="10" width="80" height="80"/></svg>'
})
const mockInitialize = vi.fn().mockResolvedValue(undefined)

export default {
  initialize: mockInitialize,
  render: mockRender
}
