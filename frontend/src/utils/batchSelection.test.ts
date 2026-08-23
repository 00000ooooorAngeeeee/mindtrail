import { describe, expect, it } from 'vitest'
import {
  batchConfirmText,
  effectiveSelectedCount,
  isAllSelected,
  selectAllIds,
  toggleIdInSet,
} from './batchSelection'

describe('batchSelection 纯函数', () => {
  it('toggleIdInSet 不可变地切换选中态', () => {
    const base = new Set<number>([1, 2])
    const added = toggleIdInSet(base, 3)
    expect([...added]).toEqual([1, 2, 3])
    expect([...base]).toEqual([1, 2]) // 原 Set 不变

    const removed = toggleIdInSet(base, 1)
    expect([...removed]).toEqual([2])
  })

  it('selectAllIds 用全部 id 构造新集合', () => {
    const s = selectAllIds([5, 6, 7])
    expect([...s]).toEqual([5, 6, 7])
    expect(selectAllIds([]).size).toBe(0)
  })

  it('isAllSelected 仅当 allIds 非空且全被选中时为 true', () => {
    const selected = new Set([1, 2, 3])
    expect(isAllSelected(selected, [1, 2, 3])).toBe(true)
    expect(isAllSelected(selected, [1, 2])).toBe(true) // 多选不影响判定
    expect(isAllSelected(new Set([1, 3]), [1, 2, 3])).toBe(false)
    expect(isAllSelected(new Set(), [])).toBe(false) // 空列表不算全选
  })

  it('effectiveSelectedCount 剔除已不在列表中的陈旧 id', () => {
    const selected = new Set([1, 2, 99]) // 99 已被删除
    expect(effectiveSelectedCount(selected, [1, 2, 3])).toBe(2)
    expect(effectiveSelectedCount(new Set(), [1, 2])).toBe(0)
  })

  it('batchConfirmText 含数量与不可撤销提示，cascade 时提示级联', () => {
    expect(batchConfirmText('导图', 3)).toContain('3 个导图')
    expect(batchConfirmText('导图', 3)).toContain('不可撤销')
    expect(batchConfirmText('工作区', 2, true)).toContain('级联删除其全部子数据')
  })
})
