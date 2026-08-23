import { useEffect, useRef, useState } from 'react'
import type { Workspace } from '../../api/types'
import type { BatchSelect } from '../../utils/useBatchSelect'
import { focusLeftEditor } from '../../utils/renameBlur'
import { MindmapListSection } from '../mindmap/MindmapListSection'
import { SessionSection } from '../session/SessionSection'
import { BatchSelectToolbar } from '../../components/BatchSelectToolbar'
import './sidebar.css'

/** 工作区实时状态（侧边栏行计数 + 右侧 overview 空态引导）。 */
export interface WorkspaceStatus {
  mindmapCount: number
  sessionCount: number
  mindmapsEmpty: boolean
  sessionsEmpty: boolean
}

interface SidebarProps {
  workspaces: Workspace[]
  selectedWsId: number | null
  onSelectWorkspace: (ws: Workspace) => void
  onCreateWorkspace: (name: string) => Promise<void>
  creatingWorkspace: boolean
  onRenameWorkspace: (id: number, name: string) => Promise<void>
  /** App 侧接 deleteWithUndo（pending 过滤 workspaces 列表 + 延迟 remove）。 */
  onDeleteWorkspace: (ws: Workspace) => void
  onBatchDeleteWorkspaces: () => Promise<void>
  wsBatch: BatchSelect
  onOpenMindmap: (id: number) => void
  onOpenSession: (id: number) => void
  onOpenTags: (ws: Workspace) => void
  onStatusChange: (wsId: number, status: WorkspaceStatus) => void
  /** 空态引导入口聚焦信号（递增触发）。 */
  mindmapFocusSignal: number
  sessionFocusSignal: number
}

/**
 * 悬浮岛式可隐藏多级侧边栏（v1.2 P2「美化前端样式」）：
 * 全部工作区作父节点树，展开 → 导图 / 会话（时间序+状态点）/ 标签 三组。
 * 导图/会话组内联列表区段（MindmapListSection/SessionSection，含 undo 删除 + 批量），
 * 点击导图/会话项 → 右侧显示；标签组点击 → 右侧标签云。
 * 工作区行：改名 + undo 删除 + 批量；新建工作区置顶。状态/空态上报供右侧 overview。
 */
export function Sidebar(props: SidebarProps) {
  const [expanded, setExpanded] = useState<Set<number>>(() => new Set())
  const [statusByWs, setStatusByWs] = useState<Record<number, WorkspaceStatus>>({})
  const [wsName, setWsName] = useState('')
  const mmInputRef = useRef<HTMLInputElement>(null)
  const ssInputRef = useRef<HTMLInputElement>(null)

  // 选中工作区自动展开（空态引导聚焦其创建输入框前置条件）。
  useEffect(() => {
    if (props.selectedWsId != null && !expanded.has(props.selectedWsId)) {
      setExpanded((prev) => new Set(prev).add(props.selectedWsId!))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.selectedWsId])

  // 选中工作区状态变化 → 上报 App（右侧 overview 计数 + 空态引导）。
  useEffect(() => {
    if (props.selectedWsId == null) return
    const st = statusByWs[props.selectedWsId]
    if (st) props.onStatusChange(props.selectedWsId, st)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.selectedWsId, statusByWs])

  // 空态引导「新建第一张导图 / 开始第一次会话」→ 聚焦侧边栏对应创建输入框。
  useEffect(() => {
    if (props.mindmapFocusSignal === 0) return
    mmInputRef.current?.focus()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.mindmapFocusSignal])
  useEffect(() => {
    if (props.sessionFocusSignal === 0) return
    ssInputRef.current?.focus()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.sessionFocusSignal])

  const toggleExpand = (id: number) =>
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const reportStatus = (wsId: number, partial: Partial<WorkspaceStatus>) =>
    setStatusByWs((prev) => ({
      ...prev,
      [wsId]: {
        mindmapCount: prev[wsId]?.mindmapCount ?? 0,
        sessionCount: prev[wsId]?.sessionCount ?? 0,
        mindmapsEmpty: prev[wsId]?.mindmapsEmpty ?? false,
        sessionsEmpty: prev[wsId]?.sessionsEmpty ?? false,
        ...partial,
      },
    }))

  const handleCreate = async () => {
    const trimmed = wsName.trim()
    if (!trimmed || props.creatingWorkspace) return
    await props.onCreateWorkspace(trimmed)
    setWsName('')
  }

  return (
    <nav className="sidebar-tree" aria-label="工作区导航">
      <div className="sidebar-create">
        <input
          value={wsName}
          onChange={(e) => setWsName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void handleCreate()
          }}
          placeholder="输入工作区名称"
        />
        <button onClick={() => void handleCreate()} disabled={!wsName.trim() || props.creatingWorkspace}>
          {props.creatingWorkspace ? '创建中…' : '新建工作区'}
        </button>
      </div>

      <BatchSelectToolbar
        batch={props.wsBatch}
        canEnter={props.workspaces.length > 0}
        onDelete={() => void props.onBatchDeleteWorkspaces()}
      />

      {props.workspaces.length === 0 ? (
        <p className="muted sidebar-empty">暂无工作区</p>
      ) : (
        props.workspaces.map((ws) => (
          <WorkspaceNode
            key={ws.id}
            ws={ws}
            expanded={expanded.has(ws.id)}
            selected={props.selectedWsId === ws.id}
            batchSelectMode={props.wsBatch.selectMode}
            batchSelected={props.wsBatch.selected.has(ws.id)}
            onToggleSelect={props.wsBatch.toggle}
            onToggleExpand={() => toggleExpand(ws.id)}
            onSelect={() => props.onSelectWorkspace(ws)}
            onRename={props.onRenameWorkspace}
            onDelete={props.onDeleteWorkspace}
            status={statusByWs[ws.id]}
            isFocusTarget={props.selectedWsId === ws.id}
            mmInputRef={props.selectedWsId === ws.id ? mmInputRef : undefined}
            ssInputRef={props.selectedWsId === ws.id ? ssInputRef : undefined}
            onOpenMindmap={props.onOpenMindmap}
            onOpenSession={props.onOpenSession}
            onOpenTags={props.onOpenTags}
            onStatusChange={reportStatus}
          />
        ))
      )}
    </nav>
  )
}

