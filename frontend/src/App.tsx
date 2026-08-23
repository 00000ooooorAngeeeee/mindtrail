import { useCallback, useEffect, useRef, useState } from 'react'
import { useAppStore } from './store/useAppStore'
import { useSettingsStore } from './store/useSettingsStore'
import { useKeymap } from './utils/useKeymap'
import { batchDeleteMindmaps, createMindmap, deleteMindmap, listMindmaps, renameMindmap } from './api/mindmaps'
import { getSession } from './api/sessions'
import type { Mindmap, Workspace } from './api/types'
import { MindMapEditor } from './features/mindmap/MindMapEditor'
import { SessionSection } from './features/session/SessionSection'
import { PAGE_SIZE, SessionView } from './features/session/SessionView'
import { SearchOverlay, type SearchNavigateTarget } from './features/search/SearchOverlay'
import { SettingsPanel } from './features/settings/SettingsPanel'
import { TagSection } from './features/tag/TagSection'
import { EmptyGuide } from './features/workspace/EmptyGuide'
import { BatchSelectToolbar } from './components/BatchSelectToolbar'
import { useBatchSelect } from './utils/useBatchSelect'
import { batchConfirmText } from './utils/batchSelection'
import { focusLeftEditor } from './utils/renameBlur'
import './App.css'

/** 多会话并行视图（v1.1 P1）标签：会话 + 跳转定位参数（打开瞬间有效）。 */
interface SessionTab {
  sessionId: number
  title: string
  /** 搜索/标签跳转：初始加载页（按 seq 估算）。 */
  page?: number
  /** 搜索/标签跳转：加载后闪烁定位的条目 id。 */
  entryId?: number
}

