import { useEffect, useRef } from 'react'

/**
 * 无限滚动哨兵（04 §8 时间线 1000 条预算，每页 50，07 §6 任务二）：
 * 列表尾部哨兵元素进入视口（提前 200px）时回调加载下一页；
 * hasMore=false 或加载中不创建观察，避免重复请求。
 */
export function useInfiniteScroll(hasMore: boolean, loading: boolean, onLoadMore: () => void) {
  const sentinelRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const el = sentinelRef.current
    if (!el || !hasMore || loading || typeof IntersectionObserver === 'undefined') return
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) onLoadMore()
      },
      { rootMargin: '200px' },
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [hasMore, loading, onLoadMore])

  return sentinelRef
}
