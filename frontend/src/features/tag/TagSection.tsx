import { useCallback, useEffect, useState } from 'react'
import { batchDeleteTags, createTag, deleteTag, filterEntriesByTag, listTags, mergeTag, renameTag } from '../../api/tags'
import type { TagInfo, TaggedEntry, Workspace } from '../../api/types'
import { ENTRY_TYPE_LABELS } from '../../api/types'
import { formatTime } from '../session/time'
import { TagCloud } from './TagCloud'
import { BatchSelectToolbar } from '../../components/BatchSelectToolbar'
import { useBatchSelect } from '../../utils/useBatchSelect'
import { batchConfirmText } from '../../utils/batchSelection'
import { focusLeftEditor } from '../../utils/renameBlur'
import './tag.css'

/**
 * 工作区首页标签面板（M4 任务二 + v1.1 P1，PRD D3/D4 + 03 §3.2 侧边栏「标签」）：
 * 标签云（v1.1 P1：热度分档字号可视化 + 点击过滤）、标签列表（名称 + 使用计数）、
 * 创建/重命名/合并/删除（D3 工作区级管理）、点击标签即时过滤条目（D4「过滤即时生效」，
 * 后端 GET /entries?tagId=），过滤结果点击跳转会话并定位条目（复用搜索跳转的 seq 分页估算）。
 */
