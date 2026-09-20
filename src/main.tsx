import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './styles/main.css'
import './styles/tokens.css'
import { getTabStore, getSettingsStore } from './bridge'
import { perfLog } from './lib/perfLog'

const t0 = performance.now()

console.log('[MaduReader] main.tsx loaded')

// release 空窗口排障钩子: 捕获致命错误写入窗口标题, React 挂载成功后恢复
document.title = 'Ma读 [booting...]'
window.addEventListener('error', (e) => {
  document.title = `Ma读 [JS ERROR] ${e.message}`.slice(0, 120)
})
window.addEventListener('unhandledrejection', (e) => {
  document.title = `Ma读 [PROMISE] ${String(e.reason)}`.slice(0, 120)
})

const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
console.log('[MaduReader] isTauri:', isTauri)

// 接入 tauri-plugin-log：日志落盘（LogDir/madureader.log），前端致命错误也写入
if (isTauri) {
  void (async () => {
    try {
      const log = await import('@tauri-apps/plugin-log')
      await log.attachConsole()
      await log.info('[MaduReader] log plugin attached')
      window.addEventListener('error', (e) => {
        void log.error(`[window.onerror] ${e.message} @ ${e.filename}:${e.lineno}`)
      })
      window.addEventListener('unhandledrejection', (e) => {
        void log.error(`[unhandledrejection] ${String(e.reason)}`)
      })
    } catch (e) {
      console.error('[MaduReader] log plugin init failed:', e)
    }
  })()
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

void perfLog(`frontend: react render() called at +${(performance.now() - t0).toFixed(0)}ms`)

console.log('[MaduReader] stores ready:', !!getTabStore(), !!getSettingsStore())

// 挂载成功后让 React App 自己恢复标题
requestAnimationFrame(() => {
  requestAnimationFrame(() => {
    if (document.title.includes('[booting') || document.title.includes('[JS ERROR') || document.title.includes('[PROMISE')) {
      document.title = 'Ma读'
    }
    void perfLog(`frontend: first paint (double rAF) at +${(performance.now() - t0).toFixed(0)}ms`)
  })
})
