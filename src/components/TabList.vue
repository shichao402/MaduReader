<script setup lang="ts">

interface Tab {
  id: string
  path: string
  name: string
  content: string
  isModified: boolean
  isUntitled: boolean
}

defineProps<{
  tabs: Tab[]
  activeTabId: string | null
}>()

const emit = defineEmits<{
  'close-tab': [id: string]
  'set-active': [id: string]
  'new-tab': []
}>()

function setActive(id: string) {
  emit('set-active', id)
}

function closeTab(e: MouseEvent, id: string) {
  e.preventDefault()
  emit('close-tab', id)
}

function newTab() {
  emit('new-tab')
}

function startRename(e: MouseEvent, tab: Tab) {
  e.preventDefault()
  // TODO: 实现重命名功能
  console.log('Rename:', tab)
}
</script>

<template>
  <div class="tab-list">
    <div 
      v-for="tab in tabs" 
      :key="tab.id"
      class="tab-item"
      :class="{ active: activeTabId === tab.id, modified: tab.isModified }"
      @click="setActive(tab.id)"
      @dblclick="(e: MouseEvent) => startRename(e, tab)"
    >
      <span class="tab-icon">{{ tab.isUntitled ? '➕' : '📄' }}</span>
      <span class="tab-name" :title="tab.name">{{ tab.name }}</span>
      <span v-if="tab.isModified" class="modified-dot" title="未保存"></span>
      <button 
        class="close-btn"
        @click="(e: MouseEvent) => closeTab(e, tab.id)"
        @mousedown.prevent
        title="关闭"
      >
        ×
      </button>
    </div>
    
    <div class="new-tab-btn" @click="newTab" title="新建页签">
      +
    </div>
  </div>
</template>

<style scoped>
.tab-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 8px 0;
  max-height: 100%;
  overflow-y: auto;
}

.tab-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  cursor: pointer;
  font-size: 13px;
  color: var(--text-primary);
  transition: all 0.15s ease;
}

.tab-item:hover {
  background: var(--sidebar-hover);
}

.tab-item.active {
  background: var(--sidebar-active);
  color: var(--primary-color);
}

.tab-icon {
  font-size: 14px;
  width: 18px;
  text-align: center;
}

.tab-name {
  flex: 1;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.modified-dot {
  width: 8px;
  height: 8px;
  background: var(--warning-color);
  border-radius: 50%;
  flex-shrink: 0;
}

.close-btn {
  width: 20px;
  height: 20px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-size: 16px;
  line-height: 1;
  color: var(--text-secondary);
  opacity: 0;
  transition: all 0.15s ease;
}

.tab-item:hover .close-btn,
.tab-item.active .close-btn {
  opacity: 1;
}

.close-btn:hover {
  background: var(--danger-bg);
  color: var(--danger-color);
}

.new-tab-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 8px;
  cursor: pointer;
  color: var(--text-secondary);
  font-size: 18px;
  border-top: 1px solid var(--border-color);
  margin-top: 4px;
  transition: all 0.15s ease;
}

.new-tab-btn:hover {
  background: var(--sidebar-hover);
  color: var(--primary-color);
}
</style>
