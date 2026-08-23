import { useEffect, useState } from 'react'
import { useAppStore } from './store/useAppStore'
import { useSettingsStore } from './store/useSettingsStore'
import { useKeymap } from './utils/useKeymap'
import { deleteWithUndo } from './utils/undoDelete'
import { getSession } from './api/sessions'
import type { Workspace } from './api/types'
import { MindMapEditor } from './features/mindmap/MindMapEditor'
import { PAGE_SIZE, SessionView } from './features/session/SessionView'
import { SearchOverlay, type SearchNavigateTarget } from './features/search/SearchOverlay'
import { SettingsPanel } from './features/settings/SettingsPanel'
import { Sidebar, type WorkspaceStatus } from './features/sidebar/Sidebar'
import { TagSection } from './features/tag/TagSection'
import { EmptyGuide } from './features/workspace/EmptyGuide'
import { Toaster } from './components/Toaster'
import { useBatchSelect } from './utils/useBatchSelect'
import { batchConfirmText } from './utils/batchSelection'
import './App.css'

/** 多会话并行视图（v1.1 P1）标签：会话 + 跳转定位参数（打开瞬间有效）。 */
interface SessionTab {
  sessionId: number
  title: string
  page?: number
  entryId?: number
}

export default function App() {
  const { health, workspaces, loading, creating, error, load, create, rename, remove, removeBatch } = useAppStore()
  const [open, setOpen] = useState<Workspace | null>(null)
  const [openMindmapId, setOpenMindmapId] = useState<number | null>(null)
  // 多会话并行视图（v1.1 P1）：打开的会话标签列表（全部挂载保留状态，激活的可见）+ 激活会话
  const [sessionTabs, setSessionTabs] = useState<SessionTab[]>([])
  const [activeSessionId, setActiveSessionId] = useState<number | null>(null)
  // 标签栏「＋」：回工作区继续打开其它会话（标签保留）；再次打开/跳转会话时回到标签视图
  const [browseSessions, setBrowseSessions] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const [mindmapHighlight, setMindmapHighlight] = useState<string | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  // 搜索无结果空态（03 §7.3）：标签快速过滤入口 → 右侧标签云并高亮闪烁
  const [tagFocusSignal, setTagFocusSignal] = useState(0)

  // 悬浮岛式侧边栏可隐藏（v1.2 P2 美化前端样式）
  const [sidebarHidden, setSidebarHidden] = useState(false)
  // 右侧标签云视图（点击侧边栏「标签」组 / 搜索无结果「按标签浏览」进入）
  const [tagsViewWs, setTagsViewWs] = useState<Workspace | null>(null)
  // 工作区 undo 删除：pending 过滤列表（乐观移除但未真删）
  const [pendingWsDelete, setPendingWsDelete] = useState<Set<number>>(() => new Set())
  // 空态引导聚焦信号（右侧 overview 入口 → 侧边栏创建输入框）
  const [mindmapFocusSignal, setMindmapFocusSignal] = useState(0)
  const [sessionFocusSignal, setSessionFocusSignal] = useState(0)
  // 选中工作区实时状态（侧边栏上报）：右侧 overview 计数 + 空态引导
  const [selectedStatus, setSelectedStatus] = useState<WorkspaceStatus | null>(null)

  const wsBatch = useBatchSelect(workspaces.map((w) => w.id))
  const visibleWorkspaces = workspaces.filter((w) => !pendingWsDelete.has(w.id))

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
    setTagsViewWs(null)
    if (t.kind === 'mindmap') {
      closeAllSessionTabs()
      setMindmapHighlight(t.nodeId)
      setOpenMindmapId(t.mindmapId)
    } else if (t.kind === 'entry') {
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
    setTagsViewWs(null)
    setMindmapHighlight(nodeId)
    setOpenMindmapId(mindmapId)
  }

  // 搜索无结果空态（03 §7.3）：标签快速过滤入口——打开右侧标签云并闪烁高亮。
  const handleBrowseTags = () => {
    setSearchOpen(false)
    setOpenMindmapId(null)
    closeAllSessionTabs()
    const target = open ?? (workspaces.length > 0 ? workspaces[0] : null)
    if (target) {
      setOpen(target)
      setTagsViewWs(target)
      setTagFocusSignal((s) => s + 1)
    }
  }

  /**
   * 打开（或激活）会话标签（v1.1 P1 多会话并行视图）：
   * 已打开 → 仅激活并更新跳转定位；首次打开 → 追加标签（标题先占位，轻量 GET 拉取后回填）。
   */
  const openSessionTab = (sessionId: number, jump?: { page?: number; entryId?: number }) => {
    setOpenMindmapId(null)
    setTagsViewWs(null)
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
      getSession(sessionId, 1, 1)
        .then((s) => {
          setSessionTabs((cur) => cur.map((t) => (t.sessionId === sessionId ? { ...t, title: s.title } : t)))
        })
        .catch(() => {
          /* 标题拉取失败保留占位标题 */
        })
    }
  }

  /** 关闭会话标签：关闭的是激活标签时切回前一个（无剩余则回 overview）。 */
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

  /** 关闭全部会话标签（进入导图/标签云时调用）。 */
  const closeAllSessionTabs = () => {
    setSessionTabs([])
    setActiveSessionId(null)
    setBrowseSessions(false)
  }

  const handleCreateWorkspace = async (name: string) => {
    await create(name)
  }

  const handleRenameWorkspace = async (id: number, name: string) => {
    await rename(id, name)
    if (open?.id === id) setOpen((prev) => (prev ? { ...prev, name } : prev))
  }

  // 工作区删除带撤销（v1.2 P2）：乐观从列表移除（pending 过滤）→ 撤销 toast → 到期 remove。
  const handleDeleteWorkspace = (ws: Workspace) => {
    deleteWithUndo({
      label: `工作区「${ws.name}」`,
      performDelete: () => remove(ws.id),
      optimisticRemove: () => setPendingWsDelete((prev) => new Set(prev).add(ws.id)),
      optimisticRestore: () =>
        setPendingWsDelete((prev) => {
          const next = new Set(prev)
          next.delete(ws.id)
          return next
        }),
    })
    if (open?.id === ws.id) {
      setOpen(null)
      setSelectedStatus(null)
    }
  }

  // 批量删除工作区（级联删全部子数据，二次确认；04 §5 POST /workspaces/batch-delete）
  const handleBatchDeleteWorkspaces = async () => {
    const ids = visibleWorkspaces.filter((w) => wsBatch.selected.has(w.id)).map((w) => w.id)
    if (ids.length === 0) return
    if (!confirm(batchConfirmText('工作区', ids.length, true))) return
    await removeBatch(ids)
    wsBatch.exit()
  }

  // 点击侧边栏导图/会话/标签/工作区 → 右侧视图切换
  const handleOpenMindmap = (id: number) => {
    closeAllSessionTabs()
    setTagsViewWs(null)
    setMindmapHighlight(null)
    setOpenMindmapId(id)
  }
  const handleOpenSession = (id: number) => openSessionTab(id)
  const handleOpenTags = (ws: Workspace) => {
    setOpenMindmapId(null)
    closeAllSessionTabs()
    setBrowseSessions(false)
    setOpen(ws)
    setTagsViewWs(ws)
  }
  const handleSelectWorkspace = (ws: Workspace) => {
    setOpenMindmapId(null)
    closeAllSessionTabs()
    setTagsViewWs(null)
    setBrowseSessions(false)
    setOpen(ws)
    setSelectedStatus(null)
  }

  const showSessionTabs = sessionTabs.length > 0 && !browseSessions

  return (
    <div className="app-shell">
      <header className="app-topbar">
        <button
          className="sidebar-toggle"
          aria-label={sidebarHidden ? '显示侧边栏' : '隐藏侧边栏'}
          onClick={() => setSidebarHidden((v) => !v)}
        >
          ☰
        </button>
        <h1 className="app-title">思迹 TrailMind</h1>
        {health ? (
          <span className="version">后端 v{health.version}</span>
        ) : loading ? (
          <span className="version muted">连接中…</span>
        ) : (
          <span className="version muted">后端未连接</span>
        )}
        <span className="topbar-spacer" />
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

      <div className="app-body">
        <aside className={`sidebar island${sidebarHidden ? ' hidden' : ''}`}>
          <Sidebar
            workspaces={visibleWorkspaces}
            selectedWsId={open?.id ?? null}
            onSelectWorkspace={handleSelectWorkspace}
            onCreateWorkspace={handleCreateWorkspace}
            creatingWorkspace={creating}
            onRenameWorkspace={handleRenameWorkspace}
            onDeleteWorkspace={handleDeleteWorkspace}
            onBatchDeleteWorkspaces={handleBatchDeleteWorkspaces}
            wsBatch={wsBatch}
            onOpenMindmap={handleOpenMindmap}
            onOpenSession={handleOpenSession}
            onOpenTags={handleOpenTags}
            onStatusChange={(_id, status) => setSelectedStatus(status)}
            mindmapFocusSignal={mindmapFocusSignal}
            sessionFocusSignal={sessionFocusSignal}
          />
        </aside>

        <main className="main island">
          <div className="main-content">
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
            ) : showSessionTabs ? (
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
            ) : tagsViewWs ? (
              <section className="tag-view">
                <div className="tag-view-head">
                  <h2>标签</h2>
                  <span className="muted">{tagsViewWs.name}</span>
                </div>
                <div className={`tag-section-anchor${tagFocusSignal ? ' tag-section-flash' : ''}`}>
                  <TagSection ws={tagsViewWs} onOpenSessionEntry={handleOpenSessionEntry} />
                </div>
              </section>
            ) : open ? (
              <WorkspaceOverview
                ws={open}
                status={selectedStatus}
                onNewMindmap={() => setMindmapFocusSignal((s) => s + 1)}
                onNewSession={() => setSessionFocusSignal((s) => s + 1)}
              />
            ) : (
              <section className="workspace-welcome">
                <p className="muted">
                  {loading
                    ? '加载中…'
                    : visibleWorkspaces.length === 0
                      ? '在左侧新建一个工作区开始，或从已有工作区进入。'
                      : '从左侧选择一个工作区进入。'}
                </p>
              </section>
            )}
          </div>
        </main>
      </div>

      <Toaster />
    </div>
  )
}

/** 右侧工作区 overview（选中工作区但未进具体导图/会话/标签时）：元信息 + 计数 + 空态引导。 */
function WorkspaceOverview({
  ws,
  status,
  onNewMindmap,
  onNewSession,
}: {
  ws: Workspace
  status: WorkspaceStatus | null
  onNewMindmap: () => void
  onNewSession: () => void
}) {
  const showGuide = status?.mindmapsEmpty === true && status?.sessionsEmpty === true
  return (
    <section className="workspace-overview">
      <div className="overview-head">
        <h2>{ws.name}</h2>
      </div>
      {ws.description && <p className="muted">{ws.description}</p>}
      {ws.repoPath && <p className="muted">仓库：{ws.repoPath}</p>}
      {showGuide ? (
        <EmptyGuide workspaceName={ws.name} onNewMindmap={onNewMindmap} onNewSession={onNewSession} />
      ) : (
        <p className="muted overview-hint">从左侧选择导图、会话或标签，或在侧边栏新建内容。</p>
      )}
    </section>
  )
}

