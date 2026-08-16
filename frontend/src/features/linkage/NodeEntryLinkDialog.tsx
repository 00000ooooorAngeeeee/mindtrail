// 节点挂接条目管理对话框（v1.1 P1）：搜索（type=entry + workspaceId 圈定）+ 工作区最近条目，
// 勾选后「先清后插」替换保存（PUT /mindmaps/{id}/nodes/{nodeId}/links）。
import { useEffect, useMemo, useRef, useState } from 'react'
import { getRecentEntries, replaceNodeLinks } from '../../api/linkage'
import { searchGlobal } from '../../api/search'
import {
  ENTRY_TYPE_ICONS,
  type RecentEntry,
  type SearchEntryHit,
  type SearchResults,
} from '../../api/types'
import { previewLine, toggleSelection } from './linkage'

/** 勾选候选行：最近条目与搜索命中统一形状。 */
type Candidate = {
  entryId: number
  sessionId: number
  sessionTitle: string
  seq: number
  type: SearchEntryHit['type']
  snippet: string
}

function toCandidate(r: RecentEntry): Candidate {
  return { entryId: r.entryId, sessionId: r.sessionId, sessionTitle: r.sessionTitle, seq: r.seq, type: r.type, snippet: r.contentMd }
}

function hitToCandidate(h: SearchEntryHit): Candidate {
  return { entryId: h.id, sessionId: h.sessionId, sessionTitle: h.sessionTitle, seq: h.seq, type: h.type, snippet: h.snippet }
}

export function NodeEntryLinkDialog({
  mindmapId,
  nodeId,
  workspaceId,
  initialEntryIds,
  onClose,
  onSaved,
}: {
  mindmapId: number
  nodeId: string
  workspaceId: number
  /** 当前已挂接的条目 id（勾选初始态）。 */
  initialEntryIds: number[]
  onClose: () => void
  /** 保存成功后回调（父级刷新挂接图）。 */
  onSaved: () => void
}) {
  const [query, setQuery] = useState('')
  const [recent, setRecent] = useState<Candidate[]>([])
  const [hits, setHits] = useState<Candidate[]>([])
  const [checked, setChecked] = useState<number[]>(initialEntryIds)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // 最近条目（挂接候选，按创建时间倒序）
  useEffect(() => {
    getRecentEntries(workspaceId)
      .then((rows) => setRecent(rows.map(toCandidate)))
      .catch(() => setRecent([]))
  }, [workspaceId])

  // 关键词防抖 300ms 搜索（复用 M4 全局搜索数据源，type=entry + workspaceId 圈定）
  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current)
    const kw = query.trim()
    if (!kw) {
      setHits([])
      return
    }
    timerRef.current = setTimeout(() => {
      searchGlobal(kw, { type: 'entry', workspaceId })
        .then((r: SearchResults) => setHits(r.entries.map(hitToCandidate)))
        .catch(() => setHits([]))
    }, 300)
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [query, workspaceId])

  const toggle = (id: number) => setChecked((cur) => toggleSelection(cur, id))

  const save = async () => {
    setSaving(true)
    setError(null)
    try {
      await replaceNodeLinks(mindmapId, nodeId, checked)
      onSaved()
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : '保存失败')
    } finally {
      setSaving(false)
    }
  }

  const renderRow = (c: Candidate) => (
    <label key={c.entryId} className="mm-links-row">
      <input type="checkbox" checked={checked.includes(c.entryId)} onChange={() => toggle(c.entryId)} />
      <span aria-hidden="true">{ENTRY_TYPE_ICONS[c.type]}</span>
      <span className="mm-links-row-main">
        <span className="mm-links-row-title">
          {c.sessionTitle} <span className="muted">#{c.seq}</span>
        </span>
        <span className="mm-links-row-sub">{previewLine(c.snippet)}</span>
      </span>
    </label>
  )

  return (
    <div className="mm-dialog-mask">
      <div className="mm-dialog mm-links-dialog" role="dialog" aria-label="挂接条目">
        <p className="mm-dialog-title">挂接条目到节点</p>
        <div className="mm-links-search">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索条目关键词…"
            aria-label="搜索条目"
            autoFocus
          />
        </div>
        <div className="mm-links-list">
          {query.trim() ? (
            <>
              <div className="mm-links-section">搜索结果</div>
              {hits.length === 0 ? (
                <div className="mm-links-empty">未找到，试试其他关键词</div>
              ) : (
                hits.map(renderRow)
              )}
            </>
          ) : (
            <>
              <div className="mm-links-section">最近条目</div>
              {recent.length === 0 ? (
                <div className="mm-links-empty">还没有可挂接的条目</div>
              ) : (
                recent.map(renderRow)
              )}
            </>
          )}
        </div>
        {error && <div className="mm-links-error-banner" role="alert">{error}</div>}
        <div className="mm-links-dialog-actions">
          <span className="mm-links-count">已选 {checked.length} 条</span>
          <button onClick={onClose}>取消</button>
          <button className="primary" onClick={() => void save()} disabled={saving}>
            {saving ? '保存中…' : '保存'}
          </button>
        </div>
      </div>
    </div>
  )
}
