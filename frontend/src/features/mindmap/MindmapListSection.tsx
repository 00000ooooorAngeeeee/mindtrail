import { useCallback, useEffect, useState } from 'react'
import { batchDeleteMindmaps, createMindmap, deleteMindmap, listMindmaps, renameMindmap } from '../../api/mindmaps'
import type { Mindmap, Workspace } from '../../api/types'
import { deleteWithUndo } from '../../utils/undoDelete'
import { BatchSelectToolbar } from '../../components/BatchSelectToolbar'
import { useBatchSelect } from '../../utils/useBatchSelect'
import { batchConfirmText } from '../../utils/batchSelection'
import { focusLeftEditor } from '../../utils/renameBlur'

/**
 * 导图列表区段（PRD B4，03 §3.2）：从工作区首页抽取为可复用区段，
 * 供悬浮岛式侧边栏「导图」组挂载。列表 + 行内重命名 + 新建 + 批量删除（二次确认）+
 * 单条删除带撤销轻提示（v1.2 P2「删除内容时采用带撤销操作的轻提示」）。
 *
 * 单条删除走 deleteWithUndo：乐观从列表移除（pendingDelete 过滤）→ 弹「已删除 · 撤销」toast →
 * 到期未撤销才真删；撤销则恢复。批量删除仍二次确认（多选破坏性强、撤销多对象复杂度收益低）。
 * 计数/空态经回调上报（侧边栏工作区行计数 + 右侧 overview 空态引导）。
 */
export function MindmapListSection({
  ws,
  onOpen,
  onCountChange,
  onEmptyChange,
  titleInputRef,
  suppressEmptyText = false,
}: {
  ws: Workspace
  onOpen: (id: number) => void
  onCountChange?: (count: number) => void
  onEmptyChange?: (empty: boolean) => void
  titleInputRef?: React.Ref<HTMLInputElement>
  /** 空态引导已接管展示时隐藏本区「暂无导图」文本（03 §7.1）。 */
  suppressEmptyText?: boolean
}) {
  const [mindmaps, setMindmaps] = useState<Mindmap[]>([])
  // undo 删除窗口：乐观移除但未真删的 id，列表渲染时过滤（避免重拉把项拉回）。
  const [pendingDelete, setPendingDelete] = useState<Set<number>>(() => new Set())
  const [name, setName] = useState('')
  const [loading, setLoading] = useState(false)
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const mmBatch = useBatchSelect(mindmaps.map((m) => m.id))

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      setMindmaps(await listMindmaps(ws.id))
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载导图失败')
    } finally {
      setLoading(false)
    }
  }, [ws.id])

  useEffect(() => {
    void load()
  }, [load])

  const visible = mindmaps.filter((m) => !pendingDelete.has(m.id))

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
    const trimmed = name.trim()
    if (!trimmed || creating) return
    setCreating(true)
    try {
      const created = await createMindmap(ws.id, trimmed)
      setMindmaps((prev) => [...prev, created])
      setName('')
    } catch (e) {
      setError(e instanceof Error ? e.message : '创建导图失败')
    } finally {
      setCreating(false)
    }
  }

  const handleDelete = (m: Mindmap) => {
    deleteWithUndo({
      label: `导图「${m.name}」`,
      performDelete: () => deleteMindmap(m.id),
      optimisticRemove: () => setPendingDelete((prev) => new Set(prev).add(m.id)),
      optimisticRestore: () =>
        setPendingDelete((prev) => {
          const next = new Set(prev)
          next.delete(m.id)
          return next
        }),
    })
  }

  // 批量删除导图（二次确认；04 §5 POST /mindmaps/batch-delete）
  const handleBatchDeleteMindmaps = async () => {
    const ids = mindmaps.filter((m) => mmBatch.selected.has(m.id)).map((m) => m.id)
    if (ids.length === 0) return
    if (!confirm(batchConfirmText('导图', ids.length))) return
    try {
      await batchDeleteMindmaps(ids)
      mmBatch.exit()
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : '批量删除导图失败')
    }
  }

  const handleRename = async (id: number, newName: string) => {
    try {
      const updated = await renameMindmap(id, newName)
      setMindmaps((prev) => prev.map((m) => (m.id === id ? updated : m)))
    } catch (e) {
      setError(e instanceof Error ? e.message : '重命名导图失败')
    }
  }

  return (
    <div className="mindmap-section">
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <BatchSelectToolbar
        batch={mmBatch}
        canEnter={mindmaps.length > 0}
        onDelete={() => void handleBatchDeleteMindmaps()}
      />
      {loading ? (
        <p className="muted">加载中…</p>
      ) : visible.length === 0 ? (
        suppressEmptyText ? null : <p className="muted">暂无导图</p>
      ) : (
        <ul className="workspace-list">
          {visible.map((m) => (
            <MindmapItem
              key={m.id}
              m={m}
              onOpen={onOpen}
              onRename={handleRename}
              onDelete={handleDelete}
              selectMode={mmBatch.selectMode}
              selected={mmBatch.selected.has(m.id)}
              onToggleSelect={mmBatch.toggle}
            />
          ))}
        </ul>
      )}

      <div className="create-form">
        <input
          ref={titleInputRef}
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void handleCreate()
          }}
          placeholder="输入导图名称"
        />
        <button onClick={() => void handleCreate()} disabled={!name.trim() || creating}>
          {creating ? '创建中…' : '新建导图'}
        </button>
      </div>
    </div>
  )
}

/** 导图列表项（PRD B4）：行内重命名（与工作区重命名同款交互）。 */
function MindmapItem({
  m,
  onOpen,
  onRename,
  onDelete,
  selectMode = false,
  selected = false,
  onToggleSelect,
}: {
  m: Mindmap
  onOpen: (id: number) => void
  onRename: (id: number, name: string) => Promise<void>
  onDelete: (m: Mindmap) => void
  selectMode?: boolean
  selected?: boolean
  onToggleSelect?: (id: number) => void
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(m.name)

  const submit = async () => {
    const trimmed = draft.trim()
    if (!trimmed || trimmed === m.name) {
      setEditing(false)
      return
    }
    await onRename(m.id, trimmed)
    setEditing(false)
  }

  return (
    <li className={`workspace-item${selected ? ' selected' : ''}`}>
      {selectMode ? (
        <>
          <input
            type="checkbox"
            className="batch-checkbox"
            checked={selected}
            onChange={() => onToggleSelect?.(m.id)}
            aria-label={`选择 ${m.name}`}
          />
          <button className="item-name" onClick={() => onToggleSelect?.(m.id)}>
            {m.name}
            <span className="item-stats">{m.nodeCount ?? 0} 节点</span>
          </button>
        </>
      ) : editing ? (
        <span className="item-edit">
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void submit()}
            onBlur={(e) => {
              if (focusLeftEditor(e.relatedTarget)) setEditing(false)
            }}
            autoFocus
          />
          <button onClick={() => void submit()}>保存</button>
          <button onClick={() => setEditing(false)}>取消</button>
        </span>
      ) : (
        <>
          <button className="item-name" onClick={() => onOpen(m.id)}>
            {m.name}
            <span className="item-stats">{m.nodeCount ?? 0} 节点</span>
          </button>
          <button onClick={() => onOpen(m.id)}>打开</button>
          <button
            onClick={() => {
              setDraft(m.name)
              setEditing(true)
            }}
          >
            重命名
          </button>
          <button className="danger" onClick={() => onDelete(m)}>
            删除
          </button>
        </>
      )}
    </li>
  )
}
