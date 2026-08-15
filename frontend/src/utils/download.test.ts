import { afterEach, describe, expect, it, vi } from 'vitest'
import { base64ToBytes, downloadBase64File, downloadTextFile, sanitizeFileName } from './download'

describe('sanitizeFileName（Windows 文件名安全化，与后端规则一致）', () => {
  it('替换非法字符与控制字符为下划线', () => {
    expect(sanitizeFileName('验收/导图')).toBe('验收_导图')
    expect(sanitizeFileName('a:b*c?')).toBe('a_b_c_')
    expect(sanitizeFileName('a<b>c|d')).toBe('a_b_c_d')
  })

  it('去首尾空白与末尾点，空值回退默认名', () => {
    expect(sanitizeFileName(' 名字 ')).toBe('名字')
    expect(sanitizeFileName('名字...')).toBe('名字')
    expect(sanitizeFileName('')).toBe('未命名')
    expect(sanitizeFileName('...', '会话')).toBe('会话')
    expect(sanitizeFileName(null, '导图')).toBe('导图')
  })
})

describe('base64ToBytes / triggerDownload（导出下载）', () => {
  const origCreate = URL.createObjectURL
  const origRevoke = URL.revokeObjectURL
  const createSpy = vi.fn(() => 'blob:mock')
  const revokeSpy = vi.fn()

  afterEach(() => {
    URL.createObjectURL = origCreate
    URL.revokeObjectURL = origRevoke
    vi.restoreAllMocks()
  })

  it('base64 解码为字节数组（PNG 内容还原）', () => {
    // "TrailMind" 的 Base64
    expect(Array.from(base64ToBytes('VHJhaWxNaW5k'))).toEqual([84, 114, 97, 105, 108, 77, 105, 110, 100])
    expect(base64ToBytes('').length).toBe(0)
  })

  it('触发下载：创建 Blob URL、写 download 名并点击', () => {
    URL.createObjectURL = createSpy
    URL.revokeObjectURL = revokeSpy
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})

    downloadTextFile('会话.md', '# 内容', 'text/markdown;charset=utf-8')

    expect(createSpy).toHaveBeenCalled()
    expect(clickSpy).toHaveBeenCalled()
    expect(revokeSpy).toHaveBeenCalled()
  })

  it('下载 Base64 文件同样走 Blob 下载链路', () => {
    URL.createObjectURL = createSpy
    URL.revokeObjectURL = revokeSpy
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})

    downloadBase64File('导图.png', 'VHJhaWxNaW5k', 'image/png')

    expect(createSpy).toHaveBeenCalled()
    expect(clickSpy).toHaveBeenCalled()
  })
})
