<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount } from 'vue'
import { useSettingsStore } from '../stores/settings'

const settingsStore = useSettingsStore()

const dialogVisible = ref(false)

// 主题选项
const themeOptions = [
  { value: 'light', label: '亮色' },
  { value: 'dark', label: '暗色' },
  { value: 'system', label: '跟随系统' }
]

// 代码主题选项
const codeThemeOptions = [
  { value: 'github', label: 'GitHub' },
  { value: 'atom-one-dark', label: 'Atom One Dark' },
  { value: 'monokai', label: 'Monokai' },
  { value: 'solarized-dark', label: 'Solarized Dark' },
  { value: 'solarized-light', label: 'Solarized Light' },
  { value: 'vs2015', label: 'Visual Studio' },
  { value: 'xcode', label: 'Xcode' }
]

// 字体大小选项
const fontSizeOptions = [
  { value: 12, label: '12px - 小' },
  { value: 14, label: '14px - 较小' },
  { value: 16, label: '16px - 中等' },
  { value: 18, label: '18px - 较大' },
  { value: 20, label: '20px - 大' }
]

// 缩放选项
const zoomOptions = [
  { value: 50, label: '50%' },
  { value: 75, label: '75%' },
  { value: 100, label: '100%' },
  { value: 125, label: '125%' },
  { value: 150, label: '150%' },
  { value: 200, label: '200%' }
]

// Mermaid 主题选项
const mermaidThemeOptions = [
  { value: 'default', label: '默认' },
  { value: 'base', label: '基础' },
  { value: 'dark', label: '暗色' },
  { value: 'forest', label: '森林' },
  { value: 'neutral', label: '中性' }
]

// 保存设置
function saveSettings() {
  settingsStore.applyTheme()
  settingsStore.saveSettings()
}

// 重置为默认值
function resetToDefaults() {
  if (confirm('确定要重置所有设置为默认值吗？')) {
    settingsStore.settings = {
      theme: 'light',
      fontSize: 16,
      zoom: 100,
      sidebarCollapsed: false,
      sidebarPosition: 'left',
      sidebarView: 'tree',
      codeHighlightTheme: 'github',
      showLineNumbers: false,
      autoSave: false,
      mermaidConfig: {
        theme: 'default',
        securityLevel: 'loose',
        startOnLoad: true
      },
      plantUmlServer: 'https://www.plantuml.com/plantuml',
      proxyEnabled: false,
      proxyServer: ''
    }
    settingsStore.applyTheme()
    saveSettings()
  }
}

// 导出设置
function exportSettings() {
  const data = JSON.stringify(settingsStore.settings, null, 2)
  const blob = new Blob([data], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = 'mdreader-settings.json'
  a.click()
  URL.revokeObjectURL(url)
}

// 导入设置
function importSettings() {
  const input = document.createElement('input')
  input.type = 'file'
  input.accept = '.json'
  input.onchange = (e: Event) => {
    const file = (e.target as HTMLInputElement).files?.[0]
    if (!file) return
    
    const reader = new FileReader()
    reader.onload = (e) => {
      try {
        const data = JSON.parse(e.target?.result as string)
        settingsStore.settings = { ...settingsStore.settings, ...data }
        settingsStore.applyTheme()
        saveSettings()
        alert('设置导入成功')
      } catch {
        alert('导入失败：文件格式不正确')
      }
    }
    reader.readAsText(file)
  }
  input.click()
}

// 打开设置
function openSettings() {
  dialogVisible.value = true
}

onMounted(() => {
  // 监听打开设置事件
  document.addEventListener('open-settings', openSettings)
})

onBeforeUnmount(() => {
  document.removeEventListener('open-settings', openSettings)
})
</script>

<template>
  <div v-if="dialogVisible" class="modal-overlay" @click="dialogVisible = false">
    <div class="modal-content" @click.stop>
      <div class="modal-header">
        <h2>设置</h2>
        <button class="close-btn" @click="dialogVisible = false">×</button>
      </div>
      
      <div class="modal-body">
        <div class="settings-section">
          <h3>通用设置</h3>
          <div class="setting-item">
            <label>主题模式</label>
            <select v-model="settingsStore.settings.theme" @change="saveSettings">
              <option v-for="opt in themeOptions" :key="opt.value" :value="opt.value">
                {{ opt.label }}
              </option>
            </select>
          </div>
          <div class="setting-item">
            <label>字体大小</label>
            <select v-model="settingsStore.settings.fontSize" @change="saveSettings">
              <option v-for="opt in fontSizeOptions" :key="opt.value" :value="opt.value">
                {{ opt.label }}
              </option>
            </select>
          </div>
          <div class="setting-item">
            <label>默认缩放</label>
            <select v-model="settingsStore.settings.zoom" @change="saveSettings">
              <option v-for="opt in zoomOptions" :key="opt.value" :value="opt.value">
                {{ opt.label }}
              </option>
            </select>
          </div>
        </div>
        
        <div class="settings-section">
          <h3>外观设置</h3>
          <div class="setting-item">
            <label>代码高亮主题</label>
            <select v-model="settingsStore.settings.codeHighlightTheme" @change="saveSettings">
              <option v-for="opt in codeThemeOptions" :key="opt.value" :value="opt.value">
                {{ opt.label }}
              </option>
            </select>
          </div>
          <div class="setting-item">
            <label class="checkbox-label">
              <input type="checkbox" v-model="settingsStore.settings.showLineNumbers" @change="saveSettings" />
              显示代码行号
            </label>
          </div>
        </div>
        
        <div class="settings-section">
          <h3>图表设置</h3>
          <div class="setting-item">
            <label>Mermaid 主题</label>
            <select v-model="settingsStore.settings.mermaidConfig.theme" @change="saveSettings">
              <option v-for="opt in mermaidThemeOptions" :key="opt.value" :value="opt.value">
                {{ opt.label }}
              </option>
            </select>
          </div>
          <div class="setting-item">
            <label>PlantUML 服务器</label>
            <input 
              type="text" 
              v-model="settingsStore.settings.plantUmlServer" 
              @change="saveSettings"
              placeholder="https://www.plantuml.com/plantuml"
            />
          </div>
        </div>
        
        <div class="settings-section">
          <h3>代理设置</h3>
          <div class="setting-item">
            <label class="checkbox-label">
              <input type="checkbox" v-model="settingsStore.settings.proxyEnabled" @change="saveSettings" />
              启用代理
            </label>
          </div>
          <div class="setting-item" v-if="settingsStore.settings.proxyEnabled">
            <label>代理服务器</label>
            <input 
              type="text" 
              v-model="settingsStore.settings.proxyServer" 
              @change="saveSettings"
              placeholder="http://proxy.example.com:8080"
            />
          </div>
        </div>
        
        <div class="settings-actions">
          <button class="btn btn-primary" @click="saveSettings">保存设置</button>
          <button class="btn btn-secondary" @click="resetToDefaults">重置为默认</button>
          <button class="btn btn-secondary" @click="exportSettings">导出设置</button>
          <button class="btn btn-secondary" @click="importSettings">导入设置</button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.modal-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 10000;
}

