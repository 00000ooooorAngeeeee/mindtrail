import { create } from 'zustand'
import { fetchHealth } from '../api/health'
import { batchDeleteWorkspaces, createWorkspace, deleteWorkspace, fetchWorkspaces, updateWorkspace } from '../api/workspaces'
import type { Health, Workspace } from '../api/types'

interface AppState {
  health: Health | null
  workspaces: Workspace[]
  loading: boolean
  creating: boolean
  error: string | null
  load: () => Promise<void>
  create: (name: string) => Promise<void>
  rename: (id: number, name: string) => Promise<void>
  remove: (id: number) => Promise<void>
  removeBatch: (ids: number[]) => Promise<void>
}

export const useAppStore = create<AppState>()((set) => ({
  health: null,
  workspaces: [],
  loading: false,
  creating: false,
  error: null,

  load: async () => {
    set({ loading: true, error: null })
    try {
      const [health, workspaces] = await Promise.all([fetchHealth(), fetchWorkspaces()])
      set({ health, workspaces, loading: false })
    } catch (e) {
      set({ loading: false, error: e instanceof Error ? e.message : '加载失败' })
    }
  },

  create: async (name) => {
    set({ creating: true, error: null })
    try {
      const ws = await createWorkspace(name)
      set((s) => ({ workspaces: [...s.workspaces, ws], creating: false }))
    } catch (e) {
      set({ creating: false, error: e instanceof Error ? e.message : '创建失败' })
    }
  },

  rename: async (id, name) => {
    try {
      const updated = await updateWorkspace(id, { name })
      set((s) => ({
        // 重命名不改计数：后端 update 现已带计数返回（07 §17 修复二遗留的重命名路径）；
        // 防御——若响应缺计数则保留列表已有计数，避免重命名后列表项「导图 0 · 会话 0」需进工作区才刷新。
        workspaces: s.workspaces.map((w) =>
          w.id === id
            ? {
                ...w,
                ...updated,
                mindmapCount: updated.mindmapCount ?? w.mindmapCount,
                sessionCount: updated.sessionCount ?? w.sessionCount,
              }
            : w,
        ),
      }))
    } catch (e) {
      set({ error: e instanceof Error ? e.message : '重命名失败' })
    }
  },

  remove: async (id) => {
    try {
      await deleteWorkspace(id)
      set((s) => ({ workspaces: s.workspaces.filter((w) => w.id !== id) }))
    } catch (e) {
      set({ error: e instanceof Error ? e.message : '删除失败' })
    }
  },
  removeBatch: async (ids) => {
    if (!ids.length) return
    try {
      await batchDeleteWorkspaces(ids)
      set((s) => ({ workspaces: s.workspaces.filter((w) => !ids.includes(w.id)) }))
    } catch (e) {
      set({ error: e instanceof Error ? e.message : '批量删除失败' })
    }
  },
}))
