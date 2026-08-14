import { useEffect, useState } from 'react'
import { useAppStore } from './store/useAppStore'
import type { Workspace } from './api/types'
import './App.css'

export default function App() {
  const { health, workspaces, loading, creating, error, load, create, rename, remove } = useAppStore()
  const [name, setName] = useState('')
  const [open, setOpen] = useState<Workspace | null>(null)

  useEffect(() => {
    void load()
  }, [load])

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
      </header>

      {error && (
        <div className="error" role="alert">
          {error}
        </div>
      )}

      <main className="content">
        {open ? (
          <WorkspaceHome ws={open} onBack={() => setOpen(null)} />
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
                disabled={creating}
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

function WorkspaceHome({ ws, onBack }: { ws: Workspace; onBack: () => void }) {
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
      <p className="muted">暂无导图（M1 后续任务实现导图数据层）</p>

      <h3>会话</h3>
      <p className="muted">暂无会话（M3 实现过程记录）</p>
    </section>
  )
}
