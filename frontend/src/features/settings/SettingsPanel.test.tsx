import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { SettingsPanel } from './SettingsPanel'
import { fetchSettings, updateSettings } from '../../api/settings'
import { exportBackup, importBackup } from '../../api/backup'
import type { AppSettings } from '../../api/types'

vi.mock('../../api/settings', () => ({
  fetchSettings: vi.fn(),
  updateSettings: vi.fn(),
}))
vi.mock('../../api/backup', () => ({
  exportBackup: vi.fn(),
  importBackup: vi.fn(),
}))

const fetchMock = vi.mocked(fetchSettings)
const updateMock = vi.mocked(updateSettings)
const backupMock = vi.mocked(exportBackup)
const restoreMock = vi.mocked(importBackup)

const baseSettings: AppSettings = {
  theme: 'system',
  defaultRepoPath: null,
  database: {
    host: '127.0.0.1',
    port: 3306,
    database: 'trailmind',
    username: 'root',
    passwordConfigured: true,
  },
}

describe('SettingsPanel 设置页（M4 任务四）', () => {
  beforeEach(() => {
    fetchMock.mockReset()
    updateMock.mockReset()
    backupMock.mockReset()
    restoreMock.mockReset()
    fetchMock.mockResolvedValue(baseSettings)
    updateMock.mockResolvedValue(baseSettings)
  })

  it('展示数据库连接信息（密码只显示配置状态）', async () => {
    render(<SettingsPanel onBack={() => {}} />)

    expect(await screen.findByText('127.0.0.1')).toBeInTheDocument()
    expect(screen.getByText('3306')).toBeInTheDocument()
    expect(screen.getByText('trailmind')).toBeInTheDocument()
    expect(screen.getByText('root')).toBeInTheDocument()
    expect(screen.getByText('已配置（安全起见不展示）')).toBeInTheDocument()
    expect(screen.queryByText(/secret/)).not.toBeInTheDocument()
  })

  it('主题三选一并调用更新接口', async () => {
    updateMock.mockResolvedValue({ ...baseSettings, theme: 'dark' })
    render(<SettingsPanel onBack={() => {}} />)
    await screen.findByText('127.0.0.1')

    fireEvent.click(screen.getByLabelText('深色'))

    await waitFor(() => expect(updateMock).toHaveBeenCalledWith({ theme: 'dark' }))
  })

  it('保存默认仓库路径调用接口并回填', async () => {
    updateMock.mockResolvedValue({ ...baseSettings, defaultRepoPath: 'D:/repo' })
    render(<SettingsPanel onBack={() => {}} />)
    await screen.findByText('127.0.0.1')

    fireEvent.change(screen.getByLabelText('默认仓库路径'), { target: { value: 'D:/repo' } })
    fireEvent.click(screen.getByText('保存'))

    await waitFor(() => expect(updateMock).toHaveBeenCalledWith({ defaultRepoPath: 'D:/repo' }))
    expect(await screen.findByDisplayValue('D:/repo')).toBeInTheDocument()
  })

  it('清除仓库路径传空白字符串', async () => {
    updateMock.mockResolvedValue({ ...baseSettings, defaultRepoPath: null })
    fetchMock.mockResolvedValue({ ...baseSettings, defaultRepoPath: 'D:/repo' })
    render(<SettingsPanel onBack={() => {}} />)
    await screen.findByDisplayValue('D:/repo')

    fireEvent.click(screen.getByText('清除'))

    await waitFor(() => expect(updateMock).toHaveBeenCalledWith({ defaultRepoPath: '' }))
    expect(await screen.findByLabelText('默认仓库路径')).toHaveValue('')
  })

  it('保存失败展示错误信息', async () => {
    updateMock.mockRejectedValue(new Error('仓库路径无效：未找到 .git 目录'))
    render(<SettingsPanel onBack={() => {}} />)
    await screen.findByText('127.0.0.1')

    fireEvent.change(screen.getByLabelText('默认仓库路径'), { target: { value: 'X:/nope' } })
    fireEvent.click(screen.getByText('保存'))

    expect(await screen.findByRole('alert')).toHaveTextContent('仓库路径无效：未找到 .git 目录')
  })

  it('导出全量备份：调用接口并触发 zip 下载（M4 任务六，PRD E5）', async () => {
    // 桩 URL.createObjectURL 与 <a>.click，断言 blob 类型与文件名（jsdom 无 URL.createObjectURL 实现，用 stubGlobal）
    const createUrl = vi.fn<(url: string) => string>(() => 'blob:mock')
    const revokeUrl = vi.fn<(url: string) => void>(() => {})
    const click = vi.fn<() => void>(() => {})
    vi.stubGlobal('URL', { ...URL, createObjectURL: createUrl, revokeObjectURL: revokeUrl })
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(click)
    try {
      const base64 = btoa('PK\x03\x04fake-zip')
      backupMock.mockResolvedValue({ filename: 'trailmind-backup-20250816-120000.zip', contentType: 'application/zip', content: base64 })
      render(<SettingsPanel onBack={() => {}} />)
      await screen.findByText('127.0.0.1')

      fireEvent.click(screen.getByRole('button', { name: /导出全量备份/ }))

      await waitFor(() => expect(backupMock).toHaveBeenCalledTimes(1))
      await waitFor(() => expect(click).toHaveBeenCalledTimes(1))
      expect(createUrl).toHaveBeenCalledWith(expect.any(Blob))
      const blob = createUrl.mock.calls[0]?.[0] as unknown as Blob
      expect(blob.type).toBe('application/zip')
      expect(revokeUrl).toHaveBeenCalledWith('blob:mock')
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('导出备份失败展示错误信息', async () => {
    backupMock.mockRejectedValue(new Error('无法连接后端服务'))
    render(<SettingsPanel onBack={() => {}} />)
    await screen.findByText('127.0.0.1')

    fireEvent.click(screen.getByRole('button', { name: /导出全量备份/ }))

    expect(await screen.findByRole('alert')).toHaveTextContent('无法连接后端服务')
  })

  it('导入备份恢复：选文件→确认→调用接口并展示摘要与刷新入口（v1.2 P2，PRD E5）', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)
    restoreMock.mockResolvedValue({
      workspace: 1, mindmap: 1, session: 1, entry: 1, tag: 1,
      entryTag: 1, entryCommit: 0, nodeEntry: 1, setting: 1,
      total: 7, exportedAt: '2025-08-16T12:00:00',
    })
    const { container } = render(<SettingsPanel onBack={() => {}} />)
    await screen.findByText('127.0.0.1')

    // 选 zip 文件（与导出产物同形态），onChange 触发确认→读 Base64→POST
    const file = new File(['PK\x03\x04fake-zip'], 'trailmind-backup.zip')
    const input = container.querySelector('input[type="file"]') as HTMLInputElement
    fireEvent.change(input, { target: { files: [file] } })

    await waitFor(() => expect(restoreMock).toHaveBeenCalledWith(btoa('PK\x03\x04fake-zip')))
    expect(await screen.findByText(/已恢复 7 条记录/)).toBeInTheDocument()
    expect(screen.getByText(/恢复至 2025-08-16T12:00:00/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '刷新页面' })).toBeInTheDocument()
    confirmSpy.mockRestore()
  })

  it('取消确认不调用导入接口', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false)
    restoreMock.mockResolvedValue({
      workspace: 0, mindmap: 0, session: 0, entry: 0, tag: 0,
      entryTag: 0, entryCommit: 0, nodeEntry: 0, setting: 0,
      total: 0, exportedAt: '2025-08-16T12:00:00',
    })
    const { container } = render(<SettingsPanel onBack={() => {}} />)
    await screen.findByText('127.0.0.1')

    const input = container.querySelector('input[type="file"]') as HTMLInputElement
    fireEvent.change(input, { target: { files: [new File(['x'], 'b.zip')] } })

    await waitFor(() => expect(confirmSpy).toHaveBeenCalled())
    expect(restoreMock).not.toHaveBeenCalled()
    confirmSpy.mockRestore()
  })

  it('导入恢复失败展示错误信息', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)
    restoreMock.mockRejectedValue(new Error('备份文件损坏或非 zip'))
    const { container } = render(<SettingsPanel onBack={() => {}} />)
    await screen.findByText('127.0.0.1')

    const input = container.querySelector('input[type="file"]') as HTMLInputElement
    fireEvent.change(input, { target: { files: [new File(['x'], 'b.zip')] } })

    expect(await screen.findByRole('alert')).toHaveTextContent('备份文件损坏或非 zip')
    confirmSpy.mockRestore()
  })
})
