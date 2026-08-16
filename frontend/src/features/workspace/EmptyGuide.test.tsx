import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { EmptyGuide } from './EmptyGuide'

describe('EmptyGuide 新工作区空态引导（03 §7.1，M4 任务五）', () => {
  it('渲染居中引导卡片：标题、双入口按钮与 30 秒快速上手提示', () => {
    render(<EmptyGuide workspaceName="项目A" onNewMindmap={vi.fn()} onNewSession={vi.fn()} />)

    expect(screen.getByText('开始使用「项目A」')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /新建第一张导图/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /开始第一次会话/ })).toBeInTheDocument()
    expect(screen.getByText('30 秒快速上手')).toBeInTheDocument()
    // 快速上手步骤：建导图 → 开会话 → 搜索复盘
    expect(screen.getByText(/双击空白处或选中节点按/)).toBeInTheDocument()
    expect(screen.getByText(/用底部快速记录框写条目/)).toBeInTheDocument()
    expect(screen.getByText(/全局搜索，会话结束前导出/)).toBeInTheDocument()
  })

  it('点击「新建第一张导图」回调，且不会误触会话入口', () => {
    const onNewMindmap = vi.fn()
    const onNewSession = vi.fn()
    render(<EmptyGuide workspaceName="项目A" onNewMindmap={onNewMindmap} onNewSession={onNewSession} />)

    fireEvent.click(screen.getByRole('button', { name: /新建第一张导图/ }))

    expect(onNewMindmap).toHaveBeenCalledTimes(1)
    expect(onNewSession).not.toHaveBeenCalled()
  })

  it('点击「开始第一次会话」回调', () => {
    const onNewMindmap = vi.fn()
    const onNewSession = vi.fn()
    render(<EmptyGuide workspaceName="项目A" onNewMindmap={onNewMindmap} onNewSession={onNewSession} />)

    fireEvent.click(screen.getByRole('button', { name: /开始第一次会话/ }))

    expect(onNewSession).toHaveBeenCalledTimes(1)
    expect(onNewMindmap).not.toHaveBeenCalled()
  })
})
