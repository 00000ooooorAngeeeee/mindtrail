import { memo } from 'react'
import type { TagInfo } from '../../api/types'
import { tagCloudColor, tagCloudOrder, tagCloudSize } from './tagCloudUtil'

/**
 * 标签云（v1.1 P1，PRD D4「标签云视图 P1」）：
 * 工作区标签的热度可视化——按使用计数分档字号（sm/md/lg/xl）、热度降序排列、循环色板着色，
 * 点击标签即时过滤条目（与列表入口同一 openFilter 路径）。
 * 仅展示与点击，管理操作（重命名/合并/删除）仍在下方列表。
 */
export const TagCloud = memo(function TagCloud({
  tags,
  activeTagId,
  onPick,
}: {
  tags: TagInfo[]
  /** 当前过滤中的标签 id（高亮）。 */
  activeTagId?: number | null
  /** 点击标签：与列表过滤同一回调。 */
  onPick: (tag: TagInfo) => void
}) {
  if (tags.length === 0) return null
  return (
    <div className="tag-cloud" aria-label="标签云">
      {tagCloudOrder(tags).map((t, i) => (
        <button
          key={t.id}
          className={`tag-cloud-chip size-${tagCloudSize(t.entryCount)} color-${tagCloudColor(i)}${
            activeTagId === t.id ? ' active' : ''
          }`}
          title={`${t.name}（${t.entryCount} 条）`}
          aria-label={t.name}
          onClick={() => onPick(t)}
        >
          {t.name}
        </button>
      ))}
    </div>
  )
})
