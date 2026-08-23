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

/** 单个文件 diff（v1.1 P1 C3.6）：unified diff 文本 + 增删行统计（diff 预览弹层）。 */
export interface FileDiff {
  path: string
  diff: string
  added: number
  deleted: number
}

/** 提交 diff 预览（GET /git/repo/commits/{hash}/diff，PRD C3.5「diff 预览 P1」）；truncated=超限截断。 */
export interface CommitDiff {
  hash: string
  files: FileDiff[]
  truncated: boolean
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

// ---- 导出（M4 任务三，PRD B5/C5） ----

/** 会话 JSON 导出（trailmind-session-json v1，06 §4 附录协议；时间为 ISO-8601 秒级字符串）。 */
export interface SessionJson {
  id: number
  title: string
  status: 'active' | 'completed'
  workspaceId: number
  workspace: string | null
  repoPath: string | null
  startHead: string | null
  endHead: string | null
  summary: string | null
  startedAt: string | null
  endedAt: string | null
  createdAt: string | null
  updatedAt: string | null
}

export interface SessionJsonEntry {
  id: number
  sessionId: number
  seq: number
  type: EntryType
  contentMd: string
  tags: string[]
  commits: string[]
  createdAt: string | null
  updatedAt: string | null
}

export interface SessionJsonExport {
  format: 'trailmind-session-json'
  version: number
  session: SessionJson
  entries: SessionJsonEntry[]
  entryCount: number
}

/** 导图导出产物（POST /mindmaps/{id}/export）：PNG content 为 Base64，OPML content 为 XML 原文，MD content 为 Markdown 大纲原文。 */
export interface MindmapExportFile {
  filename: string
  contentType: string
  content: string
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

// ---- 设置（M4 任务四，04 §5 GET/PUT /settings，PRD E2/E3） ----

export const THEME_MODES = ['light', 'dark', 'system'] as const
export type ThemeMode = (typeof THEME_MODES)[number]

export const THEME_LABELS: Record<ThemeMode, string> = {
  light: '浅色',
  dark: '深色',
  system: '跟随系统',
}

/** 数据库连接信息（只读展示；密码只给「是否已配置」，后端不返回密码本身）。 */
export interface DatabaseInfo {
  host: string
  port: number
  database: string
  username: string
  passwordConfigured: boolean
}

/** 应用设置视图（GET /settings / PUT /settings 响应体）。 */
export interface AppSettings {
  theme: ThemeMode
  defaultRepoPath: string | null
  database: DatabaseInfo
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

// ---- 导图↔记录联动（v1.1 P1，04 §5 契约补充：节点挂条目 / 条目引用节点） ----

/** 节点挂接的条目详情（GET /mindmaps/{id}/nodes/{nodeId}/links，详情弹层数据源）。 */
export interface LinkedEntry {
  entryId: number
  sessionId: number
  sessionTitle: string
  seq: number
  type: EntryType
  contentPreview: string | null
  createdAt?: string | null
}

/** 条目引用的节点（含工作区 id 供前端跳转定位，GET /entries/{id}/nodes）。 */
export interface NodeRef {
  workspaceId: number
  mindmapId: number
  mindmapName: string
  nodeId: string
  nodeText: string
}

/** 节点搜索命中（GET /mindmaps/{id}/nodes?q=，path 为祖先链「根 / 子 / 孙」）。 */
export interface NodeHit {
  nodeId: string
  text: string
  path: string
}

/** 工作区最近条目（GET /workspaces/{wid}/entries/recent，节点挂条目对话框候选）。 */
export interface RecentEntry {
  entryId: number
  sessionId: number
  sessionTitle: string
  seq: number
  type: EntryType
  contentMd: string
  createdAt?: string | null
}
