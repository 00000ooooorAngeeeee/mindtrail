import { describe, expect, it } from 'vitest'
import { arrayBufferToBase64, formatRestoreSummary } from './backupImport'
import type { RestoreSummary } from '../api/backup'

describe('backupImport 备份导入恢复纯函数', () => {
  describe('arrayBufferToBase64', () => {
    it('与 btoa 逐字节一致（ASCII round-trip）', () => {
      const text = 'TrailMind 备份'
      const buf = new TextEncoder().encode(text).buffer as ArrayBuffer
      // btoa 只能处理 Latin1；含中文时改以字节视角比对：解码回字节与原文编码一致
      const b64 = arrayBufferToBase64(buf)
      const decoded = new Uint8Array(
        atob(b64)
          .split('')
          .map((c) => c.charCodeAt(0)),
      )
      expect(Array.from(decoded)).toEqual(Array.from(new TextEncoder().encode(text)))
    })

    it('空缓冲返回空字符串', () => {
      expect(arrayBufferToBase64(new ArrayBuffer(0))).toBe('')
    })

    it('单字节边界与已知值', () => {
      const buf = new Uint8Array([80, 75, 3, 4]).buffer as ArrayBuffer // "PK\x03\x04" zip 魔数
      expect(arrayBufferToBase64(buf)).toBe(btoa('PK\x03\x04'))
    })

    it('超过分块阈值（32K+）仍可还原', () => {
      const len = 0x8000 + 123 // 跨一段
      const bytes = new Uint8Array(len)
      for (let i = 0; i < len; i++) bytes[i] = i % 251 // 伪随机字节
      const b64 = arrayBufferToBase64(bytes.buffer as ArrayBuffer)
      const decoded = new Uint8Array(
        atob(b64)
          .split('')
          .map((c) => c.charCodeAt(0)),
      )
      expect(Array.from(decoded)).toEqual(Array.from(bytes))
    })
  })

  describe('formatRestoreSummary', () => {
    const full: RestoreSummary = {
      workspace: 3, mindmap: 7, session: 12, entry: 88, tag: 5,
      entryTag: 40, entryCommit: 6, nodeEntry: 9, setting: 2,
      total: 3 + 7 + 12 + 88 + 5 + 40 + 6 + 9 + 2, exportedAt: '2025-08-16T12:00:00',
    }

    it('列出非零表项 + 绑定合并 + 总计 + 恢复时间', () => {
      const msg = formatRestoreSummary(full)
      expect(msg).toContain('已恢复 172 条记录')
      expect(msg).toContain('工作区 3')
      expect(msg).toContain('导图 7')
      expect(msg).toContain('条目 88')
      expect(msg).toContain('绑定 55') // 40+6+9
      expect(msg).toContain('恢复至 2025-08-16T12:00:00')
    })

    it('空备份给出「已恢复 0 条记录」无明细括号', () => {
      const empty: RestoreSummary = {
        workspace: 0, mindmap: 0, session: 0, entry: 0, tag: 0,
        entryTag: 0, entryCommit: 0, nodeEntry: 0, setting: 0,
        total: 0, exportedAt: '2025-08-16T12:00:00',
      }
      const msg = formatRestoreSummary(empty)
      expect(msg).toBe('已恢复 0 条记录，恢复至 2025-08-16T12:00:00')
    })
  })
})
