import { beforeEach, describe, expect, it } from 'vitest'
import type { GitCommit } from '../../api/types'
import {
  MAX_GIT_REMINDERS,
  dismissSuggestion,
  firstLine,
  gitSuggestKey,
  loadGitSuggest,
  nextSuggestion,
  saveGitSuggest,
  shortHash,
  unboundCommits,
} from './gitTimeline'

const commit = (hash: string, message = '提交消息'): GitCommit => ({
  hash,
  author: '验证者',
  time: '2025-06-01T09:00:00',
  message,
  files: ['a.txt'],
})

describe('gitTimeline 纯函数（07 §6 任务三）', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('shortHash：取前 7 位，空值安全', () => {
    expect(shortHash('1234567890abcdef')).toBe('1234567')
    expect(shortHash('')).toBe('')
  })

  it('firstLine：取提交信息首行并去空白', () => {
    expect(firstLine('feat: 第一行\n\n正文')).toBe('feat: 第一行')
    expect(firstLine('   ')).toBe('（无提交信息）')
  })

  it('unboundCommits：过滤已绑定 hash，保留未绑定', () => {
    const list = [commit('1'.repeat(40)), commit('2'.repeat(40)), commit('3'.repeat(40))]
    const unbound = unboundCommits(list, new Set(['2'.repeat(40)]))
    expect(unbound.map((c) => c.hash)).toEqual(['1'.repeat(40), '3'.repeat(40)])
  })

  it('nextSuggestion：返回最新未提醒的未绑定提交', () => {
    const commits = [commit('1'.repeat(40)), commit('2'.repeat(40))]
    const bound = new Set<string>()

    const first = nextSuggestion(commits, bound, { dismissed: 0, seenHashes: [] })
    expect(first?.hash).toBe('1'.repeat(40)) // 列表新→旧，取最新

    const second = nextSuggestion(commits, bound, { dismissed: 0, seenHashes: ['1'.repeat(40)] })
    expect(second?.hash).toBe('2'.repeat(40))

    // 全部已提醒 → null
    expect(
      nextSuggestion(commits, bound, { dismissed: 0, seenHashes: ['1'.repeat(40), '2'.repeat(40)] }),
    ).toBeNull()
  })

  it('nextSuggestion：提醒满 3 次后不再提醒（07 §6）', () => {
    const commits = [commit('9'.repeat(40))]
    expect(nextSuggestion(commits, new Set(), { dismissed: 2, seenHashes: [] })?.hash).toBe('9'.repeat(40))
    expect(nextSuggestion(commits, new Set(), { dismissed: MAX_GIT_REMINDERS, seenHashes: [] })).toBeNull()
  })

  it('dismissSuggestion：标记全部未绑定提交为已见 + 次数 +1（纯函数不修改入参）', () => {
    const state = { dismissed: 1, seenHashes: ['0'.repeat(40)] }
    const next = dismissSuggestion([commit('1'.repeat(40)), commit('2'.repeat(40))], new Set(['2'.repeat(40)]), state)

    expect(next.dismissed).toBe(2)
    expect(next.seenHashes).toContain('1'.repeat(40)) // 未绑定的标记为已见
    expect(next.seenHashes).not.toContain('2'.repeat(40)) // 已绑定的不计入
    expect(state.dismissed).toBe(1) // 原状态不变
  })

  it('dismissSuggestion：次数封顶为 3', () => {
    const next = dismissSuggestion([commit('1'.repeat(40))], new Set(), {
      dismissed: MAX_GIT_REMINDERS,
      seenHashes: [],
    })
    expect(next.dismissed).toBe(MAX_GIT_REMINDERS)
  })

  it('loadGitSuggest/saveGitSuggest：按会话持久化，脏数据回退默认', () => {
    expect(loadGitSuggest(7)).toEqual({ dismissed: 0, seenHashes: [] })
    saveGitSuggest(7, { dismissed: 2, seenHashes: ['a'.repeat(40)] })
    expect(localStorage.getItem(gitSuggestKey(7))).toContain('"dismissed":2')
    expect(loadGitSuggest(7).dismissed).toBe(2)

    localStorage.setItem(gitSuggestKey(8), '{bad json')
    expect(loadGitSuggest(8)).toEqual({ dismissed: 0, seenHashes: [] })
  })
})
