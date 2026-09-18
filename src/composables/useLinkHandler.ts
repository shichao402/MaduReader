/**
 * 处理自定义协议超链接
 * 支持 mailto:, tel:, http(s): 等协议
 */
interface LinkHandlerOptions {
  protocols?: string[]  // 允许的协议列表
  confirmCustomProtocol?: boolean  // 是否确认自定义协议
}

const defaultOptions: LinkHandlerOptions = {
  protocols: ['http:', 'https:', 'mailto:', 'tel:'],
  confirmCustomProtocol: true
}

const attachedHandlers = new WeakMap<HTMLElement, EventListener>()

function isTauriRuntime(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}

/**
 * 检查是否是允许的协议
 */
function isAllowedProtocol(url: string, protocols: string[]): boolean {
  const lowerUrl = url.toLowerCase()
  return protocols.some(protocol => lowerUrl.startsWith(protocol))
}

/**
 * 提示用户确认打开外部程序
 */
async function confirmOpenExternal(url: string): Promise<boolean> {
  // 简单的确认对话框
  // 从 URL 中提取协议名称，处理可能的 URL 解析错误
  let protocol = 'unknown'
  try {
    protocol = new URL(url).protocol.replace(':', '')
  } catch {
    // 对于 mailto:, tel: 等协议，URL 构造函数可能抛出异常
    // 直接从 URL 中提取协议
    const match = url.match(/^([a-zA-Z]+):/)
    if (match) {
      protocol = match[1]
    }
  }
  const confirmed = window.confirm(
    `此链接使用自定义协议 "${protocol}"，将尝试用外部程序打开。\n\n链接: ${url}\n\n是否继续？`
  )
  return confirmed
}

/**
 * 打开 URL
 */
export async function openUrl(url: string, options: LinkHandlerOptions = {}): Promise<boolean> {
  const opts = { ...defaultOptions, ...options }
  
  try {
    // 安全检查：URL 必须以协议开头 (protocol:// 或 protocol:)
    // 支持 mailto:test@example.com 和 http://example.com 两种格式
    if (!url.match(/^\w+:/)) {
      console.warn('Invalid URL format:', url)
      return false
    }
    
    // 安全检查：禁止 javascript: 协议
    if (url.toLowerCase().startsWith('javascript:')) {
      console.warn('javascript: URLs are not allowed for security reasons')
      return false
    }
    
    // 检查是否是允许的协议
    if (!isAllowedProtocol(url, opts.protocols!)) {
      // 自定义协议
      if (opts.confirmCustomProtocol && !await confirmOpenExternal(url)) {
        return false
      }
    }
    
    if (isTauriRuntime()) {
      const { open } = await import('@tauri-apps/plugin-shell')
      await open(url)
    } else {
      window.open(url, '_blank', 'noopener,noreferrer')
    }
    return true
  } catch (error) {
    console.error('Failed to open URL:', error)
    return false
  }
}

/**
 * 处理链接点击事件
 */
export function handleLinkClick(e: MouseEvent, options: LinkHandlerOptions = {}): void {
  const target = e.target as HTMLElement
  
  // 查找最近的 <a> 元素
  const link = target.closest('a')
  if (!link) return
  
  const href = link.getAttribute('href')
  if (!href) return
  
  // 如果是锚点链接，正常处理
  if (href.startsWith('#')) return
  
  // 阻止默认行为
  e.preventDefault()
  
  // 异步打开链接
  openUrl(href, options)
}

/**
 * 为元素添加链接点击处理
 */
export function attachLinkHandler(
  element: HTMLElement,
  options: LinkHandlerOptions = {}
): void {
  if (typeof element.removeEventListener === 'function') {
    detachLinkHandler(element)
  }
  const handler = (e: Event) => handleLinkClick(e as MouseEvent, options)
  attachedHandlers.set(element, handler)
  element.addEventListener('click', handler)
}

/**
 * 移除链接点击处理
 */
export function detachLinkHandler(
  element: HTMLElement,
  _options: LinkHandlerOptions = {}
): void {
  if (typeof element.removeEventListener !== 'function') return
  const handler = attachedHandlers.get(element)
  element.removeEventListener('click', handler || (() => {}))
  if (!handler) return
  attachedHandlers.delete(element)
}

/**
 * 从 Markdown HTML 中提取所有链接
 */
export function extractLinks(html: string): string[] {
  const links: string[] = []
  const regex = /href=["']([^"']+)["']/g
  let match
  
  while ((match = regex.exec(html)) !== null) {
    links.push(match[1])
  }
  
  return links
}

/**
 * 检查 HTML 中是否包含外部链接
 */
export function hasExternalLinks(html: string): boolean {
  return /href=["'](https?:\/\/[^"']+)["']/i.test(html)
}
