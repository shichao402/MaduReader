import { createApp } from 'vue'
import { createPinia } from 'pinia'
import TauriApp from './App.vue'
import './styles/main.css'

console.log('[MDReader] main.ts loaded')
console.log('[MDReader] Tauri check:', typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window)

const app = createApp(TauriApp)
app.use(createPinia())
console.log('[MDReader] App created, mounting...')
app.mount('#app')
console.log('[MDReader] App mounted successfully')
