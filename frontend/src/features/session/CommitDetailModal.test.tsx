import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { CommitDetailModal } from './CommitDetailModal'
import { getCommitDiff } from '../../api/git'
import type { GitCommit } from '../../api/types'

vi.mock('../../api/git', () => ({
  getCommitDiff: vi.fn(),
}))

const diffMock = vi.mocked(getCommitDiff)

const H1 = '1'.repeat(40)
const commit = (): GitCommit => ({
  hash: H1,
  author: '验证者',
  authorEmail: 'verify@trailmind.local',
  time: '2025-06-01T09:30:00',
  message: 'feat: 提交信息\n\n正文第二行',
  files: ['a.txt', 'sub/b.txt'],
})

describe('CommitDetailModal diff 预览（v1.1 P1 C3.6，PRD C3.5「diff 预览 P1」）', () => {
  beforeEach(() => {
    diffMock.mockReset()
  })

  it('无仓库路径：不拉取 diff 也不渲染 Diff 区', () => {
    render(<CommitDetailModal commit={commit()} error={null} repoPath={null} onClose={() => {}} onUnbind={() => {}} />)
    expect(screen.getByRole('dialog', { name: '提交详情' })).toBeInTheDocument()
    expect(screen.getByText('a.txt')).toBeInTheDocument()
    expect(screen.queryByText(/Diff 预览/)).not.toBeInTheDocument()
    expect(diffMock).not.toHaveBeenCalled()
  })

  it('有仓库：按提交拉取 diff，文件折叠展示 + 增删徽标 + +/- 行着色', async () => {
    diffMock.mockResolvedValue({
      hash: H1,
      truncated: false,
      files: [
        {
          path: 'a.txt',
          diff: 'diff --git a/a.txt b/a.txt\n@@ -1 +1,2 @@\n 保留行\n-旧行\n+新行\n',
          added: 1,
          deleted: 1,
        },
      ],
    })
    render(<CommitDetailModal commit={commit()} error={null} repoPath="D:/repo" onClose={() => {}} onUnbind={() => {}} />)

    await waitFor(() => expect(diffMock).toHaveBeenCalledWith('D:/repo', H1))
    const section = screen.getByLabelText('diff 预览')
    expect(within(section).getByText(/1 文件/)).toBeInTheDocument()
    const file = within(section).getByText('a.txt').closest('details') as HTMLElement
    expect(within(file).getByText('+1')).toBeInTheDocument()
    expect(within(file).getByText('−1')).toBeInTheDocument()
    expect(within(file).getByText('保留行')).toBeInTheDocument()
    expect(within(file).getByText('+新行').className).toContain('diff-line-add')
    expect(within(file).getByText('-旧行').className).toContain('diff-line-del')
  })

  it('truncated=true 时显示截断提示', async () => {
    diffMock.mockResolvedValue({ hash: H1, truncated: true, files: [] })
    render(<CommitDetailModal commit={commit()} error={null} repoPath="D:/repo" onClose={() => {}} onUnbind={() => {}} />)
    await waitFor(() => expect(screen.getByText(/已截断/)).toBeInTheDocument())
  })

  it('diff 加载失败：显示错误但不阻塞详情展示', async () => {
    diffMock.mockRejectedValue(new Error('仓库不可读'))
    render(<CommitDetailModal commit={commit()} error={null} repoPath="D:/repo" onClose={() => {}} onUnbind={() => {}} />)
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('仓库不可读'))
    expect(screen.getByText(/feat: 提交信息/)).toBeInTheDocument() // 详情仍完整
    expect(screen.getByText('解绑')).toBeInTheDocument()
  })

  it('关闭/解绑回调照常接线', () => {
    const onClose = vi.fn()
    const onUnbind = vi.fn()
    render(<CommitDetailModal commit={commit()} error={null} repoPath={null} onClose={onClose} onUnbind={onUnbind} />)
    fireEvent.click(screen.getByText('解绑'))
    expect(onUnbind).toHaveBeenCalled()
    fireEvent.click(screen.getByText('关闭'))
    expect(onClose).toHaveBeenCalled()
  })
})
