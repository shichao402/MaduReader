// Virtual highlight.js mock module
const commonLangs = ['javascript', 'typescript', 'python', 'java', 'go', 'rust', 'c', 'cpp', 'csharp', 'ruby', 'php', 'sql', 'shell', 'bash', 'html', 'css', 'scss', 'json', 'yaml', 'xml', 'markdown', 'kotlin', 'swift']

function getLanguage(lang: string) {
  return commonLangs.includes(lang) ? { name: lang } : null
}

function highlight(code: string, _opts: { language: string }) {
  return {
    value: `<span class="hljs">${code.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</span>`
  }
}

export default {
  getLanguage,
  highlight,
  utils: {
    escapeHtml: (str: string) => str
  }
}
