// FreeEdge 标签编辑交互单测（PRD B2.2 P1「可编辑标签」）。
// EdgeLabelEditor 为纯展示组件（不依赖 React Flow store，见 FreeEdge.tsx 注释），
// 直接测 Enter 确认 / Esc 取消 / 失焦提交 / 初值回填四分支。
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { EdgeLabelEditor } from './FreeEdge'

describe('EdgeLabelEditor（连线标签编辑框）', () => {
  it('初值回填（编辑已有标签）', () => {
    render(<EdgeLabelEditor initial="依赖关系" x={0} y={0} onCommit={() => {}} onCancel={() => {}} />)
    expect((screen.getByRole('textbox') as HTMLInputElement).value).toBe('依赖关系')
  })

  it('Enter 提交草稿（不触发 cancel）', () => {
    const onCommit = vi.fn()
    const onCancel = vi.fn()
    render(<EdgeLabelEditor initial="" x={0} y={0} onCommit={onCommit} onCancel={onCancel} />)
    const input = screen.getByRole('textbox')
    fireEvent.change(input, { target: { value: '引用关系' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onCommit).toHaveBeenCalledWith('引用关系')
    expect(onCancel).not.toHaveBeenCalled()
  })

  it('Esc 取消不提交', () => {
    const onCommit = vi.fn()
    const onCancel = vi.fn()
    render(<EdgeLabelEditor initial="旧标签" x={0} y={0} onCommit={onCommit} onCancel={onCancel} />)
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Escape' })
    expect(onCancel).toHaveBeenCalledTimes(1)
    expect(onCommit).not.toHaveBeenCalled()
  })

  it('失焦提交当前草稿', () => {
    const onCommit = vi.fn()
    render(<EdgeLabelEditor initial="旧" x={0} y={0} onCommit={onCommit} onCancel={() => {}} />)
    const input = screen.getByRole('textbox')
    fireEvent.change(input, { target: { value: '新标签' } })
    fireEvent.blur(input)
    expect(onCommit).toHaveBeenCalledWith('新标签')
  })
})
