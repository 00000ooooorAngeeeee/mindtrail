import { del, get, post, put } from './client'
import type { Mindmap } from './types'

export function listMindmaps(workspaceId: number): Promise<Mindmap[]> {
  return get<Mindmap[]>(`/workspaces/${workspaceId}/mindmaps`)
}

export function createMindmap(workspaceId: number, name: string): Promise<Mindmap> {
  return post<Mindmap>(`/workspaces/${workspaceId}/mindmaps`, { name })
}

export function getMindmap(id: number): Promise<Mindmap> {
  return get<Mindmap>(`/mindmaps/${id}`)
}

/** 整图覆盖保存（04 §5/§6.1）：携带 updatedAt 乐观锁，冲突时后端返回 code=409。 */
export function saveMindmap(id: number, contentJson: string, updatedAt?: string): Promise<Mindmap> {
  return put<Mindmap>(`/mindmaps/${id}`, { contentJson, updatedAt })
}

export function deleteMindmap(id: number): Promise<void> {
  return del<void>(`/mindmaps/${id}`)
}
