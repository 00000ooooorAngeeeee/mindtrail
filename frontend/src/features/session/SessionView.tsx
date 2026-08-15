import { useCallback, useEffect, useRef, useState } from 'react'
import { addEntry, deleteEntry, updateEntry } from '../../api/entries'
import { getSession, updateSession } from '../../api/sessions'
import {
  ENTRY_TYPE_ICONS,
  ENTRY_TYPE_LABELS,
  ENTRY_TYPES,
  type Entry,
  type EntryType,
  type Session,
} from '../../api/types'
import { loadEntryType, saveEntryType } from './typeMemory'
import { useInfiniteScroll } from './useInfiniteScroll'
import { formatTime } from './time'
import './session.css'

const PAGE_SIZE = 50

/**
 * 会话详情页（时间线，07 §6 任务二）：
 * 头部（标题/状态/时间跨度/条目数）、垂直时间线（类型着色 + 图标 + 时间戳列，无限滚动每页 50）、
 * 底部常驻快速记录框（Enter 提交、Shift+Enter 换行、类型记忆、Ctrl+E 聚焦）、
 * 条目编辑/删除、结束会话（总结写入 review 条目）。
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
        {!completed && (
          <button onClick={() => setCompleting(true)}>结束会话</button>
        )}
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
              <div className="entry-card">
                <div className="entry-meta">
                  <span className="entry-icon" aria-hidden="true">
                    {ENTRY_TYPE_ICONS[entry.type]}
                  </span>
                  <span className="entry-chip">{ENTRY_TYPE_LABELS[entry.type]}</span>
                  <span className="entry-seq">#{entry.seq}</span>
                </div>
                {editingId === entry.id ? (
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
                ) : (
                  <>
                    <pre className="entry-content">{entry.contentMd}</pre>
                    {entry.tags && entry.tags.length > 0 && (
                      <div className="entry-tags">
                        {entry.tags.map((t) => (
                          <span key={t} className="tag-chip">
                            {t}
                          </span>
                        ))}
                      </div>
                    )}
                    <div className="entry-actions">
                      <button
                        onClick={() => {
                          setEditingId(entry.id)
                          setEditType(entry.type)
                          setEditContent(entry.contentMd)
                        }}
                      >
                        编辑
                      </button>
                      <button className="danger" onClick={() => void handleDelete(entry)}>
                        删除
                      </button>
                    </div>
                  </>
                )}
              </div>
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
    </section>
  )
}
