import { del, get, patch, post } from './client'
import type { Session, SessionJsonExport } from './types'

/** 开始会话（04 §5）：title 必填；repoPath 可选，缺省继承工作区仓库，后端记录 start_head。 */
export function createSession(workspaceId: number, input: { title: string; repoPath?: string }): Promise<Session> {
  return post<Session>(`/workspaces/${workspaceId}/sessions`, input)
}

export function listSessions(workspaceId: number): Promise<Session[]> {
  return get<Session[]>(`/workspaces/${workspaceId}/sessions`)
}

/** 会话详情（含条目分页，默认每页 50，04 §5）。 */
export function getSession(id: number, page = 1, size = 50): Promise<Session> {
  return get<Session>(`/sessions/${id}?page=${page}&size=${size}`)
}

/** PATCH（title 重命名 / status=completed 结束会话 + summary 总结）。 */
export function updateSession(
  id: number,
  patchBody: { title?: string; status?: 'active' | 'completed'; summary?: string },
): Promise<Session> {
  return patch<Session>(`/sessions/${id}`, patchBody)
}

export function deleteSession(id: number): Promise<void> {
  return del<void>(`/sessions/${id}`)
}

/** 会话导出 Markdown（严格 06 §4 协议；data 为 Markdown 文本）。 */
export function exportSessionMarkdown(id: number): Promise<string> {
  return get<string>(`/sessions/${id}/export/markdown`)
}

/** 会话导出 JSON（trailmind-session-json v1；data 为机器可读结构）。 */
export function exportSessionJson(id: number): Promise<SessionJsonExport> {
  return get<SessionJsonExport>(`/sessions/${id}/export/json`)
}
