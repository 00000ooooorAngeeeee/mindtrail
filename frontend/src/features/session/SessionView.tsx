import { useCallback, useEffect, useRef, useState } from 'react'
import { addEntry, deleteEntry, updateEntry } from '../../api/entries'
import { bindCommits, getCommitDetail, getCommits, getSessionCommits, unbindCommit } from '../../api/git'
import { exportSessionMarkdown, getSession, updateSession } from '../../api/sessions'
import {
  ENTRY_TYPE_ICONS,
  ENTRY_TYPE_LABELS,
  ENTRY_TYPES,
  type BoundCommit,
  type Entry,
  type EntryType,
  type GitCommit,
  type Session,
} from '../../api/types'
import { CommitDetailModal } from './CommitDetailModal'
import { EntryCard } from './EntryCard'
import {
  GIT_POLL_INTERVAL_MS,
  dismissSuggestion,
  firstLine,
  loadGitSuggest,
  nextSuggestion,
  saveGitSuggest,
  shortHash,
  unboundCommits,
} from './gitTimeline'
import { loadEntryType, saveEntryType } from './typeMemory'
import { useInfiniteScroll } from './useInfiniteScroll'
import { formatTime } from './time'
import './session.css'

const PAGE_SIZE = 50
const GIT_COMMIT_PAGE_LIMIT = 50

/**
 * 会话详情页（时间线，07 §6 任务二/三/四）：
 * 头部（标题/状态/时间跨度/条目数 + 导出 Markdown + 结束会话）、垂直时间线（memo 化条目卡片：Markdown 渲染 +
 * 类型着色 + 图标 + 时间戳列，无限滚动每页 50）、底部常驻快速记录框（Enter 提交、Shift+Enter 换行、类型记忆、Ctrl+E 聚焦）、
 * 条目编辑/删除、commit 徽标点击打开详情弹层（PRD C3.5，含解绑）、
 * Git：5s 轮询新提交感知 + 未绑定缓冲 + 建议卡片（同会话最多 3 次提醒）+ Git 时间线面板（绑定/解绑）。
 */
