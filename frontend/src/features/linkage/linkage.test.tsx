import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { getNodeLinks, getRecentEntries, replaceNodeLinks } from '../../api/linkage'
import { searchGlobal } from '../../api/search'
import { NodeEntryLinkDialog } from './NodeEntryLinkDialog'
import { NodeLinksPopover } from './NodeLinksPopover'
import type { LinkedEntry, RecentEntry } from '../../api/types'

vi.mock('../../api/linkage', () => ({
  getNodeLinks: vi.fn(),
  getRecentEntries: vi.fn(),
  replaceNodeLinks: vi.fn(),
}))
vi.mock('../../api/search', () => ({ searchGlobal: vi.fn() }))

const getNodeLinksMock = vi.mocked(getNodeLinks)
const getRecentMock = vi.mocked(getRecentEntries)
const replaceNodeLinksMock = vi.mocked(replaceNodeLinks)
const searchMock = vi.mocked(searchGlobal)

const recent: RecentEntry[] = [
  {
    entryId: 20,
    sessionId: 7,
    sessionTitle: 'M4 搜索会话',
    seq: 3,
    type: 'action',
    contentMd: '实现布局算法',
    createdAt: '2025-06-01T09:30:00',
  },
]

const linked: LinkedEntry[] = [
  {
    entryId: 20,
    sessionId: 7,
    sessionTitle: 'M4 搜索会话',
    seq: 3,
    type: 'action',
    contentPreview: '实现布局算法',
    createdAt: '2025-06-01T09:30:00',
  },
]

describe('NodeEntryLinkDialog 节点挂条目对话框', () => {
  beforeEach(() => {
    getRecentMock.mockReset()
    getRecentMock.mockResolvedValue(recent)
    replaceNodeLinksMock.mockReset()
    replaceNodeLinksMock.mockResolvedValue(linked)
    searchMock.mockReset()
    searchMock.mockResolvedValue({
      query: '',
      mindmaps: [],
      entries: [],
      sessions: [],
    })
  })

  it('展示最近条目候选并支持勾选后替换保存', async () => {
    const onSaved = vi.fn()
    const onClose = vi.fn()
    render(
      <NodeEntryLinkDialog
        mindmapId={1}
        nodeId="n1"
        workspaceId={3}
        initialEntryIds={[]}
        onClose={onClose}
        onSaved={onSaved}
      />,
    )

    // 最近条目候选渲染（含会话标题与序号）
    expect(await screen.findByText(/M4 搜索会话/)).toBeInTheDocument()

    // 勾选 → 保存 → 替换接口携带勾选集合
    fireEvent.click(screen.getByRole('checkbox'))
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    await waitFor(() => expect(replaceNodeLinksMock).toHaveBeenCalledWith(1, 'n1', [20]))
    expect(onSaved).toHaveBeenCalled()
    expect(onClose).toHaveBeenCalled()
  })

  it('初始已挂接的条目预勾选', async () => {
    render(
      <NodeEntryLinkDialog
        mindmapId={1}
        nodeId="n1"
        workspaceId={3}
        initialEntryIds={[20]}
        onClose={vi.fn()}
        onSaved={vi.fn()}
      />,
    )

    const checkbox = await screen.findByRole('checkbox')
    expect(checkbox).toBeChecked()
    expect(screen.getByText('已选 1 条')).toBeInTheDocument()
  })

  it('输入关键词防抖 300ms 后走全局搜索（type=entry + workspaceId 圈定）', async () => {
    vi.useFakeTimers()
    render(
      <NodeEntryLinkDialog
        mindmapId={1}
        nodeId="n1"
        workspaceId={3}
        initialEntryIds={[]}
        onClose={vi.fn()}
        onSaved={vi.fn()}
      />,
    )
    fireEvent.change(screen.getByLabelText('搜索条目'), { target: { value: '布局' } })
    expect(searchMock).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(300)
    expect(searchMock).toHaveBeenCalledWith('布局', { type: 'entry', workspaceId: 3 })
    vi.useRealTimers()
  })
})

describe('NodeLinksPopover 节点挂接详情弹层', () => {
  beforeEach(() => {
    getNodeLinksMock.mockReset()
    getNodeLinksMock.mockResolvedValue(linked)
  })

  it('列出挂接条目，点击跳转会话条目', async () => {
    const onOpenEntry = vi.fn()
    render(
      <NodeLinksPopover
        mindmapId={1}
        nodeId="n1"
        nodeText="根节点"
        x={100}
        y={100}
        onClose={vi.fn()}
        onOpenEntry={onOpenEntry}
        onManage={vi.fn()}
      />,
    )

    fireEvent.click(await screen.findByRole('button', { name: /M4 搜索会话/ }))
    expect(onOpenEntry).toHaveBeenCalledWith(linked[0])
  })

  it('「管理挂接」打开管理对话框', async () => {
    const onManage = vi.fn()
    render(
      <NodeLinksPopover
        mindmapId={1}
        nodeId="n1"
        nodeText="根节点"
        x={100}
        y={100}
        onClose={vi.fn()}
        onOpenEntry={vi.fn()}
        onManage={onManage}
      />,
    )

    fireEvent.click(await screen.findByRole('button', { name: '管理挂接' }))
    expect(onManage).toHaveBeenCalled()
  })

  it('加载失败展示错误信息', async () => {
    getNodeLinksMock.mockRejectedValue(new Error('网络错误'))
    render(
      <NodeLinksPopover
        mindmapId={1}
        nodeId="n1"
        nodeText="根节点"
        x={100}
        y={100}
        onClose={vi.fn()}
        onOpenEntry={vi.fn()}
        onManage={vi.fn()}
      />,
    )

    expect(await screen.findByText('网络错误')).toBeInTheDocument()
  })
})
