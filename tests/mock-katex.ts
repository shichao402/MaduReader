// Virtual katex mock module
function renderToString(code: string, _opts?: any) {
  return `<span class="katex">${code.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</span>`
}

export { renderToString }
