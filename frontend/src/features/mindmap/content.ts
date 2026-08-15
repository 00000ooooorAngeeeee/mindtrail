// content_json 数据层纯函数（对应 docs/05 §4 结构）。
// 解析/序列化 + 节点增删改移折叠，全部为纯函数便于单测（08 §6「前端纯函数单测」）。
// 层级关系以 nodes[].parentId 为唯一事实源，edges[] 仅保留 free 连线（M2 自由画布使用）。

export type NodeShape = 'rounded' | 'rect' | 'ellipse' | 'diamond'

export interface MindmapNodeStyle {
  color: string
  bold: boolean
  shape: NodeShape
}

export interface MindmapNode {
  id: string
  text: string
  note?: string
  style: MindmapNodeStyle
  tags?: string[]
  parentId: string | null
  layout: { x: number; y: number } | null
  collapsed: boolean
  /** 自由便签（无文本纯形状，PRD B2.5）。 */
  sticky: boolean
}

export type MindmapEdgeType = 'parent-child' | 'free'

export interface MindmapEdge {
  id: string
  source: string
  target: string
  type: MindmapEdgeType
  label?: string | null
}

export interface MindmapContent {
  version: number
  rootNodeId: string
  nodes: Record<string, MindmapNode>
  edges: MindmapEdge[]
}

export const DEFAULT_NODE_STYLE: MindmapNodeStyle = { color: 'default', bold: false, shape: 'rounded' }

/** 新建导图的默认内容：单个根节点「中心主题」（与后端 MindmapContentUtil.defaultContentJson 对齐，PRD B1.1）。 */
export function defaultContent(): MindmapContent {
  return {
    version: 1,
    rootNodeId: 'n1',
    nodes: {
      n1: {
        id: 'n1',
        text: '中心主题',
        note: '',
        style: { ...DEFAULT_NODE_STYLE },
        tags: [],
        parentId: null,
        layout: null,
        collapsed: false,
        sticky: false,
      },
    },
    edges: [],
  }
}

/** 解析 content_json 字符串为结构化对象；空值回退为默认内容，非法 JSON 抛错。 */
export function parseContent(json: string | null | undefined): MindmapContent {
  if (json == null || json.trim() === '') {
    return defaultContent()
  }
  try {
    return normalize(JSON.parse(json) as Partial<MindmapContent>)
  } catch {
    throw new Error('导图内容不是合法 JSON')
  }
}

function normalize(raw: Partial<MindmapContent>): MindmapContent {
  const nodes: Record<string, MindmapNode> = {}
  const rawNodes = raw.nodes ?? {}
  for (const [id, n] of Object.entries(rawNodes)) {
    nodes[id] = {
      id,
      text: n.text ?? '',
      note: n.note,
      style: { ...DEFAULT_NODE_STYLE, ...(n.style ?? {}) },
      tags: n.tags ?? [],
      parentId: n.parentId ?? null,
      layout: n.layout ?? null,
      collapsed: n.collapsed ?? false,
      sticky: n.sticky ?? false,
    }
  }
  return {
    version: raw.version ?? 1,
    rootNodeId: raw.rootNodeId ?? Object.keys(nodes)[0] ?? 'n1',
    nodes,
    edges: Array.isArray(raw.edges) ? raw.edges : [],
  }
}

export function serializeContent(content: MindmapContent): string {
  return JSON.stringify(content)
}

/** 生成下一个节点 id（形如 n1/n2/…，取现有最大数字 +1）。 */
export function nextNodeId(content: MindmapContent): string {
  let max = 0
  for (const id of Object.keys(content.nodes)) {
    const m = /^n(\d+)$/.exec(id)
    if (m) max = Math.max(max, Number(m[1]))
  }
  return `n${max + 1}`
}

/** 生成下一个边 id（形如 e1/e2/…）。 */
export function nextEdgeId(content: MindmapContent): string {
  let max = 0
  for (const e of content.edges) {
    const m = /^e(\d+)$/.exec(e.id)
    if (m) max = Math.max(max, Number(m[1]))
  }
  return `e${max + 1}`
}

/** 收集某节点的所有后代（不含自身）。 */
export function descendants(content: MindmapContent, id: string): Set<string> {
  const children = buildChildren(content)
  const seen = new Set<string>()
  const stack = [id]
  while (stack.length) {
    const cur = stack.pop()!
    if (seen.has(cur)) continue
    seen.add(cur)
    for (const c of children.get(cur) ?? []) stack.push(c)
  }
  seen.delete(id)
  return seen
}

function buildChildren(content: MindmapContent): Map<string, string[]> {
  const children = new Map<string, string[]>()
  for (const n of Object.values(content.nodes)) {
    if (!n.parentId) continue
    const arr = children.get(n.parentId) ?? []
    arr.push(n.id)
    children.set(n.parentId, arr)
  }
  return children
}

