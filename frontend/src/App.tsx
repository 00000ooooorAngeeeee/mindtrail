import { useCallback, useEffect, useState } from 'react'
import { useAppStore } from './store/useAppStore'
import { useSettingsStore } from './store/useSettingsStore'
import { createMindmap, deleteMindmap, listMindmaps } from './api/mindmaps'
import type { Mindmap, Workspace } from './api/types'
import { MindMapEditor } from './features/mindmap/MindMapEditor'
import { SessionSection } from './features/session/SessionSection'
import { PAGE_SIZE, SessionView } from './features/session/SessionView'
import { SearchOverlay, type SearchNavigateTarget } from './features/search/SearchOverlay'
import { SettingsPanel } from './features/settings/SettingsPanel'
import { TagSection } from './features/tag/TagSection'
import './App.css'

export default function App() {
  const { health, workspaces, loading, creating, error, load, create, rename, remove } = useAppStore()
  const [name, setName] = useState('')
  const [open, setOpen] = useState<Workspace | null>(null)
  const [openMindmapId, setOpenMindmapId] = useState<number | null>(null)
  const [openSessionId, setOpenSessionId] = useState<number | null>(null)
  // 全局搜索（M4 任务一）：浮层开关 + 跳转定位信息（导图命中节点 / 条目所在页与条目 id）
  const [searchOpen, setSearchOpen] = useState(false)
  const [mindmapHighlight, setMindmapHighlight] = useState<string | null>(null)
  const [sessionJump, setSessionJump] = useState<{ page: number; entryId: number } | null>(null)
  // 设置页（M4 任务四）：Ctrl+, 打开（03 §5）
  const [settingsOpen, setSettingsOpen] = useState(false)

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

  // Ctrl+K 打开全局搜索；Ctrl+, 打开设置（03 §5）。
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setSearchOpen(true)
      } else if ((e.ctrlKey || e.metaKey) && e.key === ',') {
        e.preventDefault()
        setSettingsOpen((v) => !v)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // 搜索结果跳转（PRD D2）：定位到对应工作区/导图/会话及具体条目，目标高亮闪烁。
  const handleSearchNavigate = (t: SearchNavigateTarget) => {
    setSearchOpen(false)
    setOpen(workspaces.find((w) => w.id === t.workspaceId) ?? null)
    setMindmapHighlight(null)
    setSessionJump(null)
    if (t.kind === 'mindmap') {
      setOpenSessionId(null)
      setMindmapHighlight(t.nodeId)
      setOpenMindmapId(t.mindmapId)
    } else if (t.kind === 'entry') {
      setOpenMindmapId(null)
      // 条目按 seq 分页：估算目标条目所在页（删除造成的 seq 空洞可能偏移，未命中时静默忽略）
      setSessionJump({ page: Math.floor((t.seq - 1) / PAGE_SIZE) + 1, entryId: t.entryId })
      setOpenSessionId(t.sessionId)
    } else {
      setOpenMindmapId(null)
      setOpenSessionId(t.sessionId)
    }
  }

  // 标签过滤条目跳转（M4 任务二，PRD D2 同款定位：seq 估算分页 + 闪烁）。
  const handleOpenSessionEntry = (sessionId: number, entryId: number, seq: number) => {
    setOpenMindmapId(null)
    setSessionJump({ page: Math.floor((seq - 1) / PAGE_SIZE) + 1, entryId })
    setOpenSessionId(sessionId)
  }

  const handleCreate = async () => {
    const trimmed = name.trim()
    if (!trimmed || creating) return
    await create(trimmed)
    setName('')
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
        <SearchOverlay onClose={() => setSearchOpen(false)} onNavigate={handleSearchNavigate} />
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
            onBack={() => {
              setOpenMindmapId(null)
              setMindmapHighlight(null)
            }}
          />
        ) : openSessionId != null ? (
          <SessionView
            sessionId={openSessionId}
            initialPage={sessionJump?.page}
            initialHighlightEntryId={sessionJump?.entryId}
            onBack={() => {
              setOpenSessionId(null)
              setSessionJump(null)
            }}
          />
        ) : open ? (
          <WorkspaceHome
            ws={open}
            onBack={() => setOpen(null)}
            onOpenMindmap={setOpenMindmapId}
            onOpenSession={setOpenSessionId}
            onOpenSessionEntry={handleOpenSessionEntry}
          />
        ) : (
          <section className="workspace-panel">
            <h2>工作区</h2>
            {loading ? (
              <p className="muted">加载中…</p>
            ) : workspaces.length === 0 ? (
              <p className="muted">暂无工作区</p>
            ) : (
              <ul className="workspace-list">
                {workspaces.map((w) => (
                  <WorkspaceItem key={w.id} ws={w} onOpen={setOpen} onRename={rename} onRemove={remove} />
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
}: {
  ws: Workspace
  onOpen: (w: Workspace) => void
  onRename: (id: number, name: string) => Promise<void>
  onRemove: (id: number) => Promise<void>
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
    <li className="workspace-item">
      {editing ? (
        <span className="item-edit">
          <input value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && submit()} autoFocus />
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

function WorkspaceHome({
  ws,
  onBack,
  onOpenMindmap,
  onOpenSession,
  onOpenSessionEntry,
}: {
  ws: Workspace
  onBack: () => void
  onOpenMindmap: (id: number) => void
  onOpenSession: (id: number) => void
  onOpenSessionEntry: (sessionId: number, entryId: number, seq: number) => void
}) {
  const [mindmaps, setMindmaps] = useState<Mindmap[]>([])
  const [name, setName] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

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

  return (
    <section className="workspace-panel">
      <button onClick={onBack}>← 返回</button>
      <h2>{ws.name}</h2>
      {ws.description && <p className="muted">{ws.description}</p>}
      {ws.repoPath && <p className="muted">仓库：{ws.repoPath}</p>}
      <p className="muted">
        导图 {ws.mindmapCount ?? 0} · 会话 {ws.sessionCount ?? 0}
      </p>

      <h3>导图</h3>
      {error && <p className="error" role="alert">{error}</p>}
      {loading ? (
        <p className="muted">加载中…</p>
      ) : mindmaps.length === 0 ? (
        <p className="muted">暂无导图</p>
      ) : (
        <ul className="workspace-list">
          {mindmaps.map((m) => (
            <li key={m.id} className="workspace-item">
              <span className="item-name">
                {m.name}
                <span className="item-stats">{m.nodeCount ?? 0} 节点</span>
              </span>
              <button onClick={() => onOpenMindmap(m.id)}>打开</button>
              <button className="danger" onClick={() => void handleDelete(m.id)}>
                删除
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="create-form">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="输入导图名称"
        />
        <button onClick={handleCreate} disabled={!name.trim()}>
          新建导图
        </button>
      </div>

      <h3>会话</h3>
      <SessionSection ws={ws} onOpenSession={onOpenSession} />

      <h3>标签</h3>
      <TagSection ws={ws} onOpenSessionEntry={onOpenSessionEntry} />
    </section>
  )
}