interface WorkspaceNodeProps {
  ws: Workspace
  expanded: boolean
  selected: boolean
  batchSelectMode: boolean
  batchSelected: boolean
  onToggleSelect: (id: number) => void
  onToggleExpand: () => void
  onSelect: () => void
  onRename: (id: number, name: string) => Promise<void>
  onDelete: (ws: Workspace) => void
  status?: WorkspaceStatus
  isFocusTarget: boolean
  mmInputRef?: React.Ref<HTMLInputElement>
  ssInputRef?: React.Ref<HTMLInputElement>
  onOpenMindmap: (id: number) => void
  onOpenSession: (id: number) => void
  onOpenTags: (ws: Workspace) => void
  onStatusChange: (wsId: number, partial: Partial<WorkspaceStatus>) => void
}

function WorkspaceNode(p: WorkspaceNodeProps) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(p.ws.name)

  const mmCount = p.status?.mindmapCount ?? p.ws.mindmapCount ?? 0
  const ssCount = p.status?.sessionCount ?? p.ws.sessionCount ?? 0
  // 空态引导仅在两列表均加载且为空时接管（与旧 WorkspaceHome showEmptyGate 一致）。
  const bothLoadedEmpty = p.status?.mindmapsEmpty === true && p.status?.sessionsEmpty === true
  const suppressEmpty = p.isFocusTarget && bothLoadedEmpty

  const submitRename = async () => {
    const trimmed = draft.trim()
    if (!trimmed || trimmed === p.ws.name) {
      setEditing(false)
      return
    }
    await p.onRename(p.ws.id, trimmed)
    setEditing(false)
  }

  return (
    <div className={`tree-workspace${p.selected ? ' selected' : ''}`}>
      <div className="tree-workspace-row">
        <button
          className="tree-chevron"
          aria-label={p.expanded ? '收起' : '展开'}
          aria-expanded={p.expanded}
          onClick={p.onToggleExpand}
        >
          {p.expanded ? '▾' : '▸'}
        </button>
        {p.batchSelectMode ? (
          <>
            <input
              type="checkbox"
              className="batch-checkbox"
              checked={p.batchSelected}
              onChange={() => p.onToggleSelect(p.ws.id)}
              aria-label={`选择 ${p.ws.name}`}
            />
            <button className="tree-workspace-name" onClick={() => p.onToggleSelect(p.ws.id)}>
              {p.ws.name}
              <span className="tree-counts">导图 {mmCount} · 会话 {ssCount}</span>
            </button>
          </>
        ) : editing ? (
          <span className="item-edit">
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && void submitRename()}
              onBlur={(e) => {
                if (focusLeftEditor(e.relatedTarget)) setEditing(false)
              }}
              autoFocus
            />
            <button onClick={() => void submitRename()}>保存</button>
            <button onClick={() => setEditing(false)}>取消</button>
          </span>
        ) : (
          <>
            <button className="tree-workspace-name" onClick={p.onSelect} title={p.ws.name}>
              {p.ws.name}
              <span className="tree-counts">导图 {mmCount} · 会话 {ssCount}</span>
            </button>
            <button
              className="tree-row-action"
              onClick={() => {
                setDraft(p.ws.name)
                setEditing(true)
              }}
            >
              重命名
            </button>
            <button className="tree-row-action danger" onClick={() => p.onDelete(p.ws)}>
              删除
            </button>
          </>
        )}
      </div>

      {p.expanded && (
        <div className="tree-children">
          <section className="tree-group" data-testid="mindmap-group">
            <div className="tree-group-header">
              <span>导图</span>
            </div>
            <MindmapListSection
              ws={p.ws}
              onOpen={p.onOpenMindmap}
              titleInputRef={p.mmInputRef}
              onCountChange={(n) => p.onStatusChange(p.ws.id, { mindmapCount: n })}
              onEmptyChange={(e) => p.onStatusChange(p.ws.id, { mindmapsEmpty: e })}
              suppressEmptyText={suppressEmpty}
            />
          </section>

          <section className="tree-group" data-testid="session-group">
            <div className="tree-group-header">
              <span>会话</span>
            </div>
            <SessionSection
              ws={p.ws}
              onOpenSession={p.onOpenSession}
              titleInputRef={p.ssInputRef}
              onCountChange={(n) => p.onStatusChange(p.ws.id, { sessionCount: n })}
              onEmptyChange={(e) => p.onStatusChange(p.ws.id, { sessionsEmpty: e })}
              suppressEmptyText={suppressEmpty}
            />
          </section>

          <section className="tree-group" data-testid="tag-group">
            <button className="tree-group-nav" onClick={() => p.onOpenTags(p.ws)}>
              标签
              <span className="tree-counts">标签云</span>
            </button>
          </section>
        </div>
      )}
    </div>
  )
}
