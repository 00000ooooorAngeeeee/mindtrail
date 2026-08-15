import type { GitCommit } from '../../api/types'

/** 短 hash（徽标/面板展示用，PRD C3.3「列表含 hash」展示形态）。 */
export function shortHash(hash: string): string {
  return hash ? hash.slice(0, 7) : ''
}

/** 提交信息首行（面板单行展示；空消息回退占位）。 */
export function firstLine(message: string): string {
  const idx = message.indexOf('\n')
  const line = idx >= 0 ? message.slice(0, idx) : message
  return line.trim() || '（无提交信息）'
}

/** Git 轮询间隔（07 §6「5s 新提交感知」，PRD C3.2）。 */
export const GIT_POLL_INTERVAL_MS = 5000

/** 同一会话建议卡片最多提醒次数（07 §6「同一会话最多 3 次提醒」）。 */
export const MAX_GIT_REMINDERS = 3

/** 建议卡片状态（localStorage 按会话持久化，强杀重启后提醒配额不重置）。 */
export interface GitSuggestState {
  dismissed: number
  seenHashes: string[]
}

export function gitSuggestKey(sessionId: number): string {
  return `trailmind.gitSuggest.${sessionId}`
}

export function loadGitSuggest(sessionId: number): GitSuggestState {
  try {
    const raw = localStorage.getItem(gitSuggestKey(sessionId))
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<GitSuggestState>
      if (typeof parsed.dismissed === 'number' && Array.isArray(parsed.seenHashes)) {
        return {
          dismissed: Math.min(parsed.dismissed, MAX_GIT_REMINDERS),
          seenHashes: parsed.seenHashes.filter((h) => typeof h === 'string'),
        }
      }
    }
  } catch {
    // 脏数据回退默认
  }
  return { dismissed: 0, seenHashes: [] }
}

export function saveGitSuggest(sessionId: number, state: GitSuggestState): void {
  try {
    localStorage.setItem(gitSuggestKey(sessionId), JSON.stringify(state))
  } catch {
    // 写入失败静默忽略：提醒是体验增强，不阻塞记录
  }
}

/** 未绑定提交 = 会话区间提交中未被任何条目绑定的部分（06 §5「未绑定提交缓冲」）。 */
export function unboundCommits(commits: GitCommit[], boundHashes: ReadonlySet<string>): GitCommit[] {
  return commits.filter((c) => !boundHashes.has(c.hash))
}

/**
 * 建议卡片决策（纯函数）：
 * 优先提醒最新一条「未绑定且未提醒过」的提交；同一会话提醒满 3 次后不再提醒（07 §6）。
 */
export function nextSuggestion(
  commits: GitCommit[],
  boundHashes: ReadonlySet<string>,
  state: GitSuggestState,
): GitCommit | null {
  if (state.dismissed >= MAX_GIT_REMINDERS) return null
  const seen = new Set(state.seenHashes)
  return unboundCommits(commits, boundHashes).find((c) => !seen.has(c.hash)) ?? null
}

/** 忽略建议：把当前全部未绑定提交标记为已见 + 提醒次数 +1（纯函数，返回新状态）。 */
export function dismissSuggestion(
  commits: GitCommit[],
  boundHashes: ReadonlySet<string>,
  state: GitSuggestState,
): GitSuggestState {
  const seen = new Set(state.seenHashes)
  for (const c of unboundCommits(commits, boundHashes)) {
    seen.add(c.hash)
  }
  return { dismissed: Math.min(state.dismissed + 1, MAX_GIT_REMINDERS), seenHashes: [...seen] }
}