export function SessionView({ sessionId, onBack }: { sessionId: number; onBack: () => void }) {
  const [session, setSession] = useState<Session | null>(null)
  const [entries, setEntries] = useState<Entry[]>([])
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [draftType, setDraftType] = useState<EntryType>(() => loadEntryType())
  const [draftContent, setDraftContent] = useState('')
  const quickRef = useRef<HTMLTextAreaElement | null>(null)

  const [editingId, setEditingId] = useState<number | null>(null)
  const [editType, setEditType] = useState<EntryType>('action')
  const [editContent, setEditContent] = useState('')

  const [completing, setCompleting] = useState(false)
  const [summaryDraft, setSummaryDraft] = useState('')
  const [exporting, setExporting] = useState(false)

  // Git 状态（任务三）：提交列表、绑定关系、建议卡片（提交 hash）、面板开关、防重叠轮询标志
  const [gitCommits, setGitCommits] = useState<GitCommit[]>([])
  const [boundCommits, setBoundCommits] = useState<BoundCommit[]>([])
  const [suggestHash, setSuggestHash] = useState<string | null>(null)
  const [gitPanelOpen, setGitPanelOpen] = useState(false)
  const [gitError, setGitError] = useState<string | null>(null)
  const [binding, setBinding] = useState(false)
  const pollingRef = useRef(false)

  // commit 详情弹层（任务四）：{ entryId, hash } 定位绑定关系；detailData 为展示数据
  const [detailTarget, setDetailTarget] = useState<{ entryId: number; hash: string } | null>(null)
  const [detailData, setDetailData] = useState<GitCommit | null>(null)
  const [detailError, setDetailError] = useState<string | null>(null)

  const load = useCallback(
    async (p: number) => {
      setLoading(true)
      setError(null)
      try {
        const data = await getSession(sessionId, p, PAGE_SIZE)
        setSession(data)
        setTotal(data.entryTotal ?? (data.entries?.length ?? 0))
        setEntries((prev) => (p === 1 ? (data.entries ?? []) : [...prev, ...(data.entries ?? [])]))
        setPage(p)
      } catch (e) {
        setError(e instanceof Error ? e.message : '加载会话失败')
      } finally {
        setLoading(false)
      }
    },
    [sessionId],
  )

  useEffect(() => {
    void load(1)
  }, [load])

  // Git 轮询（07 §6 任务三）：会话带仓库时拉取提交与绑定关系；
  // active 会话每 5s 轮询感知新提交（PRD C3.2），completed 会话仅拉取一次（04 §6.2「下次打开可继续检测」）。
  const refreshGit = useCallback(async () => {
    if (pollingRef.current) return // 防重叠：请求超时（10s）大于轮询间隔（5s）时跳过本轮
    const repoPath = session?.repoPath
    if (!repoPath) return
    pollingRef.current = true
    try {
      const [commits, bound] = await Promise.all([
        getCommits(repoPath, { since: session?.startHead ?? undefined, limit: GIT_COMMIT_PAGE_LIMIT }),
        getSessionCommits(sessionId),
      ])
      setGitCommits(commits)
      setBoundCommits(bound)
      const state = loadGitSuggest(sessionId)
      setSuggestHash(nextSuggestion(commits, new Set(bound.map((b) => b.commitHash)), state)?.hash ?? null)
      setGitError(null)
    } catch (e) {
      setGitError(e instanceof Error ? e.message : '加载 Git 提交失败')
    } finally {
      pollingRef.current = false
    }
  }, [sessionId, session?.repoPath, session?.startHead])

  useEffect(() => {
    void refreshGit()
    if (session?.status === 'active' && session?.repoPath) {
      const timer = setInterval(() => void refreshGit(), GIT_POLL_INTERVAL_MS)
      return () => clearInterval(timer)
    }
  }, [refreshGit, session?.status, session?.repoPath])

  const boundByHash = new Set(boundCommits.map((b) => b.commitHash))
  const unbound = unboundCommits(gitCommits, boundByHash)
  const suggestCommit = gitCommits.find((c) => c.hash === suggestHash) ?? null

  /** 绑定成功后本地回填：条目徽标 + 绑定关系（避免整页重载打断时间线）。 */
  const applyLocalBind = useCallback(
    (entryId: number, hash: string) => {
      setEntries((prev) =>
        prev.map((e) =>
          e.id === entryId && !(e.commits ?? []).includes(hash) ? { ...e, commits: [...(e.commits ?? []), hash] } : e,
        ),
      )
      setBoundCommits((prev) =>
        prev.some((b) => b.entryId === entryId && b.commitHash === hash)
          ? prev
          : [...prev, { entryId, commitHash: hash, repoPath: session?.repoPath ?? '', boundAt: new Date().toISOString() }],
      )
    },
    [session?.repoPath],
  )

  /** 一键绑定到最近条目（PRD C3.4「绑定到当前条目」）。 */
  const bindToLatest = async (hash: string) => {
    const target = entries.length > 0 ? entries[entries.length - 1] : undefined
    if (!target || binding) return
    setBinding(true)
    try {
      await bindCommits(target.id, [hash])
      applyLocalBind(target.id, hash)
      setSuggestHash(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : '绑定提交失败')
    } finally {
      setBinding(false)
    }
  }

  /** 忽略建议：当前未绑定提交全部标记已见 + 提醒次数 +1（同会话最多 3 次提醒，07 §6）。 */
  const handleIgnoreSuggestion = () => {
    const state = dismissSuggestion(gitCommits, boundByHash, loadGitSuggest(sessionId))
    saveGitSuggest(sessionId, state)
    setSuggestHash(null)
  }

  /** 解绑（PRD C3.5）：徽标点击或面板绑定行点击，二次确认后删除绑定关系。 */
  const handleUnbind = async (entryId: number, hash: string) => {
    if (!confirm('解除该提交与条目的绑定？')) return
    try {
      await unbindCommit(entryId, hash)
      setEntries((prev) => prev.map((e) => (e.id === entryId ? { ...e, commits: (e.commits ?? []).filter((h) => h !== hash) } : e)))
      setBoundCommits((prev) => prev.filter((b) => !(b.entryId === entryId && b.commitHash === hash)))
    } catch (e) {
      setError(e instanceof Error ? e.message : '解绑失败')
    }
  }

  /** 打开 commit 详情弹层（PRD C3.5）：优先用 Git 面板缓存，缓存没有（绑定提交超出 50 条窗口）再走详情接口。 */
  const openCommitDetail = useCallback(
    (entry: Entry, hash: string) => {
      setDetailTarget({ entryId: entry.id, hash })
      setDetailError(null)
      const cached = gitCommits.find((c) => c.hash === hash)
      if (cached) {
        setDetailData(cached)
        return
      }
      const repoPath = session?.repoPath
      if (!repoPath) {
        setDetailError('会话未关联 Git 仓库，无法读取提交详情')
        setDetailData(null)
        return
      }
      setDetailData(null)
      getCommitDetail(repoPath, hash)
        .then(setDetailData)
        .catch((e: unknown) => {
          setDetailError(e instanceof Error ? e.message : '读取提交详情失败')
        })
    },
    [gitCommits, session?.repoPath],
  )

  const closeCommitDetail = useCallback(() => {
    setDetailTarget(null)
    setDetailData(null)
    setDetailError(null)
  }, [])

  /** 弹层内解绑：确认 → 解绑 → 本地回填移除徽标 → 关闭弹层。 */
  const unbindFromDetail = async () => {
    if (!detailTarget) return
    if (!confirm('解除该提交与条目的绑定？')) return
    try {
      await unbindCommit(detailTarget.entryId, detailTarget.hash)
      setEntries((prev) =>
        prev.map((e) =>
          e.id === detailTarget.entryId
            ? { ...e, commits: (e.commits ?? []).filter((h) => h !== detailTarget.hash) }
            : e,
        ),
      )
      setBoundCommits((prev) => prev.filter((b) => !(b.entryId === detailTarget.entryId && b.commitHash === detailTarget.hash)))
      closeCommitDetail()
    } catch (e) {
      setDetailError(e instanceof Error ? e.message : '解绑失败')
    }
  }

  /** 导出会话 Markdown（严格 06 §4，03 §3.5 头部导出入口）：下载为 <标题>.md。 */
  const handleExport = async () => {
    if (!session || exporting) return
    setExporting(true)
    try {
      const md = await exportSessionMarkdown(sessionId)
      const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${session.title}.md`
      a.click()
      URL.revokeObjectURL(url)
    } catch (e) {
      setError(e instanceof Error ? e.message : '导出失败')
    } finally {
      setExporting(false)
    }
  }

  // Ctrl+E 聚焦快速记录框（03 §5 快捷键全集）
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'e') {
        e.preventDefault()
        quickRef.current?.focus()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  const hasMore = total > entries.length
  const loadMore = useCallback(() => {
    void load(page + 1)
  }, [load, page])
  const sentinelRef = useInfiniteScroll(hasMore, loading, loadMore)

  const submitAdd = async () => {
    const content = draftContent
    if (!content.trim()) return
    try {
      const created = await addEntry(sessionId, { type: draftType, contentMd: content })
      setEntries((prev) => [...prev, created])
      setTotal((t) => t + 1)
      setDraftContent('')
    } catch (e) {
      setError(e instanceof Error ? e.message : '追加条目失败')
    }
  }

  const submitEdit = async (entry: Entry) => {
    if (!editContent.trim()) return
    try {
      const updated = await updateEntry(entry.id, { contentMd: editContent, type: editType })
      setEntries((prev) => prev.map((x) => (x.id === entry.id ? updated : x)))
      setEditingId(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : '编辑条目失败')
    }
  }

  const handleDelete = async (entry: Entry) => {
    if (!confirm('删除该条目？')) return
    try {
      await deleteEntry(entry.id)
      setEntries((prev) => prev.filter((x) => x.id !== entry.id))
      setTotal((t) => t - 1)
    } catch (e) {
      setError(e instanceof Error ? e.message : '删除条目失败')
    }
  }

  const handleComplete = async () => {
    try {
      await updateSession(sessionId, { status: 'completed', summary: summaryDraft })
      setCompleting(false)
      await load(1)
    } catch (e) {
      setError(e instanceof Error ? e.message : '结束会话失败')
    }
  }

  const completed = session?.status === 'completed'
  const typeOptions = completed ? (['review', 'note'] as const) : ENTRY_TYPES

  if (loading && !session) {
    return (
      <section className="session-view">
        <button onClick={onBack}>← 返回</button>
        <p className="muted">加载中…</p>
      </section>
    )
  }
  if (!session) {
    return (
      <section className="session-view">
        <button onClick={onBack}>← 返回</button>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
      </section>
    )
  }

  return (
    <section className="session-view">
      <button onClick={onBack}>← 返回</button>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}

      <header className="session-header">
        <div className="session-title-row">
          <h2>{session.title}</h2>
          <span className={`status-badge status-${session.status}`}>
            {completed ? '已完成' : '进行中'}
          </span>
        </div>
        <p className="muted">
          {formatTime(session.startedAt)}–{completed ? formatTime(session.endedAt) : '进行中'} · 条目 {total} 条
          {session.repoPath ? ` · 仓库 ${session.repoPath}` : ''}
        </p>
        <div className="session-header-actions">
          <button onClick={() => void handleExport()} disabled={exporting}>
            {exporting ? '导出中…' : '导出 Markdown'}
          </button>
          {!completed && <button onClick={() => setCompleting(true)}>结束会话</button>}
        </div>
        {completing && (
          <div className="complete-panel">
            <textarea
              aria-label="结束总结"
              placeholder="写一段结束总结（将写入 review 条目）"
              value={summaryDraft}
              onChange={(e) => setSummaryDraft(e.target.value)}
            />
            <button onClick={() => void handleComplete()}>确认结束</button>
            <button onClick={() => setCompleting(false)}>取消</button>
          </div>
        )}
      </header>

      {suggestCommit && (
        <div className="git-suggest">
          <p>
            检测到新提交 <code title={suggestCommit.hash}>{shortHash(suggestCommit.hash)}</code>{' '}
            {firstLine(suggestCommit.message)}
            {unbound.length > 1 ? `（共 ${unbound.length} 个未绑定）` : ''}
          </p>
          <button onClick={() => void bindToLatest(suggestCommit.hash)} disabled={entries.length === 0 || binding}>
            {binding ? '绑定中…' : '绑定到最近条目'}
          </button>
          <button onClick={handleIgnoreSuggestion}>忽略</button>
          {entries.length === 0 && <span className="muted">先追加一条记录才能绑定</span>}
        </div>
      )}

      {session.repoPath && (
        <section className="git-panel" aria-label="Git 时间线">
          <button type="button" className="git-panel-toggle" onClick={() => setGitPanelOpen((v) => !v)}>
            {gitPanelOpen ? '▾' : '▸'} Git 时间线（{gitCommits.length} 个提交
            {unbound.length > 0 ? ` · ${unbound.length} 未绑定` : ''}）
          </button>
          {gitError && (
            <p className="error" role="alert">
              {gitError}
            </p>
          )}
          {gitPanelOpen &&
            (gitCommits.length === 0 ? (
              <p className="muted">会话期间暂无提交</p>
            ) : (
              <ul className="git-commit-list">
                {gitCommits.map((c) => {
                  const bound = boundCommits.find((b) => b.commitHash === c.hash)
                  return (
                    <li key={c.hash} className="git-commit-item">
                      <code className="commit-hash" title={c.hash}>
                        {shortHash(c.hash)}
                      </code>
                      <span className="commit-msg">{firstLine(c.message)}</span>
                      <span className="commit-meta">
                        {formatTime(c.time)} · {c.author} · {c.files.length} 文件
                      </span>
                      {bound ? (
                        <button
                          className="commit-bound"
                          title="点击解绑"
                          onClick={() => void handleUnbind(bound.entryId, c.hash)}
                        >
                          已绑定 #{entries.find((e) => e.id === bound.entryId)?.seq ?? '–'}
                        </button>
                      ) : (
                        <button disabled={entries.length === 0 || binding} onClick={() => void bindToLatest(c.hash)}>
                          绑定到最近条目
                        </button>
                      )}
                    </li>
                  )
                })}
              </ul>
            ))}
        </section>
      )}

      {entries.length === 0 && !loading ? (
        <p className="muted">暂无条目</p>
      ) : (
        <ul className="entry-list">
          {entries.map((entry) => (
            <li key={entry.id} className={`entry-item entry-type-${entry.type}`}>
              <div className="entry-time-col">
                <span className="entry-time">{formatTime(entry.createdAt)}</span>
                <span className="entry-dot" aria-hidden="true" />
              </div>
              {editingId === entry.id ? (
                <div className="entry-card">
                  <div className="entry-meta">
                    <span className="entry-icon" aria-hidden="true">
                      {ENTRY_TYPE_ICONS[entry.type]}
                    </span>
                    <span className="entry-chip">{ENTRY_TYPE_LABELS[entry.type]}</span>
                    <span className="entry-seq">#{entry.seq}</span>
                  </div>
                  <div className="entry-edit">
                    <select
                      aria-label="编辑类型"
                      value={editType}
                      onChange={(e) => setEditType(e.target.value as EntryType)}
                    >
                      {ENTRY_TYPES.map((t) => (
                        <option key={t} value={t}>
                          {ENTRY_TYPE_LABELS[t]}
                        </option>
                      ))}
                    </select>
                    <textarea
                      aria-label="编辑内容"
                      value={editContent}
                      onChange={(e) => setEditContent(e.target.value)}
                    />
                    <button onClick={() => void submitEdit(entry)}>保存</button>
                    <button onClick={() => setEditingId(null)}>取消</button>
                  </div>
                </div>
              ) : (
                <EntryCard
                  entry={entry}
                  onEdit={(e) => {
                    setEditingId(e.id)
                    setEditType(e.type)
                    setEditContent(e.contentMd)
                  }}
                  onDelete={(e) => void handleDelete(e)}
                  onCommitClick={(e, hash) => openCommitDetail(e, hash)}
                />
              )}
            </li>
          ))}
        </ul>
      )}

      {loading && <p className="muted">加载中…</p>}
      <div ref={sentinelRef} className="entry-sentinel" aria-hidden="true" />

      <div className="quick-entry-bar">
        <div className="quick-entry">
          <select
            aria-label="类型"
            value={draftType}
            onChange={(e) => {
              const t = e.target.value as EntryType
              setDraftType(t)
              saveEntryType(t)
            }}
          >
            {typeOptions.map((t) => (
              <option key={t} value={t}>
                {ENTRY_TYPE_LABELS[t]}
              </option>
            ))}
          </select>
          <textarea
            ref={quickRef}
            aria-label="记录内容"
            placeholder="输入记录内容（Enter 发送，Shift+Enter 换行，Ctrl+E 聚焦）"
            value={draftContent}
            onChange={(e) => setDraftContent(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                void submitAdd()
              }
            }}
          />
          <button onClick={() => void submitAdd()} disabled={!draftContent.trim()}>
            追加
          </button>
        </div>
      </div>

      {detailTarget && (
        <CommitDetailModal
          commit={detailData}
          error={detailError}
          onClose={closeCommitDetail}
          onUnbind={() => void unbindFromDetail()}
        />
      )}
    </section>
  )
}
