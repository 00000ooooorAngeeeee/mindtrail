import { get, put } from './client'
import type { LinkedEntry, NodeHit, NodeRef, RecentEntry } from './types'

// ---- 导图↔记录联动（v1.1 P1，04 §5 契约补充） ----

/** 导图全部挂接（徽标计数）：{nodeId: [entryId, …]}。 */
export function getMindmapLinks(mindmapId: number): Promise<Record<string, number[]>> {
  return get<Record<string, number[]>>(`/mindmaps/${mindmapId}/links`)
}

/** 节点挂接的条目详情（详情弹层数据源）。 */
export function getNodeLinks(mindmapId: number, nodeId: string): Promise<LinkedEntry[]> {
  return get<LinkedEntry[]>(`/mindmaps/${mindmapId}/nodes/${encodeURIComponent(nodeId)}/links`)
}

/** 替换节点挂接的条目集合（先清后插，幂等）。 */
export function replaceNodeLinks(mindmapId: number, nodeId: string, entryIds: number[]): Promise<LinkedEntry[]> {
  return put<LinkedEntry[]>(`/mindmaps/${mindmapId}/nodes/${encodeURIComponent(nodeId)}/links`, { entryIds })
}

/** 节点搜索（选择器）：q 空时浏览全部；返回 {nodeId, text, path}。 */
export function searchMindmapNodes(mindmapId: number, q?: string): Promise<NodeHit[]> {
  const keyword = q?.trim()
  const query = keyword ? `?q=${encodeURIComponent(keyword)}` : ''
  return get<NodeHit[]>(`/mindmaps/${mindmapId}/nodes${query}`)
}

/** 条目引用的节点列表（含导图名与节点文本，跳转定位用）。 */
export function getEntryNodes(entryId: number): Promise<NodeRef[]> {
  return get<NodeRef[]>(`/entries/${entryId}/nodes`)
}

/** 替换条目引用的节点集合（先清后插，幂等，可跨导图）。 */
export function replaceEntryNodes(
  entryId: number,
  links: { mindmapId: number; nodeId: string }[],
): Promise<NodeRef[]> {
  return put<NodeRef[]>(`/entries/${entryId}/nodes`, { links })
}

/** 会话内全部条目引用（时间线批量回填）：{entryId: [NodeRef, …]}。 */
export function getSessionLinks(sessionId: number): Promise<Record<number, NodeRef[]>> {
  return get<Record<number, NodeRef[]>>(`/sessions/${sessionId}/links`)
}

/** 工作区最近条目（节点挂条目对话框候选，按创建时间倒序）。 */
export function getRecentEntries(workspaceId: number, limit?: number): Promise<RecentEntry[]> {
  const query = limit ? `?limit=${limit}` : ''
  return get<RecentEntry[]>(`/workspaces/${workspaceId}/entries/recent${query}`)
}
