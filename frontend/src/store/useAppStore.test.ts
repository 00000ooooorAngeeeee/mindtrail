// useAppStore.rename 计数保留单测（修复 BUG：重命名工作区后列表「导图 0 · 会话 0」需进工作区才刷新）。
// 07 §17 修复二遗留的重命名路径：PUT 响应曾用 selectById 返回 null 计数，前端整对象替换使列表计数归零。
// 后端已改返回带计数的工作区（selectWithCounts），前端再加防御——响应缺计数时保留本地计数。
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useAppStore } from './useAppStore'
import * as workspacesApi from '../api/workspaces'
import type { Workspace } from '../api/types'

vi.mock('../api/workspaces', () => ({
  fetchHealth: vi.fn(),
  fetchWorkspaces: vi.fn(),
  createWorkspace: vi.fn(),
  updateWorkspace: vi.fn(),
  deleteWorkspace: vi.fn(),
  batchDeleteWorkspaces: vi.fn(),
}))

const updateMock = vi.mocked(workspacesApi.updateWorkspace)

describe('useAppStore.rename 计数保留', () => {
  beforeEach(() => {
    useAppStore.setState({
      workspaces: [{ id: 1, name: '旧名', mindmapCount: 3, sessionCount: 2 } as Workspace],
      error: null,
    })
    updateMock.mockReset()
  })

  it('后端返回带计数时使用后端计数', async () => {
    updateMock.mockResolvedValue({ id: 1, name: '新名', mindmapCount: 3, sessionCount: 2 })
    await useAppStore.getState().rename(1, '新名')
    const ws = useAppStore.getState().workspaces[0]
    expect(ws.name).toBe('新名')
    expect(ws.mindmapCount).toBe(3)
    expect(ws.sessionCount).toBe(2)
    expect(updateMock).toHaveBeenCalledWith(1, { name: '新名' })
  })

  it('后端响应缺计数时保留本地计数（修复重命名后列表计数归零）', async () => {
    // 模拟后端响应不带计数（历史 selectById 行为 / 防御回归）：前端须保留列表已有计数，不归零。
    updateMock.mockResolvedValue({ id: 1, name: '新名' })
    await useAppStore.getState().rename(1, '新名')
    const ws = useAppStore.getState().workspaces[0]
    expect(ws.name).toBe('新名')
    expect(ws.mindmapCount).toBe(3) // 保留本地
    expect(ws.sessionCount).toBe(2) // 保留本地
  })

  it('重命名失败置 error 且不改动列表', async () => {
    updateMock.mockRejectedValue(new Error('乐观锁冲突'))
    await useAppStore.getState().rename(1, '新名')
    const ws = useAppStore.getState().workspaces[0]
    expect(ws.name).toBe('旧名') // 不变
    expect(ws.mindmapCount).toBe(3)
    expect(useAppStore.getState().error).toBe('乐观锁冲突')
  })
})
