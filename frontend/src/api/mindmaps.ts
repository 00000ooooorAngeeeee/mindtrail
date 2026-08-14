import { del, get, post } from './client'
import type { Mindmap } from './types'

export function listMindmaps(workspaceId: number): Promise<Mindmap[]> {
  return get<Mindmap[]>(`/workspaces/${workspaceId}/mindmaps`)
}

export function createMindmap(workspaceId: number, name: string): Promise<Mindmap> {
  return post<Mindmap>(`/workspaces/${workspaceId}/mindmaps`, { name })
}

export function deleteMindmap(id: number): Promise<void> {
  return del<void>(`/mindmaps/${id}`)
}
