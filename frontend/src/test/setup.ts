import '@testing-library/jest-dom/vitest'
import { MockIntersectionObserver } from './intersectionObserver'

// jsdom 无 IntersectionObserver：装全局桩（无限滚动哨兵），具体触发由用例调用 MockIntersectionObserver 完成。
globalThis.IntersectionObserver = MockIntersectionObserver as unknown as typeof IntersectionObserver
