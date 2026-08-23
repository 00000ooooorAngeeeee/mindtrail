import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  __resetToastsForTest,
  dismissToast,
  getToasts,
  runToastAction,
  showToast,
  subscribeToast,
} from './toast'

beforeEach(() => {
  vi.useFakeTimers()
  __resetToastsForTest()
})
afterEach(() => {
  vi.useRealTimers()
  __resetToastsForTest()
})

describe('toast', () => {
  it('showToast 添加并返回递增 id', () => {
    const id1 = showToast('hi')
    const id2 = showToast('yo')
    expect(getToasts()).toHaveLength(2)
    expect(getToasts()[0].message).toBe('hi')
    expect(id2).toBe(id1 + 1)
  })

  it('dismissToast 移除并取消定时器', () => {
    const id = showToast('hi')
    dismissToast(id)
    expect(getToasts()).toHaveLength(0)
    // 不存在的 id 不报错
    dismissToast(999)
    expect(getToasts()).toHaveLength(0)
  })

  it('默认 5000ms 自动消失，临界点不提前', () => {
    showToast('hi')
    vi.advanceTimersByTime(4999)
    expect(getToasts()).toHaveLength(1)
    vi.advanceTimersByTime(1)
    expect(getToasts()).toHaveLength(0)
  })

  it('durationMs=0 不自动消失', () => {
    showToast('hi', { durationMs: 0 })
    vi.advanceTimersByTime(10000)
    expect(getToasts()).toHaveLength(1)
  })

  it('subscribe 立即投递快照并随变化更新；取消后不再收到', () => {
    const seen: number[] = []
    const unsub = subscribeToast((t) => seen.push(t.length))
    expect(seen).toEqual([0])
    showToast('hi')
    expect(seen).toEqual([0, 1])
    unsub()
    showToast('yo')
    expect(seen).toEqual([0, 1])
  })

  it('runToastAction 调用动作并关闭 toast', () => {
    const action = vi.fn()
    const id = showToast('hi', { actionLabel: '撤销', onAction: action })
    runToastAction(id)
    expect(action).toHaveBeenCalledTimes(1)
    expect(getToasts()).toHaveLength(0)
  })

  it('runToastAction 对不存在的 id 为 no-op', () => {
    expect(() => runToastAction(999)).not.toThrow()
  })
})