export function TagSection({
  ws,
  onOpenSessionEntry,
}: {
  ws: Workspace
  /** 跳转：定位到会话内条目（page 由父级按 seq 估算）。 */
  onOpenSessionEntry: (sessionId: number, entryId: number, seq: number) => void
}) {
  const [tags, setTags] = useState<TagInfo[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [name, setName] = useState('')

  const [editingId, setEditingId] = useState<number | null>(null)
  const [draft, setDraft] = useState('')
  const [mergingId, setMergingId] = useState<number | null>(null)
  const [mergeTarget, setMergeTarget] = useState<number | null>(null)

  // 过滤视图：filterTag 非空时展示该标签命中的条目
  const [filterTag, setFilterTag] = useState<TagInfo | null>(null)
  const [filtered, setFiltered] = useState<TaggedEntry[]>([])
  const [filterLoading, setFilterLoading] = useState(false)
  // 批量删除（标签列表，「选择模式」开关 + 复选框 + 全选，04 §5）
  const tBatch = useBatchSelect(tags.map((t) => t.id))

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      setTags(await listTags(ws.id))
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载标签失败')
    } finally {
      setLoading(false)
    }
  }, [ws.id])

  useEffect(() => {
    void load()
  }, [load])

  const openFilter = async (tag: TagInfo) => {
    setFilterTag(tag)
    setFilterLoading(true)
    try {
      setFiltered(await filterEntriesByTag(tag.id))
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : '按标签过滤失败')
      setFiltered([])
    } finally {
      setFilterLoading(false)
    }
  }

  const handleCreate = async () => {
    const trimmed = name.trim()
    if (!trimmed) return
    try {
      await createTag(ws.id, trimmed)
      setName('')
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : '创建标签失败')
    }
  }

  const submitRename = async (id: number) => {
    const trimmed = draft.trim()
    if (!trimmed || trimmed === tags.find((t) => t.id === id)?.name) {
      setEditingId(null)
      return
    }
    try {
      await renameTag(id, trimmed)
      setEditingId(null)
      await load()
      if (filterTag?.id === id) setFilterTag({ ...filterTag, name: trimmed })
    } catch (e) {
      setError(e instanceof Error ? e.message : '重命名失败')
    }
  }

  const submitMerge = async (sourceId: number) => {
    if (mergeTarget == null || mergeTarget === sourceId) return
    try {
      await mergeTag(sourceId, mergeTarget)
      setMergingId(null)
      setMergeTarget(null)
      await load()
      if (filterTag?.id === sourceId) {
        const target = tags.find((t) => t.id === mergeTarget)
        if (target) await openFilter(target)
        else setFilterTag(null)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : '合并标签失败')
    }
  }

  const handleDelete = async (tag: TagInfo) => {
    if (!confirm(`删除标签「${tag.name}」？关联条目不会删除，仅解除标签。`)) return
    try {
      await deleteTag(tag.id)
      if (filterTag?.id === tag.id) {
        setFilterTag(null)
        setFiltered([])
      }
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : '删除标签失败')
    }
  }

  // 批量删除标签（二次确认，仅解除关联不删条目；04 §5 POST /tags/batch-delete）
  const handleBatchDeleteTags = async () => {
    const ids = tags.filter((t) => tBatch.selected.has(t.id)).map((t) => t.id)
    if (ids.length === 0) return
    if (!confirm(batchConfirmText('标签', ids.length))) return
    try {
      await batchDeleteTags(ids)
      if (filterTag && ids.includes(filterTag.id)) {
        setFilterTag(null)
        setFiltered([])
      }
      tBatch.exit()
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : '批量删除标签失败')
    }
  }

  const firstLine = (md: string) => md.split('\n')[0].trim()

  return (
    <div className="tag-section">
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <BatchSelectToolbar
        batch={tBatch}
        canEnter={tags.length > 0}
        onDelete={() => void handleBatchDeleteTags()}
      />
      {loading ? (
        <p className="muted">加载中…</p>
      ) : tags.length === 0 ? (
        <p className="muted">暂无标签（在条目中加标签会自动创建）</p>
      ) : (
        <>
          {/* 标签云（v1.1 P1，PRD D4「标签云视图 P1」）：热度分档字号 + 点击过滤 */}
          <TagCloud tags={tags} activeTagId={filterTag?.id} onPick={(t) => void openFilter(t)} />
          <ul className="tag-list">
          {tags.map((t) => (
            <li key={t.id} className={`tag-row${tBatch.selected.has(t.id) ? ' selected' : ''}`}>
              {tBatch.selectMode ? (
                <>
                  <input
                    type="checkbox"
                    className="batch-checkbox"
                    checked={tBatch.selected.has(t.id)}
                    onChange={() => tBatch.toggle(t.id)}
                    aria-label={`选择 ${t.name}`}
                  />
                  <button className="tag-name" onClick={() => tBatch.toggle(t.id)}>
                    {t.name}
                    <span className="tag-count">{t.entryCount}</span>
                  </button>
                </>
              ) : editingId === t.id ? (
                <span className="item-edit">
                  <input
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && void submitRename(t.id)}
                    onBlur={(e) => { if (focusLeftEditor(e.relatedTarget)) setEditingId(null) }}
                    autoFocus
                  />
                  <button onClick={() => void submitRename(t.id)}>保存</button>
                  <button onClick={() => setEditingId(null)}>取消</button>
                </span>
              ) : mergingId === t.id ? (
                <span className="item-edit">
                  <select aria-label="合并目标" value={mergeTarget ?? ''} onChange={(e) => setMergeTarget(Number(e.target.value))}>
                    <option value="" disabled>
                      选择目标标签
                    </option>
                    {tags
                      .filter((o) => o.id !== t.id)
                      .map((o) => (
                        <option key={o.id} value={o.id}>
                          {o.name}
                        </option>
                      ))}
                  </select>
                  <button disabled={mergeTarget == null} onClick={() => void submitMerge(t.id)}>
                    确认合并
                  </button>
                  <button onClick={() => setMergingId(null)}>取消</button>
                </span>
              ) : (
                <>
                  <button
                    className={`tag-name${filterTag?.id === t.id ? ' active' : ''}`}
                    aria-label={t.name}
                    onClick={() => void openFilter(t)}
                  >
                    {t.name}
                    <span className="tag-count">{t.entryCount}</span>
                  </button>
                  <button
                    onClick={() => {
                      setDraft(t.name)
                      setEditingId(t.id)
                    }}
                  >
                    重命名
                  </button>
                  <button
                    disabled={tags.length < 2}
                    onClick={() => {
                      setMergingId(t.id)
                      setMergeTarget(null)
                    }}
                  >
                    合并
                  </button>
                  <button className="danger" onClick={() => void handleDelete(t)}>
                    删除
                  </button>
                </>
              )}
            </li>
          ))}
          </ul>
        </>
      )}

      <div className="create-form">
        <input value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void handleCreate()} placeholder="输入新标签名" />
        <button onClick={() => void handleCreate()} disabled={!name.trim()}>
          新建标签
        </button>
      </div>

      {filterTag && (
        <div className="tag-filter-panel" data-testid="tag-filter-panel">
          <h4>
            标签「{filterTag.name}」的条目
            <button onClick={() => setFilterTag(null)}>关闭</button>
          </h4>
          {filterLoading ? (
            <p className="muted">过滤中…</p>
          ) : filtered.length === 0 ? (
            <p className="muted">该标签暂无条目</p>
          ) : (
            <ul className="tag-filter-list">
              {filtered.map((e) => (
                <li key={e.id}>
                  <button className="tag-filter-hit" onClick={() => onOpenSessionEntry(e.sessionId, e.id, e.seq)}>
                    <span className="tag-filter-title">
                      #{e.seq} {ENTRY_TYPE_LABELS[e.type]} · {e.sessionTitle}
                    </span>
                    <span className="tag-filter-snippet">{firstLine(e.contentMd)}</span>
                    <span className="tag-filter-meta">
                      {e.workspaceName} · {formatTime(e.createdAt)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
