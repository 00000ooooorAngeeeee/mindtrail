import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import App from './App'
import { fetchHealth } from './api/health'
import { fetchWorkspaces } from './api/workspaces'

vi.mock('./api/health', () => ({ fetchHealth: vi.fn() }))
vi.mock('./api/workspaces', () => ({ fetchWorkspaces: vi.fn(), createWorkspace: vi.fn() }))

const healthMock = vi.mocked(fetchHealth)
const workspacesMock = vi.mocked(fetchWorkspaces)

describe('App 首页', () => {
  beforeEach(() => {
    healthMock.mockReset()
    workspacesMock.mockReset()
    healthMock.mockResolvedValue({ status: 'ok', app: 'trailmind', version: '0.0.1' })
    workspacesMock.mockResolvedValue([])
  })

  it('渲染品牌名与后端版本号', async () => {
    render(<App />)
    expect(screen.getByText('思迹 TrailMind')).toBeInTheDocument()
    await waitFor(() => expect(screen.getByText('后端 v0.0.1')).toBeInTheDocument())
  })

  it('无工作区时显示空态提示', async () => {
    render(<App />)
    await waitFor(() => expect(screen.getByText('暂无工作区')).toBeInTheDocument())
  })

  it('后端不可用时显示错误态而非白屏', async () => {
    healthMock.mockRejectedValue(new Error('无法连接后端服务'))
    workspacesMock.mockRejectedValue(new Error('无法连接后端服务'))
    render(<App />)
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('无法连接后端服务'),
    )
  })
})
