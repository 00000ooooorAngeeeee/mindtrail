import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { deleteWithUndo } from './undoDelete'
import { __resetToastsForTest, getToasts } from './toast'

beforeEach(() => {
  vi.useFakeTimers()
  __resetToastsForTest()
})
afterEach(() => {
  vi.useRealTimers()
  __resetToastsForTest()
})

describe('deleteWithUndo', () => {
  it('乐观移除立即执行；未到时不删除不恢复', () => {
    const remove = vi.fn()
    const restore = vi.fn()
    const del = vi.fn().mockResolvedValue(undefined)
    deleteWithUndo({
      label: '导图「A」',
      performDelete: del,
      optimisticRemove: remove,
      optimisticRestore: restore,
    })
    expect(remove).toHaveBeenCalledTimes(1)
    expect(restore).not.toHaveBeenCalled()
    expect(del).not.toHaveBeenCalled()
  })

  it('到期未撤销 → 执行真正删除', async () => {
    const del = vi.fn().mockResolvedValue(undefined)
    deleteWithUndo({
      label: 'X',
      performDelete: del,
      optimisticRemove: () => {},
      optimisticRestore: () => {},
    })
    vi.advanceTimersByTime(5000)
    await vi.runAllTicks()
    expect(del).toHaveBeenCalledTimes(1)
  })

  it('撤销 → 恢复 UI 且到期不删除', async () => {
    const restore = vi.fn()
    const del = vi.fn().mockResolvedValue(undefined)
    deleteWithUndo({
      label: 'X',
      performDelete: del,
      optimisticRemove: () => {},
      optimisticRestore: restore,
    })
    // 模拟点击撤销（toast onAction）
    const [toast] = getToasts()
    expect(toast).toBeTruthy()
    toast!.onAction?.()
    expect(restore).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(5000)
    await vi.runAllTicks()
    expect(del).not.toHaveBeenCalled()
  })

  it('删除失败 → 恢复 UI 并弹错误 toast', async () => {
    const restore = vi.fn()
    const del = vi.fn().mockRejectedValue(new Error('boom'))
    deleteWithUndo({
      label: 'X',
      performDelete: del,
      optimisticRemove: () => {},
      optimisticRestore: restore,
    })
    vi.advanceTimersByTime(5000)
    await vi.runAllTicks()
    expect(del).toHaveBeenCalledTimes(1)
    expect(restore).toHaveBeenCalledTimes(1)
    expect(getToasts().some((t) => t.message.includes('删除失败'))).toBe(true)
  })
})
