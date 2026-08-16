import { useEffect, useState } from 'react'
import type { CommitDiff, GitCommit } from '../../api/types'
import { getCommitDiff } from '../../api/git'

/**
 * commit 详情弹层（PRD C3.5）：hash、作者、时间、完整 message、变更文件列表 + 解绑入口。
 * diff 预览（v1.1 P1 C3.6，PRD C3.5「diff 预览 P1」）：弹层内按提交拉取 unified diff，
 * 每文件折叠展示（+/- 行着色 + 增删徽标），超限截断提示；diff 失败不阻塞详情展示。
 */
export function CommitDetailModal({
  commit,
  error,
  repoPath,
  onClose,
  onUnbind,
}: {
  commit: GitCommit | null
  error: string | null
  /** 会话关联仓库路径：非空时拉取 diff 预览（04 §5 GET /git/repo/commits/{hash}/diff）。 */
  repoPath?: string | null
  onClose: () => void
  onUnbind: () => void
}) {
  const [diff, setDiff] = useState<CommitDiff | null>(null)
  const [diffError, setDiffError] = useState<string | null>(null)

  useEffect(() => {
    setDiff(null)
    setDiffError(null)
    if (!commit || !repoPath) return
    let cancelled = false
    getCommitDiff(repoPath, commit.hash)
      .then((d) => {
        if (!cancelled) setDiff(d)
      })
      .catch((e: unknown) => {
        if (!cancelled) setDiffError(e instanceof Error ? e.message : '加载 diff 失败')
      })
    return () => {
      cancelled = true
    }
  }, [commit, repoPath])

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

            {/* diff 预览（v1.1 P1 C3.6，PRD C3.5「diff 预览 P1」）：每文件折叠展示 +/- 行 */}
            {repoPath && (
              <section aria-label="diff 预览">
                <p>
                  <strong>Diff 预览</strong>
                  {diff && (
                    <span className="muted">
                      {' '}
                      （{diff.files.length} 文件{diff.truncated ? '，已截断' : ''}）
                    </span>
                  )}
                </p>
                {diffError ? (
                  <p className="error" role="alert">
                    {diffError}
                  </p>
                ) : !diff ? (
                  <p className="muted">加载中…</p>
                ) : diff.files.length === 0 ? (
                  <p className="muted">（空提交，无 diff）</p>
                ) : (
                  <div className="commit-diff-list">
                    {diff.files.map((f) => (
                      <details key={f.path} className="commit-diff-file" open={diff.files.length <= 3}>
                        <summary>
                          <span className="commit-diff-path">{f.path}</span>
                          <span className="commit-diff-stats">
                            <span className="diff-added">+{f.added}</span>
                            <span className="diff-deleted">−{f.deleted}</span>
                          </span>
                        </summary>
                        <pre className="commit-diff-text">
                          {f.diff.split('\n').map((line, i) => {
                            const cls = line.startsWith('+') && !line.startsWith('+++')
                              ? 'diff-line-add'
                              : line.startsWith('-') && !line.startsWith('---')
                                ? 'diff-line-del'
                                : line.startsWith('@@')
                                  ? 'diff-line-hunk'
                                  : ''
                            return (
                              <div key={i} className={cls}>
                                {line || ' '}
                              </div>
                            )
                          })}
                        </pre>
                      </details>
                    ))}
                  </div>
                )}
              </section>
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
