import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { SearchOverlay, type SearchNavigateTarget } from './SearchOverlay'
import { searchGlobal } from '../../api/search'
import type { SearchResults } from '../../api/types'

vi.mock('../../api/search', () => ({ searchGlobal: vi.fn() }))

const searchMock = vi.mocked(searchGlobal)

const results: SearchResults = {
  query: '布局',
  mindmaps: [
    {
      id: 10,
      workspaceId: 1,
      workspaceName: '产品工作区',
      name: '架构布局图',
      snippet: '…节点文本 布局算法 说明…',
      nodeId: 'n2',
      nodeCount: 12,
      updatedAt: '2025-06-01T10:00:00',
    },
  ],
  entries: [
    {
      id: 20,
      sessionId: 7,
      workspaceId: 1,
      workspaceName: '产品工作区',
      sessionTitle: 'M4 搜索会话',
      seq: 3,
      type: 'action',
      snippet: '实现 布局 算法',
      createdAt: '2025-06-01T09:30:00',
    },
  ],
  sessions: [
    {
      id: 7,
      workspaceId: 1,
      workspaceName: '产品工作区',
      title: '布局重构会话',
      status: 'active',
      startedAt: '2025-06-01T09:00:00',
      endedAt: null,
    },
  ],
}

describe('SearchOverlay 全局搜索浮层', () => {
  beforeEach(() => {
    searchMock.mockReset()
    searchMock.mockResolvedValue(results)
  })

  const open = (onNavigate: (t: SearchNavigateTarget) => void = vi.fn(), onClose = vi.fn(), onBrowseTags = vi.fn()) =>
    render(<SearchOverlay onClose={onClose} onNavigate={onNavigate} onBrowseTags={onBrowseTags} />)

  it('输入关键词防抖 300ms 后调用搜索接口', async () => {
    vi.useFakeTimers()
    open()
    fireEvent.change(screen.getByLabelText('搜索关键词'), { target: { value: '布局' } })
    expect(searchMock).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(300)
    expect(searchMock).toHaveBeenCalledWith('布局', { type: 'all' })
    vi.useRealTimers()
  })

  it('按类型分组展示结果并对关键词加 mark 高亮', async () => {
    open()
    fireEvent.change(screen.getByLabelText('搜索关键词'), { target: { value: '布局' } })

    // 标题经 Highlighted 拆分为多段文本节点，用 role=button 的可访问名（跨子节点拼接）匹配
    expect(await screen.findByRole('button', { name: /架构布局图/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /M4 搜索会话/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /布局重构会话/ })).toBeInTheDocument()
    // 高亮：snippet 中的命中段渲染为 <mark>
    expect(screen.getAllByRole('mark').length).toBeGreaterThan(0)
    // 类型分组头
    expect(screen.getByText('导图 · 1')).toBeInTheDocument()
    expect(screen.getByText('条目 · 1')).toBeInTheDocument()
    expect(screen.getByText('会话 · 1')).toBeInTheDocument()
  })

  it('点击导图结果回调带节点定位的跳转目标', async () => {
    const onNavigate = vi.fn()
    open(onNavigate)
    fireEvent.change(screen.getByLabelText('搜索关键词'), { target: { value: '布局' } })

    fireEvent.click(await screen.findByRole('button', { name: /架构布局图/ }))
    expect(onNavigate).toHaveBeenCalledWith({ kind: 'mindmap', workspaceId: 1, mindmapId: 10, nodeId: 'n2' })
  })

  it('点击条目结果回调带 seq 定位的跳转目标', async () => {
    const onNavigate = vi.fn()
    open(onNavigate)
    fireEvent.change(screen.getByLabelText('搜索关键词'), { target: { value: '布局' } })

    fireEvent.click(await screen.findByRole('button', { name: /M4 搜索会话/ }))
    expect(onNavigate).toHaveBeenCalledWith({ kind: 'entry', workspaceId: 1, sessionId: 7, entryId: 20, seq: 3 })
  })

  it('切换类型 Tab 后按该类型重新搜索', async () => {
    vi.useFakeTimers()
    open()
    fireEvent.change(screen.getByLabelText('搜索关键词'), { target: { value: '布局' } })
    await vi.advanceTimersByTimeAsync(300)

    fireEvent.click(screen.getByRole('tab', { name: /条目/ }))
    await vi.advanceTimersByTimeAsync(300)
    expect(searchMock).toHaveBeenLastCalledWith('布局', { type: 'entry' })
    vi.useRealTimers()
  })

  it('无结果显示空态提示与标签快速过滤入口（03 §7.3）', async () => {
    const onBrowseTags = vi.fn()
    searchMock.mockResolvedValue({ query: 'x', mindmaps: [], entries: [], sessions: [] })
    open(vi.fn(), vi.fn(), onBrowseTags)
    fireEvent.change(screen.getByLabelText('搜索关键词'), { target: { value: '不存在词' } })

    expect(await screen.findByText('未找到，试试其他关键词')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /按标签浏览/ }))
    expect(onBrowseTags).toHaveBeenCalledTimes(1)
  })

  it('Esc 关闭浮层', async () => {
    const onClose = vi.fn()
    open(vi.fn(), onClose)
    fireEvent.keyDown(screen.getByLabelText('搜索关键词'), { key: 'Escape' })
    expect(onClose).toHaveBeenCalled()
  })

  it('接口失败显示错误提示', async () => {
    searchMock.mockRejectedValue(new Error('无法连接后端服务'))
    open()
    fireEvent.change(screen.getByLabelText('搜索关键词'), { target: { value: '布局' } })

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('无法连接后端服务'))
  })
})
