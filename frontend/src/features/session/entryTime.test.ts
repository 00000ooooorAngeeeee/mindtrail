import { describe, expect, it, vi } from 'vitest'
import { datetimeLocalToIso, isoToDatetimeLocal, nowLocalIso } from './entryTime'

describe('entryTime 补记时间工具（PRD C2.4）', () => {
  it('isoToDatetimeLocal：ISO 秒级字符串 → datetime-local 值（本地时区逐位还原）', () => {
    expect(isoToDatetimeLocal('2025-06-01T09:02:00')).toBe('2025-06-01T09:02:00')
    expect(isoToDatetimeLocal('2026-01-02T03:04:05')).toBe('2026-01-02T03:04:05')
  })

  it('isoToDatetimeLocal：空值与非法输入返回空串', () => {
    expect(isoToDatetimeLocal(null)).toBe('')
    expect(isoToDatetimeLocal(undefined)).toBe('')
    expect(isoToDatetimeLocal('')).toBe('')
    expect(isoToDatetimeLocal('not-a-time')).toBe('')
  })

  it('datetimeLocalToIso：分钟粒度自动补秒', () => {
    expect(datetimeLocalToIso('2025-06-01T09:02')).toBe('2025-06-01T09:02:00')
    expect(datetimeLocalToIso('2025-06-01T09:02:05')).toBe('2025-06-01T09:02:05')
  })

  it('datetimeLocalToIso：空白与非法输入返回空串（后端走默认当前时间）', () => {
    expect(datetimeLocalToIso('')).toBe('')
    expect(datetimeLocalToIso('   ')).toBe('')
    expect(datetimeLocalToIso('2025-13-40T99:99')).toBe('')
  })

  it('nowLocalIso：返回当前本地时间秒级 ISO（插入面板默认值）', () => {
    vi.setSystemTime(new Date('2025-06-01T10:30:00'))
    expect(nowLocalIso()).toBe('2025-06-01T10:30:00')
    vi.useRealTimers()
  })
})