export default function App() {
  const { health, workspaces, loading, creating, error, load, create, rename, remove, removeBatch } = useAppStore()
  const [name, setName] = useState('')
  const [open, setOpen] = useState<Workspace | null>(null)
  const [openMindmapId, setOpenMindmapId] = useState<number | null>(null)
  // 多会话并行视图（v1.1 P1）：打开的会话标签列表（全部挂载保留状态，激活的可见）+ 激活会话
  const [sessionTabs, setSessionTabs] = useState<SessionTab[]>([])
  const [activeSessionId, setActiveSessionId] = useState<number | null>(null)
  // 标签栏「＋」：回工作区继续打开其它会话（标签保留）；再次打开/跳转会话时回到标签视图
  const [browseSessions, setBrowseSessions] = useState(false)
  // 全局搜索（M4 任务一）：浮层开关 + 跳转定位信息（导图命中节点 / 条目所在页与条目 id）
  const [searchOpen, setSearchOpen] = useState(false)
  const [mindmapHighlight, setMindmapHighlight] = useState<string | null>(null)
  // 设置页（M4 任务四）：Ctrl+, 打开（03 §5）
  const [settingsOpen, setSettingsOpen] = useState(false)
  // 搜索无结果空态（03 §7.3）：标签快速过滤入口 → 打开工作区首页标签面板并高亮（信号递增触发滚动）
  const [tagFocusSignal, setTagFocusSignal] = useState(0)

  // 批量删除（工作区列表，「选择模式」开关 + 复选框 + 全选，04 §5）
  const wsBatch = useBatchSelect(workspaces.map((w) => w.id))

  useEffect(() => {
    void load()
  }, [load])

  // 启动加载设置并应用主题；system 模式下跟随系统深浅色变化（03 §6）
  useEffect(() => {
    const store = useSettingsStore.getState()
    void store.load()
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = (e: MediaQueryListEvent) => useSettingsStore.getState().applyForSystemPreference(e.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])

  // Ctrl+K 打开全局搜索；Ctrl+, 打开设置（03 §5，v1.2 P2 起读自定义 keymap）。
  const { matches } = useKeymap()
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (matches('globalSearch', e)) {
        e.preventDefault()
        setSearchOpen(true)
      } else if (matches('openSettings', e)) {
        e.preventDefault()
        setSettingsOpen((v) => !v)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [matches])

  // 搜索结果跳转（PRD D2）：定位到对应工作区/导图/会话及具体条目，目标高亮闪烁。
  const handleSearchNavigate = (t: SearchNavigateTarget) => {
    setSearchOpen(false)
    setOpen(workspaces.find((w) => w.id === t.workspaceId) ?? null)
    setMindmapHighlight(null)
    if (t.kind === 'mindmap') {
      closeAllSessionTabs()
      setMindmapHighlight(t.nodeId)
      setOpenMindmapId(t.mindmapId)
    } else if (t.kind === 'entry') {
      // 条目按 seq 分页：估算目标条目所在页（删除造成的 seq 空洞可能偏移，未命中时静默忽略）
      openSessionTab(t.sessionId, { page: Math.floor((t.seq - 1) / PAGE_SIZE) + 1, entryId: t.entryId })
    } else {
      openSessionTab(t.sessionId)
    }
  }

  // 标签过滤条目跳转（M4 任务二，PRD D2 同款定位：seq 估算分页 + 闪烁）。
  const handleOpenSessionEntry = (sessionId: number, entryId: number, seq: number) => {
    openSessionTab(sessionId, { page: Math.floor((seq - 1) / PAGE_SIZE) + 1, entryId })
  }

  // 联动（v1.1 P1）：条目引用节点 chip 点击 → 打开导图并定位节点（复用 PRD D2 高亮闪烁机制）。
  const handleOpenMindmapNode = (workspaceId: number, mindmapId: number, nodeId: string) => {
    setOpen(workspaces.find((w) => w.id === workspaceId) ?? null)
    closeAllSessionTabs()
    setMindmapHighlight(nodeId)
    setOpenMindmapId(mindmapId)
  }

  // 搜索无结果空态（03 §7.3）：标签快速过滤入口——回到工作区首页标签面板并聚焦高亮。
  const handleBrowseTags = () => {
    setSearchOpen(false)
    setOpenMindmapId(null)
    closeAllSessionTabs()
    if (!open && workspaces.length > 0) setOpen(workspaces[0])
    setTagFocusSignal((s) => s + 1)
  }

  /**
   * 打开（或激活）会话标签（v1.1 P1 多会话并行视图）：
   * 已打开 → 仅激活并更新跳转定位；首次打开 → 追加标签（标题先占位，轻量 GET 拉取后回填）。
   */
  const openSessionTab = (sessionId: number, jump?: { page?: number; entryId?: number }) => {
    setOpenMindmapId(null)
    setBrowseSessions(false) // 打开/跳转会话 → 回到标签视图
    setActiveSessionId(sessionId)
    const isNew = !sessionTabs.some((t) => t.sessionId === sessionId)
    setSessionTabs((prev) =>
      isNew
        ? [...prev, { sessionId, title: `会话 #${sessionId}`, page: jump?.page, entryId: jump?.entryId }]
        : prev.map((t) =>
            t.sessionId === sessionId
              ? { ...t, page: jump?.page ?? t.page, entryId: jump?.entryId ?? t.entryId }
              : t,
          ),
    )
    if (isNew) {
      getSession(sessionId, 1, 1) // size=1 仅取标题（会话详情首屏由 SessionView 自己拉）
        .then((s) => {
          setSessionTabs((cur) => cur.map((t) => (t.sessionId === sessionId ? { ...t, title: s.title } : t)))
        })
        .catch(() => {
          /* 标题拉取失败保留占位标题 */
        })
    }
  }

  /** 关闭会话标签：关闭的是激活标签时切回前一个（无剩余则回工作区）。 */
  const closeSessionTab = (sessionId: number) => {
    const next = sessionTabs.filter((t) => t.sessionId !== sessionId)
    setSessionTabs(next)
    if (activeSessionId === sessionId) {
      if (next.length === 0) {
        setActiveSessionId(null)
      } else {
        const idx = sessionTabs.findIndex((t) => t.sessionId === sessionId)
        setActiveSessionId(next[Math.max(0, idx - 1)].sessionId)
      }
    }
  }

  /** 关闭全部会话标签（进入导图/搜索入口时调用）。 */
  const closeAllSessionTabs = () => {
    setSessionTabs([])
    setActiveSessionId(null)
    setBrowseSessions(false)
  }

  const handleCreate = async () => {
    const trimmed = name.trim()
    if (!trimmed || creating) return
    await create(trimmed)
    setName('')
  }

  // 批量删除工作区（级联删全部子数据，二次确认；04 §5 POST /workspaces/batch-delete）
  const handleBatchDeleteWorkspaces = async () => {
    const ids = workspaces.filter((w) => wsBatch.selected.has(w.id)).map((w) => w.id)
    if (ids.length === 0) return
    if (!confirm(batchConfirmText('工作区', ids.length, true))) return
    await removeBatch(ids)
    wsBatch.exit()
  }

  return (
    <div className="app">
      <header className="app-header">
        <h1>思迹 TrailMind</h1>
        {health ? (
          <span className="version">后端 v{health.version}</span>
        ) : loading ? (
          <span className="version muted">连接中…</span>
        ) : (
          <span className="version muted">后端未连接</span>
        )}
        <button className="header-search" onClick={() => setSearchOpen(true)}>
          🔍 搜索（Ctrl+K）
        </button>
        <button className="header-settings" onClick={() => setSettingsOpen((v) => !v)}>
          ⚙ 设置
        </button>
      </header>

      {searchOpen && (
        <SearchOverlay
          onClose={() => setSearchOpen(false)}
          onNavigate={handleSearchNavigate}
          onBrowseTags={handleBrowseTags}
        />
      )}

      {error && (
        <div className="error" role="alert">
          {error}
        </div>
      )}

      <main className="content">
        {settingsOpen ? (
          <SettingsPanel onBack={() => setSettingsOpen(false)} />
        ) : openMindmapId != null ? (
          <MindMapEditor
            mindmapId={openMindmapId}
            highlightNodeId={mindmapHighlight}
            onOpenEntry={handleOpenSessionEntry}
            onBack={() => {
              setOpenMindmapId(null)
              setMindmapHighlight(null)
            }}
          />
        ) : sessionTabs.length > 0 && !browseSessions ? (
          /* 多会话并行视图（v1.1 P1）：标签栏 + 全部标签挂载（非激活 display:none 保留状态） */
          <div className="session-tabs-area">
            <div className="session-tabs" role="tablist" aria-label="打开的会话">
              {sessionTabs.map((t) => (
                <div
                  key={t.sessionId}
                  className={`session-tab${t.sessionId === activeSessionId ? ' active' : ''}`}
                >
                  <button
                    role="tab"
                    aria-label={t.title}
                    aria-selected={t.sessionId === activeSessionId}
                    className="session-tab-title"
                    title={t.title}
                    onClick={() => setActiveSessionId(t.sessionId)}
                  >
                    {t.title}
                  </button>
                  <button
                    className="session-tab-close"
                    aria-label={`关闭 ${t.title}`}
                    onClick={() => closeSessionTab(t.sessionId)}
                  >
                    ×
                  </button>
                </div>
              ))}
              {/* 「＋」回工作区继续打开其它会话（标签保留） */}
              <button
                className="session-tab-new"
                aria-label="打开更多会话"
                onClick={() => setBrowseSessions(true)}
              >
                ＋
              </button>
            </div>
            {sessionTabs.map((t) => (
              <div
                key={t.sessionId}
                role="tabpanel"
                className="session-tab-pane"
                style={{ display: t.sessionId === activeSessionId ? undefined : 'none' }}
              >
                <SessionView
                  sessionId={t.sessionId}
                  initialPage={t.page}
                  initialHighlightEntryId={t.entryId}
                  onOpenMindmapNode={handleOpenMindmapNode}
                  onBack={() => closeSessionTab(t.sessionId)}
                />
              </div>
            ))}
          </div>
        ) : open ? (
          <WorkspaceHome
            ws={open}
            onBack={() => {
              setOpen(null)
              void load() // 返回列表页时重拉工作区列表（listWithCounts 唯一计数源），列表项计数同步
            }}
            onOpenMindmap={setOpenMindmapId}
            onOpenSession={(id) => openSessionTab(id)}
            onOpenSessionEntry={handleOpenSessionEntry}
            tagFocusSignal={tagFocusSignal}
          />
        ) : (
          <section className="workspace-panel">
            <h2>工作区</h2>
            <BatchSelectToolbar
              batch={wsBatch}
              canEnter={workspaces.length > 0}
              onDelete={() => void handleBatchDeleteWorkspaces()}
            />
            {loading ? (
              <p className="muted">加载中…</p>
            ) : workspaces.length === 0 ? (
              <p className="muted">暂无工作区</p>
            ) : (
              <ul className="workspace-list">
                {workspaces.map((w) => (
                  <WorkspaceItem
                    key={w.id}
                    ws={w}
                    onOpen={setOpen}
                    onRename={rename}
                    onRemove={remove}
                    selectMode={wsBatch.selectMode}
                    selected={wsBatch.selected.has(w.id)}
                    onToggleSelect={wsBatch.toggle}
                  />
                ))}
              </ul>
            )}

            <div className="create-form">
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="输入工作区名称"
              />
              <button onClick={handleCreate} disabled={!name.trim() || creating}>
                {creating ? '创建中…' : '创建工作区'}
              </button>
            </div>
          </section>
        )}
      </main>
    </div>
  )
}

function WorkspaceItem({
  ws,
  onOpen,
  onRename,
  onRemove,
  selectMode = false,
  selected = false,
  onToggleSelect,
}: {
  ws: Workspace
  onOpen: (w: Workspace) => void
  onRename: (id: number, name: string) => Promise<void>
  onRemove: (id: number) => Promise<void>
  selectMode?: boolean
  selected?: boolean
  onToggleSelect?: (id: number) => void
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(ws.name)

  const submit = async () => {
    const trimmed = draft.trim()
    if (!trimmed || trimmed === ws.name) {
      setEditing(false)
      return
    }
    await onRename(ws.id, trimmed)
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
            onChange={() => onToggleSelect?.(ws.id)}
            aria-label={`选择 ${ws.name}`}
          />
          <button className="item-name" onClick={() => onToggleSelect?.(ws.id)}>
            {ws.name}
            <span className="item-stats">
              导图 {ws.mindmapCount ?? 0} · 会话 {ws.sessionCount ?? 0}
            </span>
          </button>
        </>
      ) : editing ? (
        <span className="item-edit">
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && submit()}
            onBlur={(e) => { if (focusLeftEditor(e.relatedTarget)) setEditing(false) }}
            autoFocus
          />
          <button onClick={submit}>保存</button>
          <button onClick={() => setEditing(false)}>取消</button>
        </span>
      ) : (
        <>
          <button className="item-name" onClick={() => onOpen(ws)}>
            {ws.name}
            <span className="item-stats">
              导图 {ws.mindmapCount ?? 0} · 会话 {ws.sessionCount ?? 0}
            </span>
          </button>
          <button onClick={() => { setDraft(ws.name); setEditing(true) }}>重命名</button>
          <button className="danger" onClick={() => { if (confirm(`删除工作区「${ws.name}」及其全部数据？`)) void onRemove(ws.id) }}>
            删除
          </button>
        </>
      )}
    </li>
  )
}

