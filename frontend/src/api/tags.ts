import { del, get, post, put } from './client'
import type { TagInfo, TaggedEntry } from './types'

/** 标签管理（M4 任务二，04 §5：GET /tags、POST /tags、PUT /tags/{id}、POST /tags/{id}/merge、DELETE /tags/{id}）。 */
export function listTags(workspaceId: number): Promise<TagInfo[]> {
  return get(`/tags?workspaceId=${workspaceId}`)
}

export function createTag(workspaceId: number, name: string): Promise<TagInfo> {
  return post('/tags', { workspaceId, name })
}

export function renameTag(id: number, name: string): Promise<TagInfo> {
  return put(`/tags/${id}`, { name })
}

export function mergeTag(sourceId: number, targetId: number): Promise<TagInfo> {
  return post(`/tags/${sourceId}/merge`, { targetId })
}

export function deleteTag(id: number): Promise<void> {
  return del(`/tags/${id}`)
}

/** 批量删除标签（04 §5 POST /tags/batch-delete，事务级联清 entry_tag，任一不存在 404 整体回滚）。 */
export function batchDeleteTags(ids: number[]): Promise<void> {
  return post('/tags/batch-delete', { ids })
}

/** 按标签筛条目（PRD D4；sessionId 可选会话内过滤）。 */
export function filterEntriesByTag(tagId: number, sessionId?: number): Promise<TaggedEntry[]> {
  const q = new URLSearchParams({ tagId: String(tagId) })
  if (sessionId != null) q.set('sessionId', String(sessionId))
  return get(`/entries?${q.toString()}`)
}
