// 节点挂接条目详情弹层（v1.1 P1）：点节点 📎 徽标弹出，列出挂接的条目（会话/类型/序号/预览），
// 点击条目跳转会话时间线定位（复用 PRD D2 搜索跳转机制）。
import { useEffect, useState } from 'react'
import { getNodeLinks } from '../../api/linkage'
import { ENTRY_TYPE_ICONS, type LinkedEntry } from '../../api/types'
import { previewLine } from './linkage'

export function NodeLinksPopover({
  mindmapId,
  nodeId,
  nodeText,
  x,
  y,
  onClose,
  onOpenEntry,
  onManage,
}: {
  mindmapId: number
  nodeId: string
  nodeText: string
  /** 屏幕坐标（锚定节点旁，由编辑器 flowToScreenPosition 计算）。 */
  x: number
  y: number
  onClose: () => void
  /** 点击某条挂接：跳转会话时间线定位该条目。 */
  onOpenEntry: (entry: LinkedEntry) => void
  /** 打开挂接管理对话框。 */
  onManage: () => void
}) {
  const [links, setLinks] = useState<LinkedEntry[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    getNodeLinks(mindmapId, nodeId)
      .then(setLinks)
      .catch((e) => setError(e instanceof Error ? e.message : '加载挂接失败'))
  }, [mindmapId, nodeId])

  return (
    <>
      {/* 点击外部关闭的透明层 */}
      <div
        style={{ position: 'fixed', inset: 0, zIndex: 29 }}
        onClick={onClose}
        aria-hidden="true"
      />
      <div className="mm-links-popover" style={{ left: Math.min(x, window.innerWidth - 340), top: y }} role="dialog" aria-label="挂接条目详情">
        <div className="mm-links-popover-head">
          <span className="mm-links-node" title={nodeText}>
            📎 {nodeText || '（空白便签）'}
          </span>
          <button onClick={onManage}>管理挂接</button>
        </div>
        <div className="mm-links-popover-body">
          {error ? (
            <div className="mm-links-error">{error}</div>
          ) : links === null ? (
            <div className="mm-links-empty">加载中…</div>
          ) : links.length === 0 ? (
            <div className="mm-links-empty">暂无挂接条目</div>
          ) : (
            links.map((l) => (
              <button key={l.entryId} className="mm-links-popover-item" onClick={() => onOpenEntry(l)}>
                <span aria-hidden="true">{ENTRY_TYPE_ICONS[l.type]}</span>
                <span className="mm-links-meta">
                  <span className="mm-links-title">
                    {l.sessionTitle} <span className="muted">#{l.seq}</span>
                  </span>
                  <span className="mm-links-preview">{previewLine(l.contentPreview)}</span>
                </span>
              </button>
            ))
          )}
        </div>
      </div>
    </>
  )
}
