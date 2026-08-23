import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { TagSection } from './TagSection'
import { batchDeleteTags, createTag, deleteTag, filterEntriesByTag, listTags, mergeTag, renameTag } from '../../api/tags'
import type { TagInfo, Workspace } from '../../api/types'

vi.mock('../../api/tags', () => ({
  listTags: vi.fn(),
  createTag: vi.fn(),
  renameTag: vi.fn(),
  mergeTag: vi.fn(),
  deleteTag: vi.fn(),
  batchDeleteTags: vi.fn(),
  filterEntriesByTag: vi.fn(),
}))

const listMock = vi.mocked(listTags)
const createMock = vi.mocked(createTag)
const renameMock = vi.mocked(renameTag)
const mergeMock = vi.mocked(mergeTag)
const deleteMock = vi.mocked(deleteTag)
const batchDeleteMock = vi.mocked(batchDeleteTags)
const filterMock = vi.mocked(filterEntriesByTag)

const ws = { id: 1, name: '项目A' } as Workspace

const tags: TagInfo[] = [
  { id: 1, workspaceId: 1, name: '技术选型', entryCount: 2 },
  { id: 2, workspaceId: 1, name: '架构', entryCount: 1 },
]

describe('TagSection 标签面板（M4 任务二）', () => {
  beforeEach(() => {
    listMock.mockReset()
    createMock.mockReset()
    renameMock.mockReset()
    mergeMock.mockReset()
    deleteMock.mockReset()
    batchDeleteMock.mockReset()
    filterMock.mockReset()
    listMock.mockResolvedValue(tags)
    batchDeleteMock.mockResolvedValue(undefined)
    filterMock.mockResolvedValue([])
  })

  it('展示标签列表与使用计数（列表 + 标签云双入口）', async () => {
    render(<TagSection ws={ws} onOpenSessionEntry={() => {}} />)
    // 云 chip 与列表按钮同名双入口（v1.1 P1 标签云）
    expect((await screen.findAllByRole('button', { name: '技术选型' })).length).toBe(2)
    expect(screen.getByText('2')).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: '架构' }).length).toBe(2)
  })

  it('标签云：热度分档字号 + 循环色板 + 点击即时过滤（v1.1 P1，PRD D4）', async () => {
    filterMock.mockResolvedValue([])
    render(<TagSection ws={ws} onOpenSessionEntry={() => {}} />)
    const cloud = await screen.findByLabelText('标签云')
    const hot = within(cloud).getByRole('button', { name: '技术选型' }) // entryCount=2 → md
    const cold = within(cloud).getByRole('button', { name: '架构' }) // entryCount=1 → sm
    expect(hot.className).toContain('size-md')
    expect(hot.className).toContain('color-indigo') // 按热度降序：技术选型 index=0
    expect(cold.className).toContain('size-sm')
    expect(cold.className).toContain('color-green')

    fireEvent.click(hot)
    await waitFor(() => expect(filterMock).toHaveBeenCalledWith(1))
    expect(await screen.findByTestId('tag-filter-panel')).toBeInTheDocument()
  })

  it('新建标签调用接口并刷新列表', async () => {
    createMock.mockResolvedValue({ id: 3, workspaceId: 1, name: '新标签', entryCount: 0 })
    listMock.mockResolvedValueOnce(tags).mockResolvedValue([...tags, { id: 3, workspaceId: 1, name: '新标签', entryCount: 0 }])
    render(<TagSection ws={ws} onOpenSessionEntry={() => {}} />)
    await screen.findAllByRole('button', { name: '技术选型' })

    fireEvent.change(screen.getByPlaceholderText('输入新标签名'), { target: { value: '新标签' } })
    fireEvent.click(screen.getByText('新建标签'))

    await waitFor(() => expect(createMock).toHaveBeenCalledWith(1, '新标签'))
    expect((await screen.findAllByRole('button', { name: '新标签' })).length).toBe(2) // 云 + 列表
  })

  it('重命名标签调用接口并刷新（D3 全局生效由后端保证）', async () => {
    renameMock.mockResolvedValue({ id: 1, workspaceId: 1, name: '技术选型V2', entryCount: 2 })
    listMock.mockResolvedValueOnce(tags).mockResolvedValue([{ id: 1, workspaceId: 1, name: '技术选型V2', entryCount: 2 }, tags[1]])
    render(<TagSection ws={ws} onOpenSessionEntry={() => {}} />)
    await screen.findAllByRole('button', { name: '技术选型' })

    fireEvent.click(screen.getAllByText('重命名')[0])
    fireEvent.change(screen.getByDisplayValue('技术选型'), { target: { value: '技术选型V2' } })
    fireEvent.click(screen.getByText('保存'))

    await waitFor(() => expect(renameMock).toHaveBeenCalledWith(1, '技术选型V2'))
    expect((await screen.findAllByRole('button', { name: '技术选型V2' })).length).toBe(2)
  })

  it('合并标签调用接口（源合并进目标）', async () => {
    mergeMock.mockResolvedValue(tags[1])
    render(<TagSection ws={ws} onOpenSessionEntry={() => {}} />)
    await screen.findAllByRole('button', { name: '技术选型' })

    fireEvent.click(screen.getAllByText('合并')[0])
    fireEvent.change(screen.getByLabelText('合并目标'), { target: { value: '2' } })
    fireEvent.click(screen.getByText('确认合并'))

    await waitFor(() => expect(mergeMock).toHaveBeenCalledWith(1, 2))
  })

  it('删除标签二次确认后调用接口', async () => {
    deleteMock.mockResolvedValue(undefined)
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    listMock.mockResolvedValueOnce(tags).mockResolvedValue([tags[1]])
    render(<TagSection ws={ws} onOpenSessionEntry={() => {}} />)
    await screen.findAllByRole('button', { name: '技术选型' })

    fireEvent.click(screen.getAllByText('删除')[0])

    await waitFor(() => expect(deleteMock).toHaveBeenCalledWith(1))
    expect((await screen.findAllByRole('button', { name: '架构' })).length).toBe(2)
  })

  it('点击标签即时过滤条目，点击条目回调跳转定位', async () => {
    filterMock.mockResolvedValue([
      {
        id: 11,
        sessionId: 7,
        seq: 3,
        type: 'decision',
        contentMd: '选 React Flow 因为自由画布开箱即用',
        createdAt: '2025-06-01T09:40:00',
        sessionTitle: 'M2 画布会话',
        workspaceId: 1,
        workspaceName: '项目A',
        tags: ['技术选型'],
      },
    ])
    const onJump = vi.fn()
    render(<TagSection ws={ws} onOpenSessionEntry={onJump} />)
    await screen.findAllByRole('button', { name: '技术选型' })

    fireEvent.click(screen.getAllByRole('button', { name: '技术选型' })[0]) // 云 chip 入口

    await waitFor(() => expect(filterMock).toHaveBeenCalledWith(1))
    expect(await screen.findByTestId('tag-filter-panel')).toBeInTheDocument()
    expect(screen.getByText(/M2 画布会话/)).toBeInTheDocument()

    fireEvent.click(screen.getByText(/选 React Flow/))
    expect(onJump).toHaveBeenCalledWith(7, 11, 3)
  })

  it('过滤结果为空显示空态', async () => {
    filterMock.mockResolvedValue([])
    render(<TagSection ws={ws} onOpenSessionEntry={() => {}} />)
    await screen.findAllByRole('button', { name: '技术选型' })

    fireEvent.click(screen.getAllByRole('button', { name: '技术选型' })[0])

    expect(await screen.findByText('该标签暂无条目')).toBeInTheDocument()
  })

  it('批量删除标签：选择模式 + 全选 + 二次确认调用接口（04 §5）', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    listMock.mockResolvedValueOnce(tags).mockResolvedValue([])
    render(<TagSection ws={ws} onOpenSessionEntry={() => {}} />)
    await screen.findAllByRole('button', { name: '技术选型' })

    fireEvent.click(screen.getByText('批量操作')) // 进入选择模式
    fireEvent.click(screen.getByText('全选'))
    fireEvent.click(screen.getByText('批量删除（2）'))

    await waitFor(() => expect(batchDeleteMock).toHaveBeenCalledWith([1, 2]))
  })
})