/** 新增子节点（parentId 指向目标），返回新内容。画布模式可带布局坐标（在点击处落点）。 */
export function addChild(
  content: MindmapContent,
  parentId: string,
  text = '',
  layout: { x: number; y: number } | null = null,
): MindmapContent {
  const id = nextNodeId(content)
  const node: MindmapNode = {
    id,
    text,
    style: { ...DEFAULT_NODE_STYLE },
    tags: [],
    parentId,
    layout,
    collapsed: false,
    sticky: false,
  }
  return { ...content, nodes: { ...content.nodes, [id]: node } }
}

/** 新增自由便签（无文本纯形状/备注卡，PRD B2.5）：text 空、sticky 标记、默认琥珀色。
 *  挂载到指定父节点（人工验收：便签应成为选中节点的子节点）；缺省或父节点不存在时回退根节点。 */
export function addStickyNote(
  content: MindmapContent,
  layout: { x: number; y: number } | null = null,
  parentId: string | null = null,
): MindmapContent {
  const target = parentId && content.nodes[parentId] ? parentId : content.rootNodeId
  const id = nextNodeId(content)
  const node: MindmapNode = {
    id,
    text: '',
    style: { ...DEFAULT_NODE_STYLE, color: 'amber' },
    tags: [],
    parentId: target,
    layout,
    collapsed: false,
    sticky: true,
  }
  return { ...content, nodes: { ...content.nodes, [id]: node } }
}

/** 更新节点文本。 */
export function updateNodeText(content: MindmapContent, id: string, text: string): MindmapContent {
  const node = content.nodes[id]
  if (!node) return content
  return { ...content, nodes: { ...content.nodes, [id]: { ...node, text } } }
}

/** 更新节点样式（形状/颜色/加粗，按 Partial 合并，PRD B2.4/B2.6 批量设色）；节点不存在跳过，无变化返回原内容。 */
export function updateNodesStyle(
  content: MindmapContent,
  ids: string[],
  style: Partial<MindmapNodeStyle>,
): MindmapContent {
  let changed = false
  let nodes = content.nodes
  for (const id of ids) {
    const node = nodes[id]
    if (!node) continue
    nodes = { ...nodes, [id]: { ...node, style: { ...node.style, ...style } } }
    changed = true
  }
  return changed ? { ...content, nodes } : content
}

/** 删除子树（含自身）；根节点不可删，返回原内容。 */
export function deleteSubtree(content: MindmapContent, id: string): MindmapContent {
  const node = content.nodes[id]
  if (!node || node.parentId === null) return content
  const toRemove = descendants(content, id)
  toRemove.add(id)

  const nodes: Record<string, MindmapNode> = {}
  for (const [nid, n] of Object.entries(content.nodes)) {
    if (!toRemove.has(nid)) nodes[nid] = n
  }
  const edges = content.edges.filter((e) => !toRemove.has(e.source) && !toRemove.has(e.target))
  return { ...content, nodes, edges }
}

/** 批量删除多个节点（含各自子树，PRD B2.6）；根节点跳过；选中子树的父与后代按并集只删一次。 */
export function deleteNodes(content: MindmapContent, ids: string[]): MindmapContent {
  const toRemove = new Set<string>()
  for (const id of ids) {
    const node = content.nodes[id]
    if (!node || node.parentId === null) continue
    toRemove.add(id)
    for (const d of descendants(content, id)) toRemove.add(d)
  }
  if (toRemove.size === 0) return content
  const nodes: Record<string, MindmapNode> = {}
  for (const [nid, n] of Object.entries(content.nodes)) {
    if (!toRemove.has(nid)) nodes[nid] = n
  }
  const edges = content.edges.filter((e) => !toRemove.has(e.source) && !toRemove.has(e.target))
  return { ...content, nodes, edges }
}

/** 移动节点到新父节点；根不可移；移到自身/自身子树（成环）或目标不存在时返回原内容。 */
export function moveNode(content: MindmapContent, id: string, newParentId: string): MindmapContent {
  const node = content.nodes[id]
  if (!node || node.parentId === null) return content
  if (newParentId === id || newParentId === node.parentId) return content
  if (!content.nodes[newParentId]) return content
  if (descendants(content, id).has(newParentId)) return content
  return { ...content, nodes: { ...content.nodes, [id]: { ...node, parentId: newParentId } } }
}

/** 折叠/展开切换。 */
export function toggleCollapse(content: MindmapContent, id: string): MindmapContent {
  const node = content.nodes[id]
  if (!node) return content
  return { ...content, nodes: { ...content.nodes, [id]: { ...node, collapsed: !node.collapsed } } }
}
