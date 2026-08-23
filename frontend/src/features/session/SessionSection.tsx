import { useCallback, useEffect, useState } from 'react'
import { batchDeleteSessions, createSession, deleteSession, listSessions } from '../../api/sessions'
import type { Session, Workspace } from '../../api/types'
import { formatTime } from './time'
import { deleteWithUndo } from '../../utils/undoDelete'
import { BatchSelectToolbar } from '../../components/BatchSelectToolbar'
import { useBatchSelect } from '../../utils/useBatchSelect'
import { batchConfirmText } from '../../utils/batchSelection'

/**
 * 会话列表区段（07 §6 任务一）：列表（标题/状态徽标/条目数/开始时间，时间序）+ 开始会话 +
 * 单条删除带撤销轻提示（v1.2 P2）+ 批量删除（二次确认，级联条目）。
 * 供悬浮岛式侧边栏「会话」组挂载；时间序 + 状态点体现「时间轴展示」。
 *
 * 单条删除走 deleteWithUndo：乐观移除（pendingDelete 过滤）→ 撤销 toast → 到期真删；撤销恢复。
 * 计数/空态随可见列表上报（侧边栏工作区行计数 + 右侧 overview 空态引导）。
 * M4 任务五：titleInputRef 供空态引导聚焦；suppressEmptyText 由空态引导接管时隐藏「暂无会话」。
 */
export function SessionSection({
  ws,
  onOpenSession,
  titleInputRef,
  onEmptyChange,
  onCountChange,
  suppressEmptyText = false,
}: {
  ws: Workspace
  onOpenSession: (id: number) => void
  titleInputRef?: React.Ref<HTMLInputElement>
  onEmptyChange?: (empty: boolean) => void
  onCountChange?: (count: number) => void
  suppressEmptyText?: boolean
}) {
  const [sessions, setSessions] = useState<Session[]>([])
  // undo 删除窗口：乐观移除但未真删的 id，渲染时过滤（避免重拉把项拉回）。
  const [pendingDelete, setPendingDelete] = useState<Set<number>>(() => new Set())
  const [title, setTitle] = useState('')
  const [loading, setLoading] = useState(false)
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // 批量删除（会话列表，「选择模式」开关 + 复选框 + 全选，04 §5）
  const sBatch = useBatchSelect(sessions.map((s) => s.id))

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      setSessions(await listSessions(ws.id))
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载会话失败')
    } finally {
      setLoading(false)
    }
  }, [ws.id])

  useEffect(() => {
    void load()
  }, [load])

  const visible = sessions.filter((s) => !pendingDelete.has(s.id))

  // 计数/空态随可见列表上报（乐观移除即时反映）。
  useEffect(() => {
    onCountChange?.(visible.length)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible.length])
  useEffect(() => {
    onEmptyChange?.(visible.length === 0)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible.length])

  const handleCreate = async () => {
    const trimmed = title.trim()
    if (!trimmed || creating) return
    setCreating(true)
    try {
      const created = await createSession(ws.id, { title: trimmed })
      setSessions((prev) => [...prev, created])
      setTitle('')
    } catch (e) {
      setError(e instanceof Error ? e.message : '开始会话失败')
    } finally {
      setCreating(false)
    }
  }

  const handleDelete = (s: Session) => {
    deleteWithUndo({
      label: `会话「${s.title}」`,
      performDelete: () => deleteSession(s.id),
      optimisticRemove: () => setPendingDelete((prev) => new Set(prev).add(s.id)),
      optimisticRestore: () =>
        setPendingDelete((prev) => {
          const next = new Set(prev)
          next.delete(s.id)
          return next
        }),
    })
  }

  // 批量删除会话（二次确认，级联条目；04 §5 POST /sessions/batch-delete）
  const handleBatchDeleteSessions = async () => {
    const ids = sessions.filter((s) => sBatch.selected.has(s.id)).map((s) => s.id)
    if (ids.length === 0) return
    if (!confirm(batchConfirmText('会话', ids.length))) return
    try {
      await batchDeleteSessions(ids)
      sBatch.exit()
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : '批量删除会话失败')
    }
  }

  return (
    <div className="session-section">
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <BatchSelectToolbar
        batch={sBatch}
        canEnter={sessions.length > 0}
        onDelete={() => void handleBatchDeleteSessions()}
      />
      {loading ? (
        <p className="muted">加载中…</p>
      ) : visible.length === 0 ? (
        suppressEmptyText ? null : <p className="muted">暂无会话</p>
      ) : (
        <ul className="session-timeline-list">
          {visible.map((s) => (
            <li
              key={s.id}
              className={`session-timeline-item${sBatch.selected.has(s.id) ? ' selected' : ''}`}
            >
              {sBatch.selectMode ? (
                <>
                  <input
                    type="checkbox"
                    className="batch-checkbox"
                    checked={sBatch.selected.has(s.id)}
                    onChange={() => sBatch.toggle(s.id)}
                    aria-label={`选择 ${s.title}`}
                  />
                  <button className="item-name" onClick={() => sBatch.toggle(s.id)}>
                    {s.title}
                    <span className="item-stats">
                      {s.entryCount ?? 0} 条 · {formatTime(s.startedAt)}
                    </span>
                  </button>
                  <span className={`status-badge status-${s.status}`}>
                    {s.status === 'completed' ? '已完成' : '进行中'}
                  </span>
                </>
              ) : (
                <>
                  <span className={`session-timeline-dot status-${s.status}`} aria-hidden="true" />
                  <button className="item-name" onClick={() => onOpenSession(s.id)}>
                    {s.title}
                    <span className="item-stats">
                      {s.entryCount ?? 0} 条 · {formatTime(s.startedAt)}
                    </span>
                  </button>
                  <span className={`status-badge status-${s.status}`}>
                    {s.status === 'completed' ? '已完成' : '进行中'}
                  </span>
                  <button className="danger" onClick={() => handleDelete(s)}>
                    删除
                  </button>
                </>
              )}
            </li>
          ))}
        </ul>
      )}

      <div className="create-form">
        <input
          ref={titleInputRef}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void handleCreate()
          }}
          placeholder="输入会话标题"
        />
        <button onClick={() => void handleCreate()} disabled={!title.trim() || creating}>
          {creating ? '开始中…' : '开始会话'}
        </button>
      </div>
    </div>
  )
}
