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
  /** 绑定的 Git 提交完整 hash（经 entry_commit 回填，06 §3「commits」）。 */
  commits?: string[]
  createdAt?: string
  updatedAt?: string
}

/** 仓库校验结果（04 §5 GET /git/repo/status）：head 为完整 40 位 hash，空仓库为 null。 */
export interface RepoStatus {
  path: string
  head: string | null
  branch: string | null
}

/** 提交元信息（04 §5 GET /git/repo/commits：hash/author/time/message/files）。 */
export interface GitCommit {
  hash: string
  author: string
  authorEmail?: string | null
  time?: string | null
  message: string
  files: string[]
}

/** 会话内条目-提交绑定关系（GET /sessions/{id}/commits，Git 面板与未绑定缓冲计算）。 */
export interface BoundCommit {
  entryId: number
  commitHash: string
  repoPath: string
  boundAt?: string
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

// ---- 全局搜索（M4 任务一，04 §5 GET /search，结果按类型分组） ----

export type SearchResultType = 'mindmap' | 'entry' | 'session'

export const SEARCH_RESULT_TYPES: SearchResultType[] = ['mindmap', 'entry', 'session']

export const SEARCH_RESULT_LABELS: Record<SearchResultType, string> = {
  mindmap: '导图',
  entry: '条目',
  session: '会话',
}

/** 导图命中：nodeId 为命中的首个节点（D2 跳转定位）；snippet 由后端生成（04 §6.3）。 */
export interface SearchMindmapHit {
  id: number
  workspaceId: number
  workspaceName: string
  name: string
  snippet: string
  nodeId: string | null
  nodeCount: number
  updatedAt?: string
}

/** 条目命中：seq 用于估算时间线所在页（D2 跳转定位）。 */
export interface SearchEntryHit {
  id: number
  sessionId: number
  workspaceId: number
  workspaceName: string
  sessionTitle: string
  seq: number
  type: EntryType
  snippet: string
  createdAt?: string
}

export interface SearchSessionHit {
  id: number
  workspaceId: number
  workspaceName: string
  title: string
  status: 'active' | 'completed'
  startedAt?: string | null
  endedAt?: string | null
}

export interface SearchResults {
  query: string
  mindmaps: SearchMindmapHit[]
  entries: SearchEntryHit[]
  sessions: SearchSessionHit[]
}

// ---- 标签（M4 任务二，PRD D3/D4） ----

/** 工作区级标签（GET /tags，含条目使用计数）。 */
export interface TagInfo {
  id: number
  workspaceId: number
  name: string
  createdAt?: string
  entryCount: number
}

/** 按标签筛出的条目（GET /entries?tagId=&sessionId=，含会话上下文供跳转）。 */
export interface TaggedEntry {
  id: number
  sessionId: number
  seq: number
  type: EntryType
  contentMd: string
  createdAt?: string
  sessionTitle: string
  workspaceId: number
  workspaceName: string
  tags: string[]
}
