import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './styles/main.css'
import './styles/tokens.css'
import { getTabStore, getSettingsStore } from './bridge'

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

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

console.log('[MaduReader] stores ready:', !!getTabStore(), !!getSettingsStore())

// 挂载成功后让 React App 自己恢复标题
requestAnimationFrame(() => {
  requestAnimationFrame(() => {
    if (document.title.includes('[booting') || document.title.includes('[JS ERROR') || document.title.includes('[PROMISE')) {
      document.title = 'Ma读'
    }
  })
})
