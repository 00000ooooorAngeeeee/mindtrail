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

// 条目类型枚举（docs/06 §2，v1 不可扩展），与后端 EntryService.ENTRY_TYPES 保持一致。
export const ENTRY_TYPES = [
  'goal',
  'context',
  'prompt',
  'action',
  'artifact',
  'decision',
  'error',
  'test',
  'review',
  'next',
  'note',
] as const

export type EntryType = (typeof ENTRY_TYPES)[number]

export const ENTRY_TYPE_LABELS: Record<EntryType, string> = {
  goal: '目标',
  context: '背景',
  prompt: '指令',
  action: '操作',
  artifact: '产出',
  decision: '决策',
  error: '错误',
  test: '验证',
  review: '复盘',
  next: '下一步',
  note: '备注',
}

// 条目类型图标（03 §3.5「条目卡片按类型着色左缘 + 图标」）。
export const ENTRY_TYPE_ICONS: Record<EntryType, string> = {
  goal: '🎯',
  context: '🧭',
  prompt: '⌨️',
  action: '⚙️',
  artifact: '📦',
  decision: '🔀',
  error: '🐞',
  test: '✅',
  review: '📝',
  next: '🔜',
  note: '📌',
}

export interface Entry {
  id: number
  sessionId?: number
  seq: number
  type: EntryType
  contentMd: string
  tags?: string[]
  createdAt?: string
  updatedAt?: string
}

export interface Session {
  id: number
  workspaceId?: number
  title: string
  status: 'active' | 'completed'
  repoPath?: string | null
  startHead?: string | null
  endHead?: string | null
  summary?: string | null
  startedAt?: string | null
  endedAt?: string | null
  createdAt?: string
  updatedAt?: string
  entryCount?: number
  entries?: Entry[]
  entryTotal?: number
}
