<script setup lang="ts">
import { useTabStore } from '../stores/tabs'

console.log('[FileTree] Component loaded')

interface FileNode {
  name: string
  path: string
  isDir: boolean
  children: FileNode[]
  expanded: boolean
}

defineProps<{
  nodes: FileNode[]
  workingDirectory: string
}>()

const emit = defineEmits<{
  'open-file': [path: string]
  'toggle-node': [path: string]
}>()

const tabStore = useTabStore()

function toggleNode(node: FileNode) {
  console.log('[FileTree] toggleNode:', node.path)
  emit('toggle-node', node.path)
}

function openFile(node: FileNode) {
  console.log('[FileTree] openFile:', node.path)
  if (!node.isDir && node.name.endsWith('.md')) {
    emit('open-file', node.path)
  }
}

function isNodeActive(node: FileNode): boolean {
  if (!tabStore.activeTab) return false
  return tabStore.activeTab.path === node.path
}

function getNodeIcon(node: FileNode): string {
  if (node.isDir) {
    return node.expanded ? '📂' : '📁'
  }
  if (node.name.endsWith('.md')) return '📝'
  if (node.name.endsWith('.png') || node.name.endsWith('.jpg') || node.name.endsWith('.gif')) return '🖼️'
  if (node.name.endsWith('.json')) return '📋'
  if (node.name.endsWith('.py')) return '🐍'
  if (node.name.endsWith('.js') || node.name.endsWith('.ts')) return '📜'
  return '📄'
}
</script>

<template>
  <div class="file-tree">
    <template v-for="node in nodes" :key="node.path">
      <div 
        class="tree-node"
        :class="{ 
          directory: node.isDir,
          expanded: node.isDir && node.expanded,
          active: isNodeActive(node)
        }"
        @click="node.isDir ? toggleNode(node) : openFile(node)"
        @dblclick="openFile(node)"
      >
        <span class="node-icon">{{ getNodeIcon(node) }}</span>
        <span class="node-name">{{ node.name }}</span>
        <span v-if="node.isDir" class="expand-indicator">
          {{ node.expanded ? '▼' : '▶' }}
        </span>
      </div>
      
      <template v-if="node.isDir && node.expanded && node.children">
        <div class="children">
          <FileTree
            :nodes="node.children"
            :working-directory="workingDirectory"
            @open-file="emit('open-file', $event)"
            @toggle-node="emit('toggle-node', $event)"
          />
        </div>
      </template>
    </template>
  </div>
</template>

<style scoped>
.file-tree {
  padding: 4px 0;
}

.tree-node {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 12px;
  cursor: pointer;
  user-select: none;
  font-size: 14px;
  color: var(--text-primary);
  transition: all 0.15s ease;
}

.tree-node:hover {
  background: var(--sidebar-hover);
}

.tree-node.active {
  background: var(--sidebar-active);
  color: var(--primary-color);
}

.node-icon {
  font-size: 16px;
  width: 20px;
  text-align: center;
}

.node-name {
  flex: 1;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.expand-indicator {
  font-size: 10px;
  color: var(--text-secondary);
  width: 12px;
  text-align: center;
}

.children {
  border-left: 1px solid var(--border-color);
  margin-left: 16px;
  padding-left: 8px;
}
</style>

<script lang="ts">
export default {
  name: 'FileTree'
}
</script>
