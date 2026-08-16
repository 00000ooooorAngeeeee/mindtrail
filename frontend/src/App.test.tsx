import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import App from './App'
import { fetchHealth } from './api/health'
import { deleteWorkspace, fetchWorkspaces, updateWorkspace } from './api/workspaces'
import { createMindmap, deleteMindmap, listMindmaps } from './api/mindmaps'
import { createSession, deleteSession, getSession, listSessions } from './api/sessions'
import { listTags } from './api/tags'
import { fetchSettings } from './api/settings'
import { searchGlobal } from './api/search'

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
vi.mock('./api/sessions', () => ({
  listSessions: vi.fn(),
  createSession: vi.fn(),
  deleteSession: vi.fn(),
  getSession: vi.fn(),
  updateSession: vi.fn(),
}))
vi.mock('./api/tags', () => ({
  listTags: vi.fn(),
  createTag: vi.fn(),
  renameTag: vi.fn(),
  mergeTag: vi.fn(),
  deleteTag: vi.fn(),
  filterEntriesByTag: vi.fn(),
}))
vi.mock('./api/settings', () => ({
  fetchSettings: vi.fn(),
  updateSettings: vi.fn(),
}))
vi.mock('./api/search', () => ({ searchGlobal: vi.fn() }))
vi.mock('./api/backup', () => ({ exportBackup: vi.fn() }))

