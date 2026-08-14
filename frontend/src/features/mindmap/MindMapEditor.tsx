// 树状模式画布（07 §4「树状模式画布」验收项）：React Flow 渲染 + 自研树布局。
// 交互：点选节点、双击编辑、拖拽改层级（悬停高亮）、折叠/展开、缩放/平移、双击空白加节点、快捷键。
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  ReactFlow,
  useEdgesState,
  useNodesState,
  type Edge,
  type Node,
  type ReactFlowInstance,
  type XYPosition,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { useMindmapStore } from '../../store/useMindmapStore'
import { descendants } from './content'
import type { MindmapContent } from './content'
import { computeTreeLayout, type LayoutPoint } from './treeLayout'
import { MindmapNode, type MindmapRFNode } from './MindmapNode'
import './mindmap.css'

// 节点估宽/高（用于拖拽落点中心判定；节点宽随文本变化，估算足够命中）。
const NODE_W = 160
const NODE_H = 44
// 判定「拖到某节点上」的最大中心距离。
const DROP_RADIUS = 120

const nodeTypes = { mindmap: MindmapNode }

function buildNodes(
  content: MindmapContent,
  positions: Map<string, LayoutPoint>,
  childCount: Map<string, number>,
  selectedId: string | null,
): MindmapRFNode[] {
  const out: MindmapRFNode[] = []
  for (const [id, pos] of positions) {
    const n = content.nodes[id]
    if (!n) continue
    out.push({
      id,
      type: 'mindmap',
      position: pos,
      selected: id === selectedId,
      data: {
        text: n.text,
        isRoot: id === content.rootNodeId,
        hasChildren: (childCount.get(id) ?? 0) > 0,
        childCount: childCount.get(id) ?? 0,
        collapsed: n.collapsed,
      },
    })
  }
  return out
}

function buildEdges(content: MindmapContent, positions: Map<string, LayoutPoint>): Edge[] {
  const out: Edge[] = []
  for (const n of Object.values(content.nodes)) {
    if (!n.parentId || !positions.has(n.id) || !positions.has(n.parentId)) continue
    out.push({
      id: `pc:${n.id}`,
      source: n.parentId,
      target: n.id,
      type: 'smoothstep',
      style: { stroke: '#c3c8d4', strokeWidth: 1.5 },
    })
  }
  return out
}

/** 计算拖拽落点：返回距离拖拽中心最近且在阈值内的目标节点 id（排除自身及其后代），无则 null。 */
function findDropTarget(
  draggedId: string,
  draggedPos: XYPosition,
  positions: Map<string, LayoutPoint>,
  exclude: Set<string>,
): string | null {
  const cx = draggedPos.x + NODE_W / 2
  const cy = draggedPos.y + NODE_H / 2
  let best: string | null = null
  let bestDist = DROP_RADIUS
  for (const [id, p] of positions) {
    if (id === draggedId || exclude.has(id)) continue
    const d = Math.hypot(p.x + NODE_W / 2 - cx, p.y + NODE_H / 2 - cy)
    if (d < bestDist) {
      bestDist = d
      best = id
    }
  }
  return best
}

