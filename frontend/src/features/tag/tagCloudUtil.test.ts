import { describe, expect, it } from 'vitest'
import type { TagInfo } from '../../api/types'
import { CLOUD_COLORS, tagCloudColor, tagCloudOrder, tagCloudSize } from './tagCloudUtil'

const tag = (id: number, name: string, entryCount: number): TagInfo => ({ id, workspaceId: 1, name, entryCount })

describe('标签云纯函数（v1.1 P1，PRD D4「标签云视图 P1」）', () => {
  it('tagCloudSize：计数分档（0-1 sm / 2-4 md / 5-9 lg / 10+ xl）', () => {
    expect(tagCloudSize(0)).toBe('sm')
    expect(tagCloudSize(1)).toBe('sm')
    expect(tagCloudSize(2)).toBe('md')
    expect(tagCloudSize(4)).toBe('md')
    expect(tagCloudSize(5)).toBe('lg')
    expect(tagCloudSize(9)).toBe('lg')
    expect(tagCloudSize(10)).toBe('xl')
    expect(tagCloudSize(99)).toBe('xl')
  })

  it('tagCloudColor：按序号循环色板', () => {
    expect(tagCloudColor(0)).toBe(CLOUD_COLORS[0])
    expect(tagCloudColor(CLOUD_COLORS.length)).toBe(CLOUD_COLORS[0]) // 循环
    expect(tagCloudColor(1)).toBe('green')
  })

  it('tagCloudOrder：热度降序且同计数保持原顺序（稳定）', () => {
    const tags = [tag(1, '低频', 1), tag(2, '高频', 9), tag(3, '中频', 4), tag(4, '低频2', 1)]
    const ordered = tagCloudOrder(tags)
    expect(ordered.map((t) => t.name)).toEqual(['高频', '中频', '低频', '低频2'])
    expect(ordered).not.toBe(tags) // 不原地修改
  })
})
