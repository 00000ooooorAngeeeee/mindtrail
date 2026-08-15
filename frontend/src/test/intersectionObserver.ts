import { vi } from 'vitest'

/**
 * IntersectionObserver 测试桩（jsdom 无原生实现）：
 * setup.ts 安装为全局；用例经 MockIntersectionObserver.instances 找到实例并手动触发进入视口。
 */
export class MockIntersectionObserver {
  static instances: MockIntersectionObserver[] = []

  observe = vi.fn()
  unobserve = vi.fn()
  disconnect = vi.fn()
  takeRecords = vi.fn(() => [])

  constructor(public callback: IntersectionObserverCallback) {
    MockIntersectionObserver.instances.push(this)
  }

  /** 模拟哨兵元素进入视口。 */
  triggerIntersect() {
    this.callback(
      [{ isIntersecting: true } as IntersectionObserverEntry],
      this as unknown as IntersectionObserver,
    )
  }

  static reset() {
    MockIntersectionObserver.instances = []
  }
}
