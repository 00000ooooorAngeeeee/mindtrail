import type { GitCommit } from '../../api/types'

/**
 * commit 详情弹层（PRD C3.5）：hash、作者、时间、完整 message、变更文件列表 + 解绑入口。
 * diff 预览为 P1（07 §8），MVP 不实现。数据由父组件从 Git 面板缓存或详情接口获取。
 */
export function CommitDetailModal({
  commit,
  error,
  onClose,
  onUnbind,
}: {
  commit: GitCommit | null
  error: string | null
  onClose: () => void
  onUnbind: () => void
}) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal commit-detail" role="dialog" aria-label="提交详情" onClick={(e) => e.stopPropagation()}>
        <h3>提交详情</h3>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        {commit ? (
          <>
            <p className="commit-detail-hash">
              <code title={commit.hash}>{commit.hash}</code>
            </p>
            <p>
              <strong>作者</strong>：{commit.author}
              {commit.authorEmail ? ` <${commit.authorEmail}>` : ''}
            </p>
            <p>
              <strong>时间</strong>：{commit.time ?? '—'}
            </p>
            <p>
              <strong>提交信息</strong>
            </p>
            <pre className="commit-msg-full">{commit.message}</pre>
            <p>
              <strong>变更文件</strong>（{commit.files.length}）
            </p>
            {commit.files.length > 0 ? (
              <ul className="commit-files">
                {commit.files.map((f) => (
                  <li key={f}>{f}</li>
                ))}
              </ul>
            ) : (
              <p className="muted">（空提交，无文件变更）</p>
            )}
            <div className="modal-actions">
              <button className="danger" onClick={onUnbind}>
                解绑
              </button>
              <button onClick={onClose}>关闭</button>
            </div>
          </>
        ) : (
          <p className="muted">加载中…</p>
        )}
      </div>
    </div>
  )
}
