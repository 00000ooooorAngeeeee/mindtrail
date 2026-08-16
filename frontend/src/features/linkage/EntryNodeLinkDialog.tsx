// 条目引用节点管理对话框（v1.1 P1）：选导图 → 节点搜索/浏览 → 勾选后「先清后插」替换保存
// （PUT /entries/{id}/nodes，可跨导图）。选中态键为 `mindmapId:nodeId`（同一节点 id 可在多张图出现）。
import { useCallback, useEffect, useRef, useState } from 'react'
import { replaceEntryNodes, searchMindmapNodes } from '../../api/linkage'
import { listMindmaps } from '../../api/mindmaps'
import type { Mindmap, NodeHit, NodeRef } from '../../api/types'
import { toggleSelection } from './linkage'

export function EntryNodeLinkDialog({
  entryId,
  workspaceId,
  initialRefs,
  onClose,
  onSaved,
}: {
  entryId: number
  workspaceId: number
  /** 当前已引用的节点（勾选初始态）。 */
  initialRefs: NodeRef[]
  onClose: () => void
  onSaved: () => void
}) {
  const [mindmaps, setMindmaps] = useState<Mindmap[]>([])
  const [mindmapId, setMindmapId] = useState<number | null>(null)
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<NodeHit[]>([])
  const [checked, setChecked] = useState<string[]>(() => initialRefs.map((r) => `${r.mindmapId}:${r.nodeId}`))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // 工作区导图列表，默认选中第一张
  useEffect(() => {
    listMindmaps(workspaceId)
      .then((rows) => {
        setMindmaps(rows)
        if (rows.length > 0) setMindmapId(rows[0].id)
      })
      .catch(() => setMindmaps([]))
  }, [workspaceId])

  const loadNodes = useCallback((mid: number, kw: string) => {
    if (timerRef.current) clearTimeout(timerRef.current)
    const trimmed = kw.trim()
    timerRef.current = setTimeout(() => {
      searchMindmapNodes(mid, trimmed || undefined)
        .then(setHits)
        .catch(() => setHits([]))
    }, trimmed ? 300 : 0)
  }, [])

  useEffect(() => {
    if (mindmapId == null) {
      setHits([])
      return
    }
    loadNodes(mindmapId, query)
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [mindmapId, query, loadNodes])

  const toggle = (key: string) => setChecked((cur) => toggleSelection(cur, key))

  const save = async () => {
    setSaving(true)
    setError(null)
    try {
      const links = checked.map((key) => {
        const [mid, nid] = key.split(':')
        return { mindmapId: Number(mid), nodeId: nid }
      })
      await replaceEntryNodes(entryId, links)
      onSaved()
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : '保存失败')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="mm-dialog-mask">
      <div className="mm-dialog mm-links-dialog" role="dialog" aria-label="引用节点">
        <p className="mm-dialog-title">引用导图节点</p>
        <div className="mm-links-search">
          <select
            value={mindmapId ?? ''}
            onChange={(e) => {
              const mid = Number(e.target.value)
              setMindmapId(Number.isFinite(mid) ? mid : null)
              setQuery('')
            }}
            aria-label="选择导图"
          >
            {mindmaps.length === 0 && <option value="">暂无导图</option>}
            {mindmaps.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索节点文本…"
            aria-label="搜索节点"
          />
        </div>
        <div className="mm-links-list">
          {mindmapId == null ? (
            <div className="mm-links-empty">请先选择导图</div>
          ) : hits.length === 0 ? (
            <div className="mm-links-empty">未找到节点</div>
          ) : (
            hits.map((h) => {
              const key = `${mindmapId}:${h.nodeId}`
              return (
                <label key={key} className="mm-links-row">
                  <input type="checkbox" checked={checked.includes(key)} onChange={() => toggle(key)} />
                  <span className="mm-links-row-main">
                    <span className="mm-links-row-title">{h.text || '（空白便签）'}</span>
                    <span className="mm-links-row-sub">{h.path}</span>
                  </span>
                </label>
              )
            })
          )}
        </div>
        {error && <div className="mm-links-error-banner" role="alert">{error}</div>}
        <div className="mm-links-dialog-actions">
          <span className="mm-links-count">已选 {checked.length} 个节点</span>
          <button onClick={onClose}>取消</button>
          <button className="primary" onClick={() => void save()} disabled={saving}>
            {saving ? '保存中…' : '保存'}
          </button>
        </div>
      </div>
    </div>
  )
}
