import { useEffect, useRef, useState } from 'react'
import { THEME_LABELS, THEME_MODES } from '../../api/types'
import { useSettingsStore } from '../../store/useSettingsStore'
import { exportBackup, importBackup } from '../../api/backup'
import { downloadBase64File } from '../../utils/download'
import { arrayBufferToBase64, BACKUP_ACCEPT, formatRestoreSummary, readFileAsArrayBuffer } from '../../utils/backupImport'
import './settings.css'

/**
 * 设置页（M4 任务四/六 + v1.2 P2 导入恢复，07 §7/§20：数据库连接信息展示、主题切换、仓库路径、数据备份/恢复；入口 Ctrl+,，03 §5）。
 * 数据库连接为只读展示（密码只显示「已配置/未配置」）；主题三选一即时生效并落库；
 * 默认仓库路径为全局回退值（新建会话仓库回退链：会话 → 工作区 → 全局默认），后端校验 .git 目录；
 * 数据备份导出全部数据为 JSON 压缩包（M4 任务六，PRD E5）；数据恢复从导出的 zip 全量替换当前数据（v1.2 P2，PRD E5「导入恢复」）。
 */
export function SettingsPanel({ onBack }: { onBack: () => void }) {
  const { settings, loading, saving, error, load, setTheme, setDefaultRepoPath } = useSettingsStore()
  const [repoDraft, setRepoDraft] = useState('')
  const [backingUp, setBackingUp] = useState(false)
  const [backupError, setBackupError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [restoring, setRestoring] = useState(false)
  const [restoreResult, setRestoreResult] = useState<string | null>(null)
  const [restoreError, setRestoreError] = useState<string | null>(null)

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

  /** 导出全量备份（M4 任务六，PRD E5）：zip（Base64）→ 浏览器下载。 */
  const handleBackup = async () => {
    if (backingUp) return
    setBackingUp(true)
    setBackupError(null)
    try {
      const file = await exportBackup()
      downloadBase64File(file.filename, file.content, file.contentType)
    } catch (e) {
      setBackupError(e instanceof Error ? e.message : '导出备份失败')
    } finally {
      setBackingUp(false)
    }
  }

  /**
   * 导入恢复（v1.2 P2，PRD E5「导入恢复」）：选 zip → 二次确认 → 读 Base64 → POST /backup/import。
   * 全量替换语义（清空 9 表 + 按原 id 回填），不可撤销，故先弹窗警告；成功后展示摘要并提供刷新入口。
   */
  const handleRestore = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    if (!window.confirm('导入将清除并替换当前全部数据，且不可撤销。建议先导出当前备份。确定继续？')) {
      if (fileInputRef.current) fileInputRef.current.value = ''
      return
    }
    setRestoring(true)
    setRestoreResult(null)
    setRestoreError(null)
    try {
      const buf = await readFileAsArrayBuffer(file)
      const summary = await importBackup(arrayBufferToBase64(buf))
      setRestoreResult(formatRestoreSummary(summary))
    } catch (err) {
      setRestoreError(err instanceof Error ? err.message : '导入恢复失败')
    } finally {
      setRestoring(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
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

      <h3>数据备份</h3>
      <p className="muted">
        导出全部数据（工作区/导图/会话/条目/标签/绑定/设置）为 JSON 压缩包，用于留存与迁移。
      </p>
      {backupError && (
        <p className="error" role="alert">
          {backupError}
        </p>
      )}
      <div className="settings-backup">
        <button onClick={() => void handleBackup()} disabled={backingUp}>
          {backingUp ? '导出中…' : '导出全量备份'}
        </button>
      </div>

      <h3>数据恢复</h3>
      <p className="muted">
        从导出的 zip 备份恢复全部数据。⚠ 将清除并替换当前全部数据，不可撤销，恢复前请先导出当前备份。
      </p>
      {restoreResult && <p className="ok">{restoreResult}</p>}
      {restoreError && (
        <p className="error" role="alert">
          {restoreError}
        </p>
      )}
      <div className="settings-restore">
        <input
          ref={fileInputRef}
          type="file"
          accept={BACKUP_ACCEPT}
          onChange={(e) => void handleRestore(e)}
          hidden
        />
        <button onClick={() => fileInputRef.current?.click()} disabled={restoring}>
          {restoring ? '恢复中…' : '导入备份恢复'}
        </button>
        {restoreResult && <button onClick={() => window.location.reload()}>刷新页面</button>}
      </div>
    </section>
  )
}
