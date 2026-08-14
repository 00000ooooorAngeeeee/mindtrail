import { useEffect, useState } from 'react'
import { useAppStore } from './store/useAppStore'
import './App.css'

export default function App() {
  const { health, workspaces, loading, creating, error, load, create } = useAppStore()
  const [name, setName] = useState('')

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
        <section className="workspace-panel">
          <h2>工作区</h2>
          {loading ? (
            <p className="muted">加载中…</p>
          ) : workspaces.length === 0 ? (
            <p className="muted">暂无工作区</p>
          ) : (
            <ul className="workspace-list">
              {workspaces.map((w) => (
                <li key={w.id}>{w.name}</li>
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
              {creating ? '创建中…' : '创建测试工作区'}
            </button>
          </div>
        </section>
      </main>
    </div>
  )
}
