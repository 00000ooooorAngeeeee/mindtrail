import type { TagInfo } from '../../api/types'

/**
 * 标签云纯函数（v1.1 P1，PRD D4「标签云视图 P1」）：
 * 按使用计数（entryCount）将标签分档字号、按热度降序排列、循环色板着色。
 */

/** 字号档位（CSS 类由 tag.css 定义：size-sm/md/lg/xl）。 */
export type CloudSize = 'sm' | 'md' | 'lg' | 'xl'

/** 标签云色板（浅色底深字，保持便签效果，03 §6 同源）。 */
export const CLOUD_COLORS = ['indigo', 'green', 'amber', 'rose', 'sky'] as const

/**
 * 计数 → 字号档位（热度分级）：
 * 0-1 sm ｜ 2-4 md ｜ 5-9 lg ｜ 10+ xl。
 */
export function tagCloudSize(count: number): CloudSize {
  if (count >= 10) return 'xl'
  if (count >= 5) return 'lg'
  if (count >= 2) return 'md'
  return 'sm'
}

/** 按列表序号循环取色（顺序稳定，避免标签名 hash 碰撞导致颜色漂移）。 */
export function tagCloudColor(index: number): string {
  return CLOUD_COLORS[index % CLOUD_COLORS.length]
}

/** 云展示顺序：热度（计数）降序，同计数保持原相对顺序（稳定排序）。 */
export function tagCloudOrder(tags: TagInfo[]): TagInfo[] {
  return [...tags].sort((a, b) => b.entryCount - a.entryCount)
}
