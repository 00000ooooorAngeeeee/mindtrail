// 与后端统一响应结构对应（08 §4.2）：code=0 成功。
export interface ApiResponse<T> {
  code: number
  data: T
  message: string
}

export interface Health {
  status: string
  app: string
  version: string
}

export interface Workspace {
  id: number
  name: string
  description?: string | null
  repoPath?: string | null
  createdAt?: string
  updatedAt?: string
  mindmapCount?: number
  sessionCount?: number
}

export interface Mindmap {
  id: number
  workspaceId?: number
  name: string
  contentJson?: string | null
  searchText?: string | null
  nodeCount?: number
  createdAt?: string
  updatedAt?: string
}
