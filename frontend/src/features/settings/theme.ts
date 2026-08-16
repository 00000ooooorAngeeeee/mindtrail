// 主题工具（M4 任务四，03 §6「浅色/深色两套，默认跟随系统（MVP 提供手动切换）」）：
// 解析（system → 跟随系统偏好）与应用（写 documentElement 的 data-theme 属性，CSS 变量随属性切换）。
import type { ThemeMode } from '../../api/types'

export type ResolvedTheme = 'light' | 'dark'

/** system 模式解析为具体深浅色；light/dark 直接透传。 */
export function resolveTheme(theme: ThemeMode, prefersDark: boolean): ResolvedTheme {
  if (theme === 'system') {
    return prefersDark ? 'dark' : 'light'
  }
  return theme
}

/** 系统深浅色偏好（jsdom 无 matchMedia 时回落 false，测试与启动兜底共用）。 */
export function prefersDark(): boolean {
  return window.matchMedia?.('(prefers-color-scheme: dark)')?.matches ?? false
}

/**
 * 把解析后的主题应用到 <html data-theme>（纯函数便于单测）。
 * el 缺省取 document.documentElement（jsdom 与浏览器均可用）。
 */
export function applyTheme(resolved: ResolvedTheme, el: HTMLElement = document.documentElement): void {
  el.setAttribute('data-theme', resolved)
  el.style.colorScheme = resolved
}
