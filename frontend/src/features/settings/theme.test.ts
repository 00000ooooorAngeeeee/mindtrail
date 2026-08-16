import { beforeEach, describe, expect, it } from 'vitest'
import { applyTheme, resolveTheme } from './theme'

describe('主题工具（M4 任务四，03 §6）', () => {
  beforeEach(() => {
    document.documentElement.removeAttribute('data-theme')
  })

  it('light/dark 直接透传，system 跟随系统偏好', () => {
    expect(resolveTheme('light', true)).toBe('light')
    expect(resolveTheme('dark', false)).toBe('dark')
    expect(resolveTheme('system', true)).toBe('dark')
    expect(resolveTheme('system', false)).toBe('light')
  })

  it('applyTheme 写入 data-theme 与 colorScheme', () => {
    const el = document.createElement('div')
    applyTheme('dark', el)
    expect(el.getAttribute('data-theme')).toBe('dark')
    expect(el.style.colorScheme).toBe('dark')

    applyTheme('light', el)
    expect(el.getAttribute('data-theme')).toBe('light')
    expect(el.style.colorScheme).toBe('light')
  })

  it('applyTheme 缺省作用于 documentElement', () => {
    applyTheme('dark')
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark')
  })
})
