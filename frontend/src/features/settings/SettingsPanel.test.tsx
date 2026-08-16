import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { SettingsPanel } from './SettingsPanel'
import { fetchSettings, updateSettings } from '../../api/settings'
import type { AppSettings } from '../../api/types'

vi.mock('../../api/settings', () => ({
  fetchSettings: vi.fn(),
  updateSettings: vi.fn(),
}))

const fetchMock = vi.mocked(fetchSettings)
const updateMock = vi.mocked(updateSettings)

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
})
