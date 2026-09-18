import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { createPinia, setActivePinia } from 'pinia'
import App from './App'
import './styles/main.css'
import { getTabStore, getSettingsStore } from './bridge'

console.log('[MaduReader] main.tsx loaded')

// React 环境无 Vue app 实例，手动创建并激活 Pinia
const pinia = createPinia()
setActivePinia(pinia)

const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
console.log('[MaduReader] isTauri:', isTauri)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

console.log('[MaduReader] stores ready:', !!getTabStore(), !!getSettingsStore())
