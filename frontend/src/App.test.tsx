import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import App from './App'
import { fetchHealth } from './api/health'
import { deleteWorkspace, fetchWorkspaces, updateWorkspace } from './api/workspaces'
import { createMindmap, deleteMindmap, listMindmaps } from './api/mindmaps'

vi.mock('./api/health', () => ({ fetchHealth: vi.fn() }))
vi.mock('./api/workspaces', () => ({
  fetchWorkspaces: vi.fn(),
  createWorkspace: vi.fn(),
  updateWorkspace: vi.fn(),
  deleteWorkspace: vi.fn(),
}))
vi.mock('./api/mindmaps', () => ({
  listMindmaps: vi.fn(),
  createMindmap: vi.fn(),
  deleteMindmap: vi.fn(),
}))

const healthMock = vi.mocked(fetchHealth)
const workspacesMock = vi.mocked(fetchWorkspaces)
const updateMock = vi.mocked(updateWorkspace)
const deleteMock = vi.mocked(deleteWorkspace)
const listMindmapsMock = vi.mocked(listMindmaps)
const createMindmapMock = vi.mocked(createMindmap)
const deleteMindmapMock = vi.mocked(deleteMindmap)

const ws = { id: 1, name: '项目A', mindmapCount: 2, sessionCount: 1 }

describe('App 首页', () => {
  beforeEach(() => {
    healthMock.mockReset()
    workspacesMock.mockReset()
    updateMock.mockReset()
    deleteMock.mockReset()
    listMindmapsMock.mockReset()
    createMindmapMock.mockReset()
    deleteMindmapMock.mockReset()
    healthMock.mockResolvedValue({ status: 'ok', app: 'trailmind', version: '0.0.1' })
    workspacesMock.mockResolvedValue([])
    updateMock.mockResolvedValue({ ...ws })
    deleteMock.mockResolvedValue(undefined)
    listMindmapsMock.mockResolvedValue([])
    createMindmapMock.mockResolvedValue({ id: 10, name: '新导图', nodeCount: 1 })
    deleteMindmapMock.mockResolvedValue(undefined)
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

  it('重命名工作区调用更新接口并刷新列表', async () => {
    workspacesMock.mockResolvedValue([ws])
    updateMock.mockResolvedValue({ ...ws, name: '项目B' })
    render(<App />)

    fireEvent.click(await screen.findByText('重命名'))
    fireEvent.change(screen.getByDisplayValue('项目A'), { target: { value: '项目B' } })
    fireEvent.click(screen.getByText('保存'))

    await waitFor(() => expect(updateMock).toHaveBeenCalledWith(1, { name: '项目B' }))
    await waitFor(() => expect(screen.getByText('项目B')).toBeInTheDocument())
  })

  it('删除工作区二次确认后调用删除接口', async () => {
    workspacesMock.mockResolvedValue([ws])
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    render(<App />)

    fireEvent.click(await screen.findByText('删除'))

    await waitFor(() => expect(deleteMock).toHaveBeenCalledWith(1))
  })

  it('点击工作区进入详情页显示统计与空态', async () => {
    workspacesMock.mockResolvedValue([ws])
    render(<App />)

    fireEvent.click(await screen.findByText('项目A'))

    expect(screen.getByText('导图 2 · 会话 1')).toBeInTheDocument()
    expect(await screen.findByText(/暂无导图/)).toBeInTheDocument()
    expect(screen.getByText(/暂无会话/)).toBeInTheDocument()
  })

  it('进入工作区详情显示导图列表', async () => {
    workspacesMock.mockResolvedValue([ws])
    listMindmapsMock.mockResolvedValue([{ id: 10, name: '导图A', nodeCount: 3 }])
    render(<App />)

    fireEvent.click(await screen.findByText('项目A'))

    expect(await screen.findByText('导图A')).toBeInTheDocument()
    expect(screen.getByText('3 节点')).toBeInTheDocument()
  })

  it('新建导图调用接口并刷新列表', async () => {
    workspacesMock.mockResolvedValue([ws])
    listMindmapsMock
      .mockResolvedValueOnce([])
      .mockResolvedValue([{ id: 11, name: '新导图', nodeCount: 1 }])
    createMindmapMock.mockResolvedValue({ id: 11, name: '新导图', nodeCount: 1 })
    render(<App />)

    fireEvent.click(await screen.findByText('项目A'))
    fireEvent.change(screen.getByPlaceholderText('输入导图名称'), { target: { value: '新导图' } })
    fireEvent.click(screen.getByText('新建导图'))

    await waitFor(() => expect(createMindmapMock).toHaveBeenCalledWith(1, '新导图'))
    expect(await screen.findByText('新导图')).toBeInTheDocument()
  })

  it('删除导图二次确认后调用接口', async () => {
    workspacesMock.mockResolvedValue([ws])
    listMindmapsMock.mockResolvedValue([{ id: 10, name: '导图A', nodeCount: 3 }])
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    render(<App />)

    fireEvent.click(await screen.findByText('项目A'))
    fireEvent.click(await screen.findByText('删除'))

    await waitFor(() => expect(deleteMindmapMock).toHaveBeenCalledWith(10))
  })
})
