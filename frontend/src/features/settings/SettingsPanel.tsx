import { useEffect, useState } from 'react'
import { THEME_LABELS, THEME_MODES } from '../../api/types'
import { useSettingsStore } from '../../store/useSettingsStore'
import './settings.css'

/**
 * 设置页（M4 任务四，07 §7：数据库连接信息展示、主题切换、仓库路径；入口 Ctrl+,，03 §5）。
 * 数据库连接为只读展示（密码只显示「已配置/未配置」）；主题三选一即时生效并落库；
 * 默认仓库路径为全局回退值（新建会话仓库回退链：会话 → 工作区 → 全局默认），后端校验 .git 目录。
 */
export function SettingsPanel({ onBack }: { onBack: () => void }) {
  const { settings, loading, saving, error, load, setTheme, setDefaultRepoPath } = useSettingsStore()
  const [repoDraft, setRepoDraft] = useState('')

  useEffect(() => {
    void load()
  }, [load])

  // 加载/保存成功后同步输入框；用户输入中不覆盖
  useEffect(() => {
    setRepoDraft(settings?.defaultRepoPath ?? '')
  }, [settings?.defaultRepoPath])

  const saveRepo = async () => {
    await setDefaultRepoPath(repoDraft.trim())
  }

  const clearRepo = async () => {
    setRepoDraft('')
    await setDefaultRepoPath('')
  }

  const db = settings?.database

  return (
    <section className="settings-panel">
      <button onClick={onBack}>← 返回</button>
      <h2>设置</h2>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}

      <h3>数据库连接</h3>
      {loading && !settings ? (
        <p className="muted">加载中…</p>
      ) : (
        <dl className="settings-db">
          <div className="settings-db-row">
            <dt>主机</dt>
            <dd>{db?.host || '—'}</dd>
          </div>
          <div className="settings-db-row">
            <dt>端口</dt>
            <dd>{db?.port || '—'}</dd>
          </div>
          <div className="settings-db-row">
            <dt>数据库</dt>
            <dd>{db?.database || '—'}</dd>
          </div>
          <div className="settings-db-row">
            <dt>用户名</dt>
            <dd>{db?.username || '—'}</dd>
          </div>
          <div className="settings-db-row">
            <dt>密码</dt>
            <dd>{db?.passwordConfigured ? '已配置（安全起见不展示）' : '未配置'}</dd>
          </div>
        </dl>
      )}

      <h3>外观</h3>
      <div className="settings-theme" role="radiogroup" aria-label="主题">
        {THEME_MODES.map((m) => (
          <label key={m} className={`settings-theme-option${settings?.theme === m ? ' active' : ''}`}>
            <input
              type="radio"
              name="theme"
              value={m}
              checked={settings?.theme === m}
              onChange={() => void setTheme(m)}
              disabled={saving}
            />
            {THEME_LABELS[m]}
          </label>
        ))}
      </div>

      <h3>默认仓库路径</h3>
      <p className="muted">新建会话未指定仓库时按「会话 → 工作区 → 全局默认」回退继承该路径。</p>
      <div className="settings-repo">
        <input
          value={repoDraft}
          onChange={(e) => setRepoDraft(e.target.value)}
          placeholder="如 D:/projects/my-repo（须为含 .git 的仓库目录）"
          aria-label="默认仓库路径"
        />
        <button onClick={() => void saveRepo()} disabled={saving || repoDraft.trim() === (settings?.defaultRepoPath ?? '')}>
          保存
        </button>
        <button
          onClick={() => void clearRepo()}
          disabled={saving || !settings?.defaultRepoPath}
        >
          清除
        </button>
      </div>
    </section>
  )
}
