import { del, get, patch, post, put } from './client'
import type { Mindmap, MindmapExportFile } from './types'

export type MindmapExportType = 'PNG' | 'OPML'

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

/** 导图重命名（PRD B4，M4 缺陷清理补全）：PATCH 仅携带 name，后端同步 search_text 的 name 部分。 */
export function renameMindmap(id: number, name: string): Promise<Mindmap> {
  return patch<Mindmap>(`/mindmaps/${id}`, { name })
}

export function deleteMindmap(id: number): Promise<void> {
  return del<void>(`/mindmaps/${id}`)
}

/** 导图导出（PRD B5）：PNG 返回 Base64，OPML 返回 XML 原文；文件名由后端清理后给出。 */
export function exportMindmap(id: number, type: MindmapExportType): Promise<MindmapExportFile> {
  return post<MindmapExportFile>(`/mindmaps/${id}/export?type=${type}`)
}
