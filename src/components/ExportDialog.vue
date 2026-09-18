<script setup lang="ts">
import { ref } from 'vue'
import { useTabStore } from '../stores/tabs'
import { useSettingsStore } from '../stores/settings'

const tabStore = useTabStore()
const settingsStore = useSettingsStore()

const props = defineProps<{
  renderedHtml?: string
}>()

const dialogVisible = ref(false)
const exportFormat = ref<'html' | 'pdf'>('html')
const includeStyles = ref(true)
const includeImages = ref(true)
const pageFormat = ref<'A4' | 'A3' | 'Letter'>('A4')
const pageOrientation = ref<'portrait' | 'landscape'>('portrait')

function openDialog() {
  dialogVisible.value = true
}

function closeDialog() {
  dialogVisible.value = false
}

// 导出为 HTML
async function exportToHtml() {
  if (!tabStore.activeTab) return
  
  const { renderMarkdown } = await import('../composables/useMarkdown')
  const htmlContent = props.renderedHtml || renderMarkdown(tabStore.activeContent)
  
  const fullHtml = buildExportHtml(htmlContent)
  
  downloadFile(`${tabStore.activeTab.name.replace('.md', '')}.html`, fullHtml)
  closeDialog()
}

// 导出为 PDF
async function exportToPdf() {
  if (!tabStore.activeTab) return
  
  const { renderMarkdown } = await import('../composables/useMarkdown')
  const htmlContent = props.renderedHtml || renderMarkdown(tabStore.activeContent)
  const printWindow = window.open('', '_blank')
  if (!printWindow) {
    alert('无法打开打印窗口，请检查浏览器弹窗设置')
    return
  }

  printWindow.document.open()
  printWindow.document.write(buildExportHtml(htmlContent, true))
  printWindow.document.close()
  printWindow.focus()
  setTimeout(() => {
    printWindow.print()
  }, 100)
  closeDialog()
}

function buildExportHtml(htmlContent: string, printable = false): string {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${tabStore.activeTab?.name || 'MDReader Export'}</title>
  <style>
    ${includeStyles.value ? getStyles() : ''}
    ${printable ? getPrintStyles() : ''}
  </style>
</head>
<body>
  <div class="markdown-content">
    ${htmlContent}
  </div>
</body>
</html>`
}

function getStyles(): string {
  const isDark = settingsStore.isDark
  const bgColor = isDark ? '#0f172a' : '#ffffff'
  const textColor = isDark ? '#f9fafb' : '#1f2927'
  const borderColor = isDark ? '#374151' : '#e5e7eb'
  
  return `
    body {
      background-color: ${bgColor};
      color: ${textColor};
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
      line-height: 1.8;
      padding: 40px;
      margin: 0;
    }
    
    .markdown-content {
      max-width: 800px;
      margin: 0 auto;
    }
    
    h1, h2, h3, h4, h5, h6 {
      color: ${textColor};
      margin: 1.5em 0 0.5em;
    }
    
    h1 { font-size: 2.5em; border-bottom: 2px solid ${borderColor}; padding-bottom: 0.3em; }
    h2 { font-size: 2em; border-bottom: 1px solid ${borderColor}; padding-bottom: 0.2em; }
    h3 { font-size: 1.5em; }
    
    p { margin: 1em 0; }
    
    code {
      background-color: ${isDark ? '#1f2937' : '#f3f4f6'};
      padding: 0.2em 0.4em;
      border-radius: 4px;
      font-family: 'Fira Code', 'Consolas', monospace;
      font-size: 0.9em;
    }
    
    pre {
      background-color: ${isDark ? '#1f2937' : '#f3f4f6'};
      padding: 1em;
      border-radius: 8px;
      overflow-x: auto;
      margin: 1em 0;
    }
    
    pre code {
      background: none;
      padding: 0;
    }
    
    ul, ol { margin: 1em 0; padding-left: 2em; }
    
    blockquote {
      border-left: 4px solid ${borderColor};
      padding-left: 1em;
      margin: 1em 0;
      color: ${textColor};
      background-color: ${isDark ? '#1f2937' : '#f3f4f6'};
      padding: 0.5em 1em;
      border-radius: 0 8px 8px 0;
    }
    
    table {
      border-collapse: collapse;
      width: 100%;
      margin: 1em 0;
    }
    
    th, td {
      border: 1px solid ${borderColor};
      padding: 0.5em 1em;
      text-align: left;
    }
    
    th {
      background-color: ${isDark ? '#1f2937' : '#f3f4f6'};
      font-weight: 600;
    }
    
    img {
      max-width: 100%;
      border-radius: 8px;
      margin: 1em 0;
    }
    
    a {
      color: ${isDark ? '#60a5fa' : '#3b82f6'};
      text-decoration: none;
    }
    
    hr {
      border: none;
      border-top: 1px solid ${borderColor};
      margin: 2em 0;
    }
  `
}

function getPrintStyles(): string {
  return `
    @page {
      size: ${pageFormat.value} ${pageOrientation.value};
      margin: 16mm;
    }

    @media print {
      body {
        padding: 0;
      }

      .markdown-content {
        max-width: none;
      }

      pre, blockquote, table, img, svg {
        break-inside: avoid;
      }
    }
  `
}

function downloadFile(filename: string, content: string) {
  const blob = new Blob([content], { type: 'text/html;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

// 暴露方法
defineExpose({
  open: openDialog,
  close: closeDialog
})
</script>

<template>
  <div v-if="dialogVisible" class="modal-overlay" @click="closeDialog">
    <div class="modal-content" @click.stop>
      <div class="modal-header">
        <h2>导出文档</h2>
        <button class="close-btn" @click="closeDialog">×</button>
      </div>
      
      <div class="modal-body">
        <div class="settings-section">
          <h3>导出格式</h3>
          <div class="format-options">
            <label class="format-option">
              <input type="radio" v-model="exportFormat" value="html" />
              <span>HTML</span>
            </label>
            <label class="format-option">
              <input type="radio" v-model="exportFormat" value="pdf" />
              <span>PDF</span>
            </label>
          </div>
        </div>
        
        <div class="settings-section">
          <h3>导出选项</h3>
          <div class="setting-item">
            <label class="checkbox-label">
              <input type="checkbox" v-model="includeStyles" />
              包含样式
            </label>
          </div>
          <div class="setting-item" v-if="exportFormat === 'html'">
            <label class="checkbox-label">
              <input type="checkbox" v-model="includeImages" />
              包含图片资源
            </label>
          </div>
        </div>
        
        <div class="settings-section" v-if="exportFormat === 'pdf'">
          <h3>页面设置</h3>
          <div class="setting-item">
            <label>页面格式</label>
            <select v-model="pageFormat">
              <option value="A4">A4</option>
              <option value="A3">A3</option>
              <option value="Letter">Letter</option>
            </select>
          </div>
          <div class="setting-item">
            <label>页面方向</label>
            <select v-model="pageOrientation">
              <option value="portrait">纵向</option>
              <option value="landscape">横向</option>
            </select>
          </div>
        </div>
        
        <div class="settings-actions">
          <button class="btn btn-primary" @click="exportFormat === 'html' ? exportToHtml() : exportToPdf()">
            开始导出
          </button>
          <button class="btn btn-secondary" @click="closeDialog">取消</button>
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
  max-width: 500px;
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

.format-options {
  display: flex;
  gap: 16px;
}

.format-option {
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
  font-size: 14px;
  color: var(--text-primary);
}

.format-option input {
  width: 18px;
  height: 18px;
  accent-color: var(--primary-color);
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
</style>