export function MindMapEditor({ mindmapId, onBack }: { mindmapId: number; onBack: () => void }) {
  const load = useMindmapStore((s) => s.load)
  const select = useMindmapStore((s) => s.select)
  const addChild = useMindmapStore((s) => s.addChild)
  const deleteNode = useMindmapStore((s) => s.deleteNode)
  const moveNode = useMindmapStore((s) => s.moveNode)
  const save = useMindmapStore((s) => s.save)

  const mindmap = useMindmapStore((s) => s.mindmap)
  const content = useMindmapStore((s) => s.content)
  const selectedId = useMindmapStore((s) => s.selectedId)
  const loading = useMindmapStore((s) => s.loading)
  const error = useMindmapStore((s) => s.error)
  const saving = useMindmapStore((s) => s.saving)
  const dirty = useMindmapStore((s) => s.dirty)

  const [nodes, setNodes, onNodesChange] = useNodesState<MindmapRFNode>([])
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([])
  const [zoom, setZoom] = useState(1)
  const dragging = useRef(false)
  const dropTargetRef = useRef<string | null>(null)
  const fittedRef = useRef(false)
  const rfRef = useRef<ReactFlowInstance<MindmapRFNode, Edge> | null>(null)

  useEffect(() => {
    void load(mindmapId)
    fittedRef.current = false
  }, [mindmapId, load])

  const positions = useMemo(() => (content ? computeTreeLayout(content) : new Map<string, LayoutPoint>()), [content])
  const childCount = useMemo(() => {
    const m = new Map<string, number>()
    if (!content) return m
    for (const n of Object.values(content.nodes)) {
      if (n.parentId) m.set(n.parentId, (m.get(n.parentId) ?? 0) + 1)
    }
    return m
  }, [content])

  // 布局/内容变化时同步节点与边（拖拽中跳过，避免打断拖拽）。
  useEffect(() => {
    if (!content || dragging.current) return
    setNodes(buildNodes(content, positions, childCount, selectedId))
    setEdges(buildEdges(content, positions))
    if (!fittedRef.current) {
      fittedRef.current = true
      // 双 rAF 等 React Flow 完成首轮测量后再 fit，避免按 0 尺寸计算。
      requestAnimationFrame(() => requestAnimationFrame(() => void rfRef.current?.fitView({ padding: 0.2 })))
    }
  }, [content, positions, childCount, selectedId, setNodes, setEdges])

  const onNodeDragStart = useCallback(() => {
    dragging.current = true
    dropTargetRef.current = null
  }, [])

  const onNodeDrag = useCallback(
    (_e: unknown, node: Node) => {
      if (!content) return
      const target = findDropTarget(node.id, node.position, positions, descendants(content, node.id))
      if (target === dropTargetRef.current) return
      dropTargetRef.current = target
      setNodes((nds) => nds.map((n) => ({ ...n, data: { ...n.data, hover: n.id === target } })))
    },
    [content, positions, setNodes],
  )

  const onNodeDragStop = useCallback(
    (_e: unknown, node: Node) => {
      dragging.current = false
      const target = dropTargetRef.current
      dropTargetRef.current = null
      const newParent = target ?? content?.rootNodeId
      if (newParent) moveNode(node.id, newParent)
    },
    [content, moveNode],
  )

  const addNodeShortcut = useCallback(() => {
    if (!content) return
    addChild(selectedId ?? content.rootNodeId)
  }, [content, selectedId, addChild])

  const deleteSelected = useCallback(() => {
    if (selectedId && content && selectedId !== content.rootNodeId) {
      const count = descendants(content, selectedId).size
      if (window.confirm(count > 0 ? `删除该节点及其 ${count} 个子节点？` : '删除该节点？')) {
        deleteNode(selectedId)
      }
    }
  }, [selectedId, content, deleteNode])

  // 快捷键（08 §4.3 / 03 §5）：Ctrl+N 加节点、Delete 删除、Ctrl+S 保存。
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'TEXTAREA' || t.tagName === 'INPUT')) return
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault()
        void save()
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'n') {
        e.preventDefault()
        addNodeShortcut()
      } else if (e.key === 'Delete') {
        e.preventDefault()
        deleteSelected()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [save, addNodeShortcut, deleteSelected])

  const nodeCount = content ? Object.keys(content.nodes).length : 0

  return (
    <div className="mm-editor">
      <div className="mm-toolbar">
        <button onClick={onBack}>← 返回</button>
        <span className="mm-title">{mindmap?.name ?? '加载中…'}</span>
        <div className="mm-toolbar-actions">
          <button onClick={() => void rfRef.current?.fitView({ padding: 0.2 })}>适应视图</button>
          <button onClick={() => void save()} disabled={saving || !dirty}>
            {saving ? '保存中…' : dirty ? '保存*' : '已保存'}
          </button>
        </div>
      </div>

      {loading && !content ? (
        <div className="mm-center muted">加载中…</div>
      ) : error && !content ? (
        <div className="mm-center error" role="alert">
          {error}
        </div>
      ) : (
        <div className="mm-canvas">
          <ReactFlow<MindmapRFNode, Edge>
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onNodeClick={(_, node) => select(node.id)}
            onPaneClick={(e) => {
              if (e.detail === 2) addNodeShortcut()
              else select(null)
            }}
            onNodeDragStart={onNodeDragStart}
            onNodeDrag={onNodeDrag}
            onNodeDragStop={onNodeDragStop}
            onMove={(_, viewport) => setZoom(viewport.zoom)}
            nodesConnectable={false}
            nodesFocusable={false}
            fitView={false}
            minZoom={0.2}
            maxZoom={2.5}
            proOptions={{ hideAttribution: true }}
            onInit={(inst) => {
              rfRef.current = inst
            }}
          >
            <Background variant={BackgroundVariant.Dots} gap={24} size={1} />
            <Controls showInteractive={false} />
            <MiniMap pannable zoomable />
          </ReactFlow>
        </div>
      )}

      <div className="mm-statusbar">
        <span>{nodeCount} 节点</span>
        <span>树状模式</span>
        <span>{Math.round(zoom * 100)}%</span>
        <span className="muted">双击节点编辑 · 拖拽改层级 · 双击空白加节点</span>
      </div>
    </div>
  )
}
