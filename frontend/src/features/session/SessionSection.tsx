import { useCallback, useEffect, useState } from 'react'
import { createSession, deleteSession, listSessions } from '../../api/sessions'
import type { Session, Workspace } from '../../api/types'
import { formatTime } from './time'

/**
 * 工作区首页的会话区（07 §6 任务一）：
 * 列表（标题/状态徽标/条目数/开始时间）、开始会话（仓库缺省继承工作区）、删除（二次确认，级联条目）。
 */
export function SessionSection({
  ws,
  onOpenSession,
}: {
  ws: Workspace
  onOpenSession: (id: number) => void
}) {
  const [sessions, setSessions] = useState<Session[]>([])
  const [title, setTitle] = useState('')
  const [loading, setLoading] = useState(false)
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)

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

  const handleDelete = async (id: number) => {
    if (!confirm('删除该会话及其全部条目？')) return
    try {
      await deleteSession(id)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : '删除会话失败')
    }
  }

  return (
    <div className="session-section">
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {loading ? (
        <p className="muted">加载中…</p>
      ) : sessions.length === 0 ? (
        <p className="muted">暂无会话</p>
      ) : (
        <ul className="workspace-list">
          {sessions.map((s) => (
            <li key={s.id} className="workspace-item">
              <button className="item-name" onClick={() => onOpenSession(s.id)}>
                {s.title}
                <span className="item-stats">
                  {s.entryCount ?? 0} 条 · {formatTime(s.startedAt)}
                </span>
              </button>
              <span className={`status-badge status-${s.status}`}>
                {s.status === 'completed' ? '已完成' : '进行中'}
              </span>
              <button className="danger" onClick={() => void handleDelete(s.id)}>
                删除
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="create-form">
        <input
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
