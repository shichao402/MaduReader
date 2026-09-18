import { memo } from 'react'
import {
  ChevronRight,
  FileText,
  Folder,
  FolderOpen,
  Image,
  FileJson,
  FileCode,
} from 'lucide-react'
import { cn } from '../lib/utils'

export interface FileNode {
  name: string
  path: string
  isDir: boolean
  children: FileNode[]
  expanded: boolean
}

interface FileTreeProps {
  nodes: FileNode[]
  workingDirectory?: string
  activePath: string | null
  onOpenFile: (path: string) => void
  onToggleNode: (path: string) => void
}

function getNodeIcon(node: FileNode, expanded: boolean) {
  if (node.isDir) return expanded ? FolderOpen : Folder
  if (node.name.endsWith('.md')) return FileText
  if (/\.(png|jpg|jpeg|gif|svg)$/i.test(node.name)) return Image
  if (node.name.endsWith('.json')) return FileJson
  if (/\.(py|js|ts|tsx|rs)$/.test(node.name)) return FileCode
  return FileText
}

const TreeItem = memo(function TreeItem({
  node,
  depth,
  activePath,
  onOpenFile,
  onToggleNode,
}: {
  node: FileNode
  depth: number
  activePath: string | null
  onOpenFile: (path: string) => void
  onToggleNode: (path: string) => void
}) {
  const Icon = getNodeIcon(node, node.expanded)
  const isActive = !node.isDir && node.path === activePath

  return (
    <>
      <div
        role="button"
        tabIndex={0}
        className={cn(
          'flex items-center gap-2 py-1.5 pr-2 cursor-pointer select-none text-sm rounded-md transition-colors animate-fade-in',
          'text-[color:var(--color-text-primary)] hover:bg-[color:var(--color-sidebar-hover)]',
          isActive && 'bg-[color:var(--color-sidebar-active)] text-[color:var(--color-primary)]',
        )}
        style={{ paddingLeft: 8 + depth * 14 }}
        onClick={() => (node.isDir ? onToggleNode(node.path) : onOpenFile(node.path))}
        onKeyDown={(e) => {
          if (e.key === 'Enter') node.isDir ? onToggleNode(node.path) : onOpenFile(node.path)
        }}
      >
        {node.isDir ? (
          <ChevronRight
            size={13}
            className={cn(
              'shrink-0 text-[color:var(--color-text-tertiary)] transition-transform',
              node.expanded && 'rotate-90',
            )}
          />
          ) : (
            <span className="w-[13px] shrink-0" />
          )}
          <Icon
            size={15}
            className="shrink-0 text-[color:var(--color-text-secondary)]"
          />
        <span className="flex-1 truncate">{node.name}</span>
      </div>
      {node.isDir && node.expanded && node.children?.length > 0 && (
        <div className="border-l border-[color:var(--color-border-base)] ml-[14px] pl-1">
          {node.children.map((child) => (
            <TreeItem
              key={child.path}
              node={child}
              depth={depth + 1}
              activePath={activePath}
              onOpenFile={onOpenFile}
              onToggleNode={onToggleNode}
            />
          ))}
        </div>
      )}
    </>
  )
})

export default function FileTree({
  nodes,
  activePath,
  onOpenFile,
  onToggleNode,
}: FileTreeProps) {
  return (
    <div className="py-1">
      {nodes.map((node) => (
        <TreeItem
          key={node.path}
          node={node}
          depth={0}
          activePath={activePath}
          onOpenFile={onOpenFile}
          onToggleNode={onToggleNode}
        />
      ))}
    </div>
  )
}