/** 导图列表项（PRD B4）：行内重命名（与工作区重命名同款交互），M4 缺陷清理补全。 */
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
  onDelete: (id: number) => Promise<void>
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
            onKeyDown={(e) => e.key === 'Enter' && submit()}
            onBlur={(e) => { if (focusLeftEditor(e.relatedTarget)) setEditing(false) }}
            autoFocus
          />
          <button onClick={submit}>保存</button>
          <button onClick={() => setEditing(false)}>取消</button>
        </span>
      ) : (
        <>
          <span className="item-name">
            {m.name}
            <span className="item-stats">{m.nodeCount ?? 0} 节点</span>
          </span>
          <button onClick={() => onOpen(m.id)}>打开</button>
          <button onClick={() => { setDraft(m.name); setEditing(true) }}>重命名</button>
          <button className="danger" onClick={() => void onDelete(m.id)}>
            删除
          </button>
        </>
      )}
    </li>
  )
}

function WorkspaceHome({
  ws,
  onBack,
  onOpenMindmap,
  onOpenSession,
  onOpenSessionEntry,
  tagFocusSignal,
}: {
  ws: Workspace
  onBack: () => void
  onOpenMindmap: (id: number) => void
  onOpenSession: (id: number) => void
  onOpenSessionEntry: (sessionId: number, entryId: number, seq: number) => void
  /** 搜索无结果「按标签浏览」入口（03 §7.3）：信号递增时滚动聚焦标签面板。 */
  tagFocusSignal?: number
}) {
  const [mindmaps, setMindmaps] = useState<Mindmap[]>([])
  // 批量删除（导图列表，「选择模式」开关 + 复选框 + 全选，04 §5）
  const mmBatch = useBatchSelect(mindmaps.map((m) => m.id))
  const [name, setName] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // 缺陷修复（新建导图/会话后计数停滞）：头部计数改为实时——
  // 导图数随本组件加载的列表更新，会话数由 SessionSection 上报；初始值取列表快照避免首帧闪烁。
  const [mindmapCount, setMindmapCount] = useState(ws.mindmapCount ?? 0)
  const [sessionCount, setSessionCount] = useState(ws.sessionCount ?? 0)
  // M4 任务五（03 §7.1）：会话是否为空（SessionSection 加载后上报），与导图空共同决定空态引导；
  // null = 会话尚未加载完成，此时不展示引导避免闪烁。
  const [sessionsEmpty, setSessionsEmpty] = useState<boolean | null>(null)
  const [tagFocusFlash, setTagFocusFlash] = useState(false)
  const mindmapTitleRef = useRef<HTMLInputElement>(null)
  const sessionTitleRef = useRef<HTMLInputElement>(null)
  const tagSectionRef = useRef<HTMLDivElement>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const list = await listMindmaps(ws.id)
      setMindmaps(list)
      setMindmapCount(list.length)
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载导图失败')
    } finally {
      setLoading(false)
    }
  }, [ws.id])

  useEffect(() => {
    void load()
  }, [load])

  const handleCreate = async () => {
    const trimmed = name.trim()
    if (!trimmed) return
    try {
      await createMindmap(ws.id, trimmed)
      setName('')
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : '创建导图失败')
    }
  }

  const handleDelete = async (id: number) => {
    if (!confirm('删除该导图？')) return
    try {
      await deleteMindmap(id)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : '删除导图失败')
    }
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

  const handleRename = async (id: number, name: string) => {
    try {
      await renameMindmap(id, name)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : '重命名导图失败')
    }
  }

  // 新工作区空态引导（03 §7.1）：导图与会话均为空时，居中引导「新建第一张导图 / 开始第一次会话」。
  const showEmptyGuide = !loading && sessionsEmpty === true && mindmaps.length === 0

  // 搜索无结果「按标签浏览」入口（03 §7.3）：信号递增 → 滚动到标签面板并闪烁高亮 2s。
  useEffect(() => {
    if (tagFocusSignal === undefined || tagFocusSignal === 0) return
    tagSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    setTagFocusFlash(true)
    const timer = setTimeout(() => setTagFocusFlash(false), 2000)
    return () => clearTimeout(timer)
  }, [tagFocusSignal])

  return (
    <section className="workspace-panel">
      <button onClick={onBack}>← 返回</button>
      <h2>{ws.name}</h2>
      {ws.description && <p className="muted">{ws.description}</p>}
      {ws.repoPath && <p className="muted">仓库：{ws.repoPath}</p>}
      <p className="muted">
        导图 {mindmapCount} · 会话 {sessionCount}
      </p>

      {showEmptyGuide && (
        <EmptyGuide
          workspaceName={ws.name}
          onNewMindmap={() => mindmapTitleRef.current?.focus()}
          onNewSession={() => sessionTitleRef.current?.focus()}
        />
      )}

      <h3>导图</h3>
      <BatchSelectToolbar
        batch={mmBatch}
        canEnter={mindmaps.length > 0}
        onDelete={() => void handleBatchDeleteMindmaps()}
      />
      {error && <p className="error" role="alert">{error}</p>}
      {loading ? (
        <p className="muted">加载中…</p>
      ) : mindmaps.length === 0 ? (
        showEmptyGuide ? null : <p className="muted">暂无导图</p>
      ) : (
        <ul className="workspace-list">
          {mindmaps.map((m) => (
            <MindmapItem
              key={m.id}
              m={m}
              onOpen={onOpenMindmap}
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
          ref={mindmapTitleRef}
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="输入导图名称"
        />
        <button onClick={handleCreate} disabled={!name.trim()}>
          新建导图
        </button>
      </div>

      <h3>会话</h3>
      <SessionSection
        ws={ws}
        onOpenSession={onOpenSession}
        titleInputRef={sessionTitleRef}
        onEmptyChange={setSessionsEmpty}
        onCountChange={setSessionCount}
        suppressEmptyText={showEmptyGuide}
      />

      <h3>标签</h3>
      <div ref={tagSectionRef} className={`tag-section-anchor${tagFocusFlash ? ' tag-section-flash' : ''}`}>
        <TagSection ws={ws} onOpenSessionEntry={onOpenSessionEntry} />
      </div>
    </section>
  )
}
