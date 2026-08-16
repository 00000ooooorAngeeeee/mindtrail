import '@testing-library/jest-dom/vitest'
import { MockIntersectionObserver } from './intersectionObserver'

// jsdom 无 IntersectionObserver：装全局桩（无限滚动哨兵），具体触发由用例调用 MockIntersectionObserver 完成。
globalThis.IntersectionObserver = MockIntersectionObserver as unknown as typeof IntersectionObserver

// jsdom 无 scrollIntoView：装空实现（搜索空态「按标签浏览」聚焦标签面板依赖，M4 任务五）。
if (typeof Element.prototype.scrollIntoView !== 'function') {
  Element.prototype.scrollIntoView = () => {}
}

// jsdom 无 matchMedia：装最小桩（设置页主题「跟随系统」与 App 启动主题加载依赖）。
if (typeof window.matchMedia !== 'function') {
  window.matchMedia = ((query: string) =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }) as unknown as MediaQueryList) as unknown as typeof window.matchMedia
}
