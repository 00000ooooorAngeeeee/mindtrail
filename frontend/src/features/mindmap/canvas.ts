// 画布模式纯函数（docs/04 §6.4 / 07 §5「M2 自由画布」）：布局平铺、严格树判定、自由边与坐标持久化。
// 与 treeLayout.ts 同规则：纯函数、无 React/React Flow 依赖，便于单测（08 §6）。
// 层级关系仍以 nodes[].parentId 为唯一事实源；自由边存 edges[]（type=free），画布模式下渲染，树模式忽略（PRD B3.3）。

import type { MindmapContent } from './content'
import { nextEdgeId } from './content'
import type { LayoutPoint } from './treeLayout'

/** 树→画布：把布局结果平铺为各节点 layout 坐标（04 §6.4「布局结果平铺」）。无坐标的节点保持原 layout；坐标未变时不产生新对象。 */
export function flattenLayout(content: MindmapContent, positions: Map<string, LayoutPoint>): MindmapContent {
  let changed = false
  const nodes: MindmapContent['nodes'] = {}
  for (const [id, n] of Object.entries(content.nodes)) {
    const pos = positions.get(id)
    if (pos && (n.layout?.x !== pos.x || n.layout?.y !== pos.y)) {
      nodes[id] = { ...n, layout: { ...pos } }
      changed = true
    } else {
      nodes[id] = n
    }
  }
  return changed ? { ...content, nodes } : content
}

/**
 * 画布→树严格树判定（04 §6.4）：父链（parentId）+ 自由边合并为有向边集后，
 * 根无入边、其余节点恰一条入边、且全部节点从根可达（可达性检查同时排除成环与孤立）。
 */
export function isStrictTree(content: MindmapContent): boolean {
  const { nodes, rootNodeId } = content
  if (!nodes[rootNodeId]) return false

  const incoming = new Map<string, number>()
  for (const n of Object.values(nodes)) {
    if (n.parentId) incoming.set(n.id, (incoming.get(n.id) ?? 0) + 1)
  }
  for (const e of content.edges) {
    incoming.set(e.target, (incoming.get(e.target) ?? 0) + 1)
  }

  if ((incoming.get(rootNodeId) ?? 0) !== 0) return false
  for (const id of Object.keys(nodes)) {
    if (id !== rootNodeId && (incoming.get(id) ?? 0) !== 1) return false
  }

  const children = new Map<string, string[]>()
  for (const n of Object.values(nodes)) {
    if (n.parentId) {
      const arr = children.get(n.parentId) ?? []
      arr.push(n.id)
      children.set(n.parentId, arr)
    }
  }
  for (const e of content.edges) {
    const arr = children.get(e.source) ?? []
    arr.push(e.target)
    children.set(e.source, arr)
  }

  const seen = new Set<string>()
  const stack = [rootNodeId]
  while (stack.length) {
    const cur = stack.pop()!
    if (seen.has(cur)) continue
    seen.add(cur)
    for (const c of children.get(cur) ?? []) stack.push(c)
  }
  return seen.size === Object.keys(nodes).length
}

/** 画布移动节点 layout 坐标（写入 content_json 持久化，PRD B2.1；多选拖拽带动全体 B2.6）。节点不存在跳过，无变化返回原内容。 */
export function moveNodesLayout(
  content: MindmapContent,
  updates: { id: string; x: number; y: number }[],
): MindmapContent {
  let changed = false
  let nodes = content.nodes
  for (const u of updates) {
    const node = nodes[u.id]
    if (!node) continue
    if (node.layout?.x === u.x && node.layout?.y === u.y) continue
    nodes = { ...nodes, [u.id]: { ...node, layout: { x: u.x, y: u.y } } }
    changed = true
  }
  return changed ? { ...content, nodes } : content
}

/** 画布自由连线（type=free，PRD B2.2）。自环、重复连线、节点不存在时返回原内容。 */
export function addFreeEdge(content: MindmapContent, source: string, target: string): MindmapContent {
  if (source === target) return content
  if (!content.nodes[source] || !content.nodes[target]) return content
  if (content.edges.some((e) => e.source === source && e.target === target)) return content
  const edge = { id: nextEdgeId(content), source, target, type: 'free' as const, label: null }
  return { ...content, edges: [...content.edges, edge] }
}

/** 按 id 删除自由边；边不存在返回原内容。 */
export function removeFreeEdge(content: MindmapContent, edgeId: string): MindmapContent {
  if (!content.edges.some((e) => e.id === edgeId)) return content
  return { ...content, edges: content.edges.filter((e) => e.id !== edgeId) }
}

/** 忽略全部非树边（画布→树「三选一」之「忽略非树边」，07 §5）。 */
export function removeAllFreeEdges(content: MindmapContent): MindmapContent {
  if (content.edges.length === 0) return content
  return { ...content, edges: [] }
}
