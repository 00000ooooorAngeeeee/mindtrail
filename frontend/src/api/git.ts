import { del, get, post } from './client'
import type { BoundCommit, CommitDiff, GitCommit, RepoStatus } from './types'

/** 仓库校验（PRD C3.1 / 04 §5）：非法路径后端返回 400 并给出明确提示。 */
export function getRepoStatus(path: string): Promise<RepoStatus> {
  return get<RepoStatus>(`/git/repo/status?path=${encodeURIComponent(path)}`)
}

/** 提交历史（新→旧，04 §5）：since=会话 start_head 即 5s 轮询的「新提交感知」来源（04 §6.2）。 */
export function getCommits(
  path: string,
  opts: { since?: string | null; until?: string | null; limit?: number } = {},
): Promise<GitCommit[]> {
  const params = new URLSearchParams({ path })
  if (opts.since) params.set('since', opts.since)
  if (opts.until) params.set('until', opts.until)
  if (opts.limit !== undefined) params.set('limit', String(opts.limit))
  return get<GitCommit[]>(`/git/repo/commits?${params.toString()}`)
}

/** 会话内全部条目-提交绑定（Git 面板与「未绑定缓冲」计算）。 */
export function getSessionCommits(sessionId: number): Promise<BoundCommit[]> {
  return get<BoundCommit[]>(`/sessions/${sessionId}/commits`)
}

/** 单个提交详情（PRD C3.5 详情弹层：hash/作者/时间/完整 message/变更文件）。 */
export function getCommitDetail(path: string, hash: string): Promise<GitCommit> {
  return get<GitCommit>(`/git/repo/commits/${encodeURIComponent(hash)}?path=${encodeURIComponent(path)}`)
}

/** 提交 diff 预览（v1.1 P1 C3.6，PRD C3.5「diff 预览 P1」）：unified diff + 增删统计 + 截断标记。 */
export function getCommitDiff(path: string, hash: string): Promise<CommitDiff> {
  return get<CommitDiff>(`/git/repo/commits/${encodeURIComponent(hash)}/diff?path=${encodeURIComponent(path)}`)
}

/** 绑定提交到条目（04 §5 POST /entries/{id}/commits）：返回本次新增绑定的 hash。 */
export function bindCommits(entryId: number, commitHashes: string[]): Promise<string[]> {
  return post<string[]>(`/entries/${entryId}/commits`, { commitHashes })
}

/** 解绑（04 §5 DELETE /entries/{id}/commits/{hash}）。 */
export function unbindCommit(entryId: number, commitHash: string): Promise<void> {
  return del<void>(`/entries/${entryId}/commits/${encodeURIComponent(commitHash)}`)
}
