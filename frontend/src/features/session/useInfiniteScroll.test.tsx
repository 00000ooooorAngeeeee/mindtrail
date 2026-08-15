import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from '@testing-library/react'
import { useInfiniteScroll } from './useInfiniteScroll'
import { MockIntersectionObserver } from '../../test/intersectionObserver'

/** 宿主组件：把 hook 返回的哨兵 ref 挂到真实 DOM 上（与 SessionView 使用方式一致）。 */
function Host({
  hasMore,
  loading,
  onLoadMore,
}: {
  hasMore: boolean
  loading: boolean
  onLoadMore: () => void
}) {
  const sentinelRef = useInfiniteScroll(hasMore, loading, onLoadMore)
  return <div ref={sentinelRef} data-testid="sentinel" />
}

describe('useInfiniteScroll：无限滚动哨兵（04 §8 时间线每页 50）', () => {
  beforeEach(() => MockIntersectionObserver.reset())

  it('hasMore 且非加载中时创建观察并观察哨兵', () => {
    render(<Host hasMore loading={false} onLoadMore={() => {}} />)

    expect(MockIntersectionObserver.instances).toHaveLength(1)
    expect(MockIntersectionObserver.instances[0].observe).toHaveBeenCalled()
  })

  it('哨兵进入视口时回调加载下一页', () => {
    const onLoadMore = vi.fn()
    render(<Host hasMore loading={false} onLoadMore={onLoadMore} />)

    MockIntersectionObserver.instances[0].triggerIntersect()

    expect(onLoadMore).toHaveBeenCalledTimes(1)
  })

  it('hasMore=false 时不创建观察（已全部加载）', () => {
    render(<Host hasMore={false} loading={false} onLoadMore={() => {}} />)
    expect(MockIntersectionObserver.instances).toHaveLength(0)
  })

  it('加载中不创建观察（防重复请求）', () => {
    render(<Host hasMore loading onLoadMore={() => {}} />)
    expect(MockIntersectionObserver.instances).toHaveLength(0)
  })

  it('加载完成后恢复观察（加载更多后继续滚动触发下一页）', () => {
    const { rerender } = render(
      <Host hasMore loading onLoadMore={() => {}} />,
    )
    expect(MockIntersectionObserver.instances).toHaveLength(0)

    rerender(<Host hasMore loading={false} onLoadMore={() => {}} />)

    expect(MockIntersectionObserver.instances).toHaveLength(1)
    expect(MockIntersectionObserver.instances[0].observe).toHaveBeenCalled()
  })

  it('卸载时断开观察', () => {
    const { unmount } = render(<Host hasMore loading={false} onLoadMore={() => {}} />)
    const observer = MockIntersectionObserver.instances[0]

    unmount()

    expect(observer.disconnect).toHaveBeenCalled()
  })
})