.modal-content {
  background: var(--bg-primary);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-xl);
  width: 90%;
  max-width: 600px;
  max-height: 80vh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.modal-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 16px 20px;
  border-bottom: 1px solid var(--border-color);
  background: var(--sidebar-header-bg);
}

.modal-header h2 {
  font-size: 18px;
  font-weight: 600;
  color: var(--text-primary);
}

.close-btn {
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: none;
  border-radius: var(--radius-md);
  cursor: pointer;
  font-size: 24px;
  color: var(--text-secondary);
  transition: all var(--transition-fast);
}

.close-btn:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}

.modal-body {
  padding: 20px;
  overflow-y: auto;
}

.settings-section {
  margin-bottom: 24px;
}

.settings-section h3 {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-secondary);
  margin-bottom: 12px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.setting-item {
  margin-bottom: 12px;
}

.setting-item label {
  display: block;
  font-size: 14px;
  color: var(--text-primary);
  margin-bottom: 6px;
}

.setting-item select,
.setting-item input {
  width: 100%;
  padding: 8px 12px;
  font-size: 14px;
  background: var(--bg-secondary);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);
  color: var(--text-primary);
  transition: all var(--transition-fast);
}

.setting-item select:hover,
.setting-item input:hover {
  border-color: var(--border-strong);
}

.setting-item select:focus,
.setting-item input:focus {
  outline: none;
  border-color: var(--primary-color);
  box-shadow: 0 0 0 3px var(--primary-light);
}

.checkbox-label {
  display: flex !important;
  align-items: center;
  gap: 8px;
  cursor: pointer;
  font-size: 14px !important;
  color: var(--text-primary);
}

.checkbox-label input[type="checkbox"] {
  width: 18px;
  height: 18px;
  accent-color: var(--primary-color);
}

.settings-actions {
  display: flex;
  gap: 12px;
  margin-top: 24px;
  padding-top: 20px;
  border-top: 1px solid var(--border-color);
}

.btn {
  padding: 8px 16px;
  font-size: 14px;
  font-weight: 500;
  border: 1px solid transparent;
  border-radius: var(--radius-md);
  cursor: pointer;
  transition: all var(--transition-fast);
}

.btn-primary {
  background: var(--primary-color);
  color: var(--text-inverse);
}

.btn-primary:hover {
  background: var(--primary-hover);
}

.btn-secondary {
  background: var(--bg-secondary);
  color: var(--text-primary);
  border-color: var(--border-color);
}

.btn-secondary:hover {
  background: var(--bg-hover);
}

:root {
  --primary-color: #3b82f6;
  --primary-hover: #2563eb;
  --primary-light: #dbeafe;
  --text-primary: #1f2937;
  --text-secondary: #6b7280;
  --bg-primary: #ffffff;
  --bg-secondary: #f9fafb;
  --bg-hover: #e5e7eb;
  --sidebar-header-bg: #f3f4f6;
  --border-color: #e5e7eb;
  --border-strong: #d1d5db;
  --radius-lg: 8px;
  --radius-md: 6px;
  --shadow-xl: 0 20px 25px -5px rgb(0 0 0 / 0.1);
  --transition-fast: 0.15s ease;
}

.dark {
  --primary-color: #60a5fa;
  --primary-hover: #3b82f6;
  --primary-light: #1e3a5f;
  --text-primary: #f9fafb;
  --text-secondary: #9ca3af;
  --bg-primary: #0f172a;
  --bg-secondary: #111827;
  --bg-hover: #374151;
  --sidebar-header-bg: #1f2937;
  --border-color: #374151;
  --border-strong: #4b5563;
}
</style>
