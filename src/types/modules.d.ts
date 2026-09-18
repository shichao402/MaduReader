// Module declarations for packages without TypeScript types

declare module 'markdown-it-task-lists' {
  import MarkdownIt from 'markdown-it'
  const fn: (md: MarkdownIt, options?: { enabled?: boolean }) => void
  export default fn
}

declare module 'markdown-it-footnote' {
  import MarkdownIt from 'markdown-it'
  const fn: (md: MarkdownIt) => void
  export default fn
}

declare module 'markdown-it-sub' {
  import MarkdownIt from 'markdown-it'
  const fn: (md: MarkdownIt) => void
  export default fn
}

declare module 'markdown-it-sup' {
  import MarkdownIt from 'markdown-it'
  const fn: (md: MarkdownIt) => void
  export default fn
}

declare module 'markdown-it-abbr' {
  import MarkdownIt from 'markdown-it'
  const fn: (md: MarkdownIt) => void
  export default fn
}

declare module 'markdown-it-ins' {
  import MarkdownIt from 'markdown-it'
  const fn: (md: MarkdownIt) => void
  export default fn
}

declare module 'markdown-it-mark' {
  import MarkdownIt from 'markdown-it'
  const fn: (md: MarkdownIt) => void
  export default fn
}

declare module 'markdownIt-mark' {
  import MarkdownIt from 'markdown-it'
  const fn: (md: MarkdownIt) => void
  export default fn
}

declare module 'dompurify' {
  import { DOMPurify as DOMPurifyType } from 'dompurify'
  export default DOMPurifyType
  export * from 'dompurify'
}

declare module 'highlight.js/lib/languages/*' {
  const language: unknown
  export default language
}
