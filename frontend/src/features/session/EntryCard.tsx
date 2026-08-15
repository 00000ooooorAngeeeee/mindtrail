import { memo } from 'react'
import { ENTRY_TYPE_ICONS, ENTRY_TYPE_LABELS, type Entry } from '../../api/types'
import { shortHash } from './gitTimeline'
import { renderMarkdown } from './markdown'

/**
 * 条目卡片展示态（memo 化）：Markdown 渲染（06 §9）+ 标签 + commit 徽标（点击查看详情，PRD C3.5）。
 * 时间线无限滚动追加时，未变化条目跳过重渲染（1000 条目滚动流畅，07 §6 验收 N2）。
 * 编辑态仍由 SessionView 内联处理（编辑是低频单点操作，不做 memo 拆分）。
 */
export const EntryCard = memo(function EntryCard({
  entry,
  onEdit,
  onDelete,
  onCommitClick,
}: {
  entry: Entry
  onEdit: (entry: Entry) => void
  onDelete: (entry: Entry) => void
  onCommitClick: (entry: Entry, hash: string) => void
}) {
  return (
    <div className="entry-card">
      <div className="entry-meta">
        <span className="entry-icon" aria-hidden="true">
          {ENTRY_TYPE_ICONS[entry.type]}
        </span>
        <span className="entry-chip">{ENTRY_TYPE_LABELS[entry.type]}</span>
        <span className="entry-seq">#{entry.seq}</span>
      </div>
      <div
        className="entry-content entry-md"
        data-testid={`entry-md-${entry.id}`}
        // renderMarkdown 以 html:false 禁用原始 HTML，输出安全（markdown.ts）
        dangerouslySetInnerHTML={{ __html: renderMarkdown(entry.contentMd) }}
      />
      {entry.tags && entry.tags.length > 0 && (
        <div className="entry-tags">
          {entry.tags.map((t) => (
            <span key={t} className="tag-chip">
              {t}
            </span>
          ))}
        </div>
      )}
      {entry.commits && entry.commits.length > 0 && (
        <div className="entry-commits">
          {entry.commits.map((h) => (
            <button key={h} className="commit-badge" title={`查看提交详情 ${h}`} onClick={() => onCommitClick(entry, h)}>
              {shortHash(h)}
            </button>
          ))}
        </div>
      )}
      <div className="entry-actions">
        <button onClick={() => onEdit(entry)}>编辑</button>
        <button className="danger" onClick={() => onDelete(entry)}>
          删除
        </button>
      </div>
    </div>
  )
})
