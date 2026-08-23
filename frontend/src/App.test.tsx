import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import App from './App'
import { fetchHealth } from './api/health'
import { batchDeleteWorkspaces, deleteWorkspace, fetchWorkspaces, updateWorkspace } from './api/workspaces'
import { batchDeleteMindmaps, createMindmap, deleteMindmap, listMindmaps, renameMindmap } from './api/mindmaps'
import { batchDeleteSessions, createSession, deleteSession, getSession, listSessions } from './api/sessions'
import { listTags } from './api/tags'
import { fetchSettings } from './api/settings'
import { searchGlobal } from './api/search'
import type { Session } from './api/types'

vi.mock('./api/health', () => ({ fetchHealth: vi.fn() }))
vi.mock('./api/workspaces', () => ({
  fetchWorkspaces: vi.fn(),
  createWorkspace: vi.fn(),
  updateWorkspace: vi.fn(),
  deleteWorkspace: vi.fn(),
  batchDeleteWorkspaces: vi.fn(),
}))
vi.mock('./api/mindmaps', () => ({
  listMindmaps: vi.fn(),
  createMindmap: vi.fn(),
  deleteMindmap: vi.fn(),
  renameMindmap: vi.fn(),
  batchDeleteMindmaps: vi.fn(),
}))
vi.mock('./api/sessions', () => ({
  listSessions: vi.fn(),
  createSession: vi.fn(),
  deleteSession: vi.fn(),
  getSession: vi.fn(),
  updateSession: vi.fn(),
  batchDeleteSessions: vi.fn(),
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
const batchDeleteWsMock = vi.mocked(batchDeleteWorkspaces)
const listMindmapsMock = vi.mocked(listMindmaps)
const createMindmapMock = vi.mocked(createMindmap)
const deleteMindmapMock = vi.mocked(deleteMindmap)
const batchDeleteMindmapMock = vi.mocked(batchDeleteMindmaps)
const renameMindmapMock = vi.mocked(renameMindmap)
const listSessionsMock = vi.mocked(listSessions)
const createSessionMock = vi.mocked(createSession)
const deleteSessionMock = vi.mocked(deleteSession)
const batchDeleteSessionMock = vi.mocked(batchDeleteSessions)
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
    batchDeleteWsMock.mockReset()
    batchDeleteMindmapMock.mockReset()
    batchDeleteSessionMock.mockReset()
    listMindmapsMock.mockReset()
    createMindmapMock.mockReset()
    deleteMindmapMock.mockReset()
    renameMindmapMock.mockReset()
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
    batchDeleteWsMock.mockResolvedValue(undefined)
    batchDeleteMindmapMock.mockResolvedValue(undefined)
    batchDeleteSessionMock.mockResolvedValue(undefined)
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

  it('重命名时点击空白处退出且不保存（保留原内容）', async () => {
    workspacesMock.mockResolvedValue([ws])
    render(<App />)
    await screen.findByText('项目A')

    fireEvent.click(screen.getByText('重命名'))
    const input = screen.getByDisplayValue('项目A')
    fireEvent.change(input, { target: { value: '项目B' } })
    // 点击旁边空白处 → input 失焦（relatedTarget=null）→ 退出重命名，丢弃草稿保留原内容
    fireEvent.blur(input, { relatedTarget: null })

    await waitFor(() => expect(screen.queryByDisplayValue('项目B')).not.toBeInTheDocument())
    expect(updateMock).not.toHaveBeenCalled()
    expect(screen.getByText('项目A')).toBeInTheDocument() // 原内容保留
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

    // 统计随列表实时刷新（列表为空 → 0/0；旧实现停滞在列表快照的 2/1 属缺陷，已修复）
    expect(await screen.findByText('导图 0 · 会话 0')).toBeInTheDocument()
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

  it('头部计数随列表实时刷新（缺陷修复：不再停滞在列表快照）', async () => {
    // 列表快照计数为 2/1，但实际列表为空 → 应显示 0/0（列表为权威）
    workspacesMock.mockResolvedValue([ws])
    listMindmapsMock.mockResolvedValue([])
    listSessionsMock.mockResolvedValue([])
    render(<App />)

    fireEvent.click(await screen.findByText('项目A'))
    expect(await screen.findByText('导图 0 · 会话 0')).toBeInTheDocument()
  })

  it('新建导图/会话后头部计数即时 +1，返回列表页重拉计数（缺陷修复）', async () => {
    workspacesMock.mockResolvedValue([ws])
    listMindmapsMock
      .mockResolvedValueOnce([])
      .mockResolvedValue([{ id: 11, name: '新导图', nodeCount: 1 }])
    createMindmapMock.mockResolvedValue({ id: 11, name: '新导图', nodeCount: 1 })
    listSessionsMock.mockResolvedValue([])
    render(<App />)

    fireEvent.click(await screen.findByText('项目A'))
    expect(await screen.findByText('导图 0 · 会话 0')).toBeInTheDocument()

    // 新建导图 → 导图计数 +1
    fireEvent.change(screen.getByPlaceholderText('输入导图名称'), { target: { value: '新导图' } })
    fireEvent.click(screen.getByText('新建导图'))
    await waitFor(() => expect(screen.getByText('导图 1 · 会话 0')).toBeInTheDocument())

    // 新建会话 → 会话计数 +1
    fireEvent.change(screen.getByPlaceholderText('输入会话标题'), { target: { value: '新会话' } })
    fireEvent.click(screen.getByText('开始会话'))
    await waitFor(() => expect(screen.getByText('导图 1 · 会话 1')).toBeInTheDocument())

    // ← 返回列表页 → 重拉工作区列表（listWithCounts 唯一计数源），列表项计数同步
    fireEvent.click(screen.getByText('← 返回'))
    await waitFor(() => expect(workspacesMock).toHaveBeenCalledTimes(2))
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

  it('重命名导图调用接口并刷新列表（PRD B4）', async () => {
    workspacesMock.mockResolvedValue([ws])
    listMindmapsMock
      .mockResolvedValueOnce([{ id: 10, name: '导图A', nodeCount: 3 }])
      .mockResolvedValue([{ id: 10, name: '导图B', nodeCount: 3 }])
    renameMindmapMock.mockResolvedValue({ id: 10, name: '导图B', nodeCount: 3 })
    render(<App />)

    fireEvent.click(await screen.findByText('项目A'))
    fireEvent.click((await screen.findAllByText('重命名'))[0])
    const input = screen.getByDisplayValue('导图A')
    fireEvent.change(input, { target: { value: '导图B' } })
    fireEvent.click(screen.getByText('保存'))

    await waitFor(() => expect(renameMindmapMock).toHaveBeenCalledWith(10, '导图B'))
    expect(await screen.findByText('导图B')).toBeInTheDocument()
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

  it('多会话并行视图：打开第二个会话保留标签，标签切换状态互不丢失（v1.1 P1）', async () => {
    const sessionOf = (id: number, title: string, content: string): Session => ({
      id,
      title,
      status: 'active',
      entryTotal: 1,
      startedAt: '2025-06-01T09:00:00',
      endedAt: null,
      entries: [{ id: id * 10, sessionId: id, seq: 1, type: 'goal', contentMd: content, tags: [], createdAt: '2025-06-01T09:02:00' }],
    })
    workspacesMock.mockResolvedValue([ws])
    listSessionsMock.mockResolvedValue([
      { id: 7, title: '会话A', status: 'active', entryCount: 1, startedAt: '2025-06-01T09:00:00' },
      { id: 8, title: '会话B', status: 'active', entryCount: 1, startedAt: '2025-06-01T10:00:00' },
    ])
    getSessionMock.mockImplementation(async (id: number) => sessionOf(id, id === 7 ? '会话A' : '会话B', id === 7 ? '内容A' : '内容B'))
    render(<App />)

    // 打开会话A → 标签「会话A」出现，内容A 可见
    fireEvent.click(await screen.findByText('项目A'))
    fireEvent.click(await screen.findByText('会话A'))
    expect(await screen.findByRole('tab', { name: /会话A/ })).toBeInTheDocument()
    expect(await screen.findByText('内容A')).toBeVisible()

    // 「＋」回工作区（标签保留）→ 打开会话B → 两个标签，内容B 可见、内容A 隐藏但状态保留
    fireEvent.click(screen.getByRole('button', { name: '打开更多会话' }))
    expect(await screen.findByText('会话B')).toBeInTheDocument() // 回到工作区会话列表
    fireEvent.click(screen.getByText('会话B'))
    expect(await screen.findByText('内容B')).toBeVisible()
    expect(screen.getByText('内容A')).not.toBeVisible() // display:none 保留挂载状态

    // 切回会话A → 内容A 恢复可见
    fireEvent.click(screen.getByRole('tab', { name: /会话A/ }))
    expect(screen.getByText('内容A')).toBeVisible()
    expect(screen.getByText('内容B')).not.toBeVisible()

    // 关闭激活的会话A → 自动切到会话B；再点 ← 返回 → 回工作区
    fireEvent.click(screen.getByRole('button', { name: '关闭 会话A' }))
    expect(screen.getByText('内容B')).toBeVisible()
    expect(screen.queryByRole('tab', { name: /会话A/ })).not.toBeInTheDocument()
    fireEvent.click(screen.getByText('← 返回'))
    expect(await screen.findByText('会话B')).toBeInTheDocument() // 工作区列表
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument()
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

  it('批量删除工作区：选择模式 + 全选 + 二次确认调用接口（04 §5）', async () => {
    workspacesMock.mockResolvedValue([ws, { ...ws, id: 2, name: '项目B' }])
    batchDeleteWsMock.mockResolvedValue(undefined)
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    render(<App />)
    await screen.findByText('项目A')

    fireEvent.click(screen.getByText('批量操作')) // 进入选择模式
    fireEvent.click(screen.getByText('全选'))
    fireEvent.click(screen.getByText('批量删除（2）'))

    await waitFor(() => expect(batchDeleteWsMock).toHaveBeenCalledWith([1, 2]))
  })

  it('批量删除导图：进入工作区后选择模式批量删除（04 §5）', async () => {
    workspacesMock.mockResolvedValue([ws])
    listMindmapsMock.mockResolvedValueOnce([
      { id: 10, name: '导图A', nodeCount: 1 },
      { id: 11, name: '导图B', nodeCount: 2 },
    ]).mockResolvedValue([])
    batchDeleteMindmapMock.mockResolvedValue(undefined)
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    render(<App />)
    fireEvent.click(await screen.findByText('项目A'))
    await screen.findByText('导图A')

    fireEvent.click(screen.getByText('批量操作'))
    fireEvent.click(screen.getByText('全选'))
    fireEvent.click(screen.getByText('批量删除（2）'))

    await waitFor(() => expect(batchDeleteMindmapMock).toHaveBeenCalledWith([10, 11]))
  })

  it('批量删除会话：选择模式批量删除（04 §5）', async () => {
    workspacesMock.mockResolvedValue([ws])
    listMindmapsMock.mockResolvedValue([])
    listSessionsMock.mockResolvedValueOnce([
      { id: 1, title: '会话A', status: 'active' },
      { id: 2, title: '会话B', status: 'active' },
    ]).mockResolvedValue([])
    batchDeleteSessionMock.mockResolvedValue(undefined)
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    render(<App />)
    fireEvent.click(await screen.findByText('项目A'))
    await screen.findByText('会话A')

    fireEvent.click(screen.getByText('批量操作'))
    fireEvent.click(screen.getByText('全选'))
    fireEvent.click(screen.getByText('批量删除（2）'))

    await waitFor(() => expect(batchDeleteSessionMock).toHaveBeenCalledWith([1, 2]))
  })
})
