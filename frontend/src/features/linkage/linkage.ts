// 导图↔记录联动纯函数（v1.1 P1）：挂接勾选集合维护、节点祖先链路径。
// 纯函数便于单测（08 §6「前端纯函数单测」）；路径算法与后端 NodeEntryService.pathOf 保持一致（契约对称）。
import type { MindmapContent } from '../mindmap/content'

/** 祖先路径链最长（与后端 PATH_MAX_DEPTH 一致，防脏数据成环死循环）。 */
export const PATH_MAX_DEPTH = 20

/**
 * 勾选切换（挂接对话框用）：保持书写顺序的选中集增删。
 * 已含则移除（取消勾选），未含则追加；返回新数组（原数组不修改）。
 * 泛型支持 number[]（条目 id）与 string[]（`导图id:节点id` 键）。
 */
export function toggleSelection<T>(current: T[], id: T): T[] {
  if (current.includes(id)) {
    return current.filter((x) => x !== id)
  }
  return [...current, id]
}

/**
 * 节点祖先链路径「根 / 子 / 孙」（含自身文本；空白文本节点回退显示 id；环/缺失时截断）。
 * 与后端 NodeEntryService.searchNodes 返回的 path 同构（前端 badge 悬浮提示复用）。
 */
export function buildNodePath(content: MindmapContent, nodeId: string): string {
  const chain: string[] = []
  let cur: string | null = nodeId
  const seen = new Set<string>()
  while (cur != null && chain.length < PATH_MAX_DEPTH && !seen.has(cur)) {
    seen.add(cur)
    const node: MindmapContent['nodes'][string] | undefined = content.nodes[cur]
    if (!node) break
    chain.push(node.text.trim() ? node.text : cur)
    cur = node.parentId
  }
  return [...chain].reverse().join(' / ')
}

/** 候选条目单行预览：首个非空行（超长截断），Markdown 渲染前的一行文本。 */
export function previewLine(text: string | null | undefined, max = 60): string {
  const line = (text ?? '').split('\n').find((l) => l.trim()) ?? ''
  const t = line.trim()
  return t.length > max ? `${t.slice(0, max)}…` : t
}