const healthMock = vi.mocked(fetchHealth)
const workspacesMock = vi.mocked(fetchWorkspaces)
const updateMock = vi.mocked(updateWorkspace)
const deleteMock = vi.mocked(deleteWorkspace)
const listMindmapsMock = vi.mocked(listMindmaps)
const createMindmapMock = vi.mocked(createMindmap)
const deleteMindmapMock = vi.mocked(deleteMindmap)
const listSessionsMock = vi.mocked(listSessions)
const createSessionMock = vi.mocked(createSession)
const deleteSessionMock = vi.mocked(deleteSession)
const getSessionMock = vi.mocked(getSession)
const listTagsMock = vi.mocked(listTags)
const settingsMock = vi.mocked(fetchSettings)
const searchMock = vi.mocked(searchGlobal)

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
    listSessionsMock.mockReset()
    createSessionMock.mockReset()
    deleteSessionMock.mockReset()
    getSessionMock.mockReset()
    listTagsMock.mockReset()
    listTagsMock.mockResolvedValue([])
    settingsMock.mockReset()
    settingsMock.mockResolvedValue({
      theme: 'system',
      defaultRepoPath: null,
      database: { host: '127.0.0.1', port: 3306, database: 'trailmind', username: 'root', passwordConfigured: true },
    })
    healthMock.mockResolvedValue({ status: 'ok', app: 'trailmind', version: '0.0.1' })
    workspacesMock.mockResolvedValue([])
    updateMock.mockResolvedValue({ ...ws })
    deleteMock.mockResolvedValue(undefined)
    listMindmapsMock.mockResolvedValue([])
    createMindmapMock.mockResolvedValue({ id: 10, name: '新导图', nodeCount: 1 })
    deleteMindmapMock.mockResolvedValue(undefined)
    listSessionsMock.mockResolvedValue([])
    createSessionMock.mockResolvedValue({ id: 1, title: '新会话', status: 'active' })
    deleteSessionMock.mockResolvedValue(undefined)
    searchMock.mockReset()
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

  it('点击工作区进入详情页显示统计与空态引导（03 §7.1）', async () => {
    workspacesMock.mockResolvedValue([ws])
    listMindmapsMock.mockResolvedValue([])
    listSessionsMock.mockResolvedValue([])
    render(<App />)

    fireEvent.click(await screen.findByText('项目A'))

    expect(screen.getByText('导图 2 · 会话 1')).toBeInTheDocument()
    // 无导图无会话 → 居中引导卡片：双入口 + 30 秒快速上手
    expect(await screen.findByTestId('empty-guide')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /新建第一张导图/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /开始第一次会话/ })).toBeInTheDocument()
    expect(screen.getByText('30 秒快速上手')).toBeInTheDocument()
    // 空态引导接管后，不再显示「暂无导图/暂无会话」文本
    expect(screen.queryByText(/暂无导图/)).not.toBeInTheDocument()
    expect(screen.queryByText(/暂无会话/)).not.toBeInTheDocument()
  })

  it('空态引导入口聚焦对应创建输入框（03 §7.1）', async () => {
    workspacesMock.mockResolvedValue([ws])
    listMindmapsMock.mockResolvedValue([])
    listSessionsMock.mockResolvedValue([])
    render(<App />)

    fireEvent.click(await screen.findByText('项目A'))
    await screen.findByTestId('empty-guide')

    fireEvent.click(screen.getByRole('button', { name: /新建第一张导图/ }))
    expect(screen.getByPlaceholderText('输入导图名称')).toHaveFocus()

    fireEvent.click(screen.getByRole('button', { name: /开始第一次会话/ }))
    expect(screen.getByPlaceholderText('输入会话标题')).toHaveFocus()
  })

  it('搜索无结果时「按标签浏览」入口跳转工作区标签面板（03 §7.3）', async () => {
    workspacesMock.mockResolvedValue([ws])
    listMindmapsMock.mockResolvedValue([])
    listSessionsMock.mockResolvedValue([])
    searchMock.mockResolvedValue({ query: '不存在词', mindmaps: [], entries: [], sessions: [] })
    render(<App />)
    await screen.findByText('项目A')

    // 打开搜索浮层并搜索无结果词
    fireEvent.click(screen.getByText(/搜索/))
    fireEvent.change(screen.getByLabelText('搜索关键词'), { target: { value: '不存在词' } })
    fireEvent.click(await screen.findByRole('button', { name: /按标签浏览/ }))

    // 浮层关闭，回到工作区首页，标签面板聚焦闪烁
    await waitFor(() => expect(screen.queryByLabelText('搜索关键词')).not.toBeInTheDocument())
    expect(await screen.findByText(/新建第一张导图/)).toBeInTheDocument()
    expect(document.querySelector('.tag-section-flash')).not.toBeNull()
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

  it('工作区页显示会话列表并可开始新会话', async () => {
    workspacesMock.mockResolvedValue([ws])
    listSessionsMock.mockResolvedValue([
      { id: 7, title: '会话A', status: 'active', entryCount: 3, startedAt: '2025-06-01T09:00:00' },
    ])
    render(<App />)

    fireEvent.click(await screen.findByText('项目A'))
    expect(await screen.findByText('会话A')).toBeInTheDocument()

    fireEvent.change(screen.getByPlaceholderText('输入会话标题'), { target: { value: '新会话' } })
    fireEvent.click(screen.getByText('开始会话'))

    await waitFor(() => expect(createSessionMock).toHaveBeenCalledWith(1, { title: '新会话' }))
  })

  it('打开会话进入时间线详情页', async () => {
    workspacesMock.mockResolvedValue([ws])
    listSessionsMock.mockResolvedValue([
      { id: 7, title: '会话A', status: 'active', entryCount: 1, startedAt: '2025-06-01T09:00:00' },
    ])
    getSessionMock.mockResolvedValue({
      id: 7,
      title: '会话A',
      status: 'active',
      entryTotal: 1,
      startedAt: '2025-06-01T09:00:00',
      endedAt: null,
      entries: [
        { id: 1, sessionId: 7, seq: 1, type: 'goal', contentMd: '目标内容', tags: [], createdAt: '2025-06-01T09:02:00' },
      ],
    })
    render(<App />)

    fireEvent.click(await screen.findByText('项目A'))
    fireEvent.click(await screen.findByText('会话A'))

    expect(await screen.findByText('目标内容')).toBeInTheDocument()
    expect(within(screen.getByRole('list')).getByText('目标')).toBeInTheDocument()
  })

  it('Ctrl+, 打开设置页并可返回（M4 任务四）', async () => {
    render(<App />)
    await screen.findByText('暂无工作区')

    fireEvent.keyDown(window, { key: ',', ctrlKey: true })
    expect(await screen.findByText('数据库连接')).toBeInTheDocument()
    expect(await screen.findByText('127.0.0.1')).toBeInTheDocument()

    fireEvent.click(screen.getByText('← 返回'))
    expect(screen.getByText('暂无工作区')).toBeInTheDocument()
  })
})
