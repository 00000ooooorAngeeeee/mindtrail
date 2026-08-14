// 自研树布局算法（docs/04 §6.4）：递归计算子树高度 → 中序均分 → O(n)、无重叠。
// 纯函数，无 React/React Flow 依赖，便于单测（08 §6「树布局算法」单测要求）。
// 布局为右向树：根在左（x=0），子节点逐层向右；同层叶子按 DFS 序垂直均分。

import type { MindmapContent } from './content'

export interface LayoutPoint {
  x: number
  y: number
}

/** 层间距（每层向右的水平增量）。 */
export const LEVEL_GAP = 200
/** 行间距（同级叶子之间的垂直增量）。 */
export const ROW_GAP = 64

/**
 * 计算每个可见节点的坐标。折叠节点的子树不占位（07 §4「折叠后布局正确收缩」）。
 * 返回 Map<nodeId, {x,y}>；x/y 为节点左上角坐标（配合 React Flow 默认 origin [0,0]）。
 */
export function computeTreeLayout(content: MindmapContent): Map<string, LayoutPoint> {
  const { nodes, rootNodeId } = content

  const children = new Map<string, string[]>()
  for (const n of Object.values(nodes)) {
    if (n.parentId && nodes[n.parentId]) {
      const arr = children.get(n.parentId) ?? []
      arr.push(n.id)
      children.set(n.parentId, arr)
    }
  }

  // 从根可达的节点集合（忽略折叠）：用于区分「折叠隐藏」与「真孤立」（父链断裂/成环）。
  const rooted = new Set<string>()
  const stack = [rootNodeId]
  while (stack.length) {
    const cur = stack.pop()!
    if (rooted.has(cur)) continue
    rooted.add(cur)
    for (const c of children.get(cur) ?? []) stack.push(c)
  }

  const pos = new Map<string, LayoutPoint>()
  const visited = new Set<string>()
  const slots = new Map<string, number>() // 槽位索引（叶子为单位），最后统一乘 ROW_GAP
  let nextLeaf = 0

  const place = (id: string, depth: number): void => {
    if (visited.has(id)) return
    visited.add(id)
    const node = nodes[id]
    const kids = node.collapsed ? [] : (children.get(id) ?? [])
    let slot: number
    if (kids.length === 0) {
      slot = nextLeaf++
    } else {
      let sum = 0
      for (const k of kids) {
        place(k, depth + 1)
        sum += slots.get(k)!
      }
      slot = sum / kids.length
    }
    slots.set(id, slot)
    pos.set(id, { x: depth * LEVEL_GAP, y: slot * ROW_GAP })
  }

  place(rootNodeId, 0)

  // 兜底：真孤立/成环节点（数据异常）排到主树下方，避免死循环与重叠（正常数据不会走到这里）。
  for (const id of Object.keys(nodes)) {
    if (!visited.has(id) && !rooted.has(id)) {
      pos.set(id, { x: 0, y: nextLeaf++ * ROW_GAP })
    }
  }

  return pos
}
