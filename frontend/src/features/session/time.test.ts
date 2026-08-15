import { describe, expect, it } from 'vitest'
import { formatTime } from './time'

describe('formatTime：时间线条目时间戳格式化', () => {
  it('ISO 时间转为本地 HH:mm（06 §4 条目标题时间精度到分）', () => {
    expect(formatTime('2025-06-01T09:02:00')).toBe('09:02')
    expect(formatTime('2025-06-01T23:59:30')).toBe('23:59')
  })

  it('空值返回空串', () => {
    expect(formatTime(null)).toBe('')
    expect(formatTime(undefined)).toBe('')
    expect(formatTime('')).toBe('')
  })

  it('非法时间返回空串', () => {
    expect(formatTime('not-a-date')).toBe('')
  })
})
