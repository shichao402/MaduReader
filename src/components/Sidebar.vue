<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useTabStore } from '../stores/tabs'
import FileTree from './FileTree.vue'
import TabList from './TabList.vue'
import SettingsDialog from './SettingsDialog.vue'

console.log('[Sidebar] Component loaded')

const props = defineProps<{
  collapsed: boolean
}>()

const emit = defineEmits(['toggle', 'toggle-position'])

const tabStore = useTabStore()

console.log('[Sidebar] TabStore obtained, sidebarView:', tabStore.sidebarView)

const sidebarWidth = ref(280)

const currentView = computed(() => tabStore.sidebarView)

onMounted(() => {
  console.log('[Sidebar] onMounted, collapsed:', props.collapsed, 'currentView:', currentView.value)
})

function handleViewChange(view: 'tree' | 'tabs') {
  console.log('[Sidebar] handleViewChange called:', view)
  tabStore.setSidebarView(view)
}
</script>

<template>
  <div 
    class="sidebar" 
    :style="{ width: sidebarWidth + 'px' }"
  >
    <!-- 头部控制区 -->
    <div class="sidebar-header">
      <div class="header-left">
        <button 
          class="icon-btn" 
          @click="emit('toggle')"
          title="折叠侧边栏"
        >
          {{ props.collapsed ? '▶' : '◀' }}
        </button>
        <span class="sidebar-title">MDReader</span>
      </div>
      <div class="header-right">
        <button class="icon-btn" @click="emit('toggle-position')" title="切换侧边栏位置">
          ↭
        </button>
        <button class="icon-btn" @click="tabStore.refreshFileTree" title="刷新">
          🔄
        </button>
      </div>
    </div>

    <!-- 视图切换 -->
    <div class="view-switcher">
      <button
        class="view-btn"
        :class="{ active: currentView === 'tree' }"
        @click="handleViewChange('tree')"
      >
        <span>📁</span>
        <span>目录</span>
      </button>
      <button
        class="view-btn"
        :class="{ active: currentView === 'tabs' }"
        @click="handleViewChange('tabs')"
      >
        <span>📄</span>
        <span>页签</span>
      </button>
    </div>

    <!-- 视图内容 -->
    <div class="sidebar-content">
      <FileTree 
        v-if="currentView === 'tree'" 
        :nodes="tabStore.fileTree"
        :working-directory="tabStore.workingDirectory"
        @open-file="tabStore.openFile"
        @toggle-node="tabStore.toggleFileNode"
      />
      <TabList 
        v-else
        :tabs="tabStore.tabs"
        :active-tab-id="tabStore.activeTabId"
        @close-tab="tabStore.closeTab"
        @set-active="tabStore.setActiveTab"
        @new-tab="tabStore.newTab"
      />
    </div>

    <!-- 底部设置 -->
    <div class="sidebar-footer">
      <SettingsDialog />
    </div>
  </div>
</template>

<style scoped>
.sidebar {
  display: flex;
  flex-direction: column;
  background: var(--sidebar-bg);
  border-right: 1px solid var(--border-color);
  overflow: hidden;
}

.sidebar-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 8px;
  border-bottom: 1px solid var(--border-color);
  background: var(--sidebar-header-bg);
}

.header-left {
  display: flex;
  align-items: center;
  gap: 8px;
}

.sidebar-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary);
}

.header-right {
  display: flex;
  gap: 4px;
}

.icon-btn {
  width: 28px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-size: 14px;
  color: var(--text-secondary);
  transition: all 0.15s ease;
}

.icon-btn:hover {
  background: var(--sidebar-hover);
  color: var(--text-primary);
}

.view-switcher {
  display: flex;
  gap: 4px;
  padding: 8px;
  border-bottom: 1px solid var(--border-color);
}

.view-btn {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 8px 12px;
  background: transparent;
  border: 1px solid transparent;
  border-radius: 6px;
  cursor: pointer;
  font-size: 13px;
  color: var(--text-secondary);
  transition: all 0.15s ease;
}

.view-btn:hover {
  background: var(--sidebar-hover);
}

.view-btn.active {
  background: var(--sidebar-active);
  border-color: var(--primary-color);
  color: var(--text-primary);
}

.sidebar-content {
  flex: 1;
  overflow-y: auto;
  overflow-x: hidden;
}

.sidebar-footer {
  padding: 8px;
  border-top: 1px solid var(--border-color);
}
</style>
