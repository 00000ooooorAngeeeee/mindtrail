import { create } from 'zustand'
import { fetchHealth } from '../api/health'
import { fetchWorkspaces, createWorkspace } from '../api/workspaces'
import type { Health, Workspace } from '../api/types'

interface AppState {
  health: Health | null
  workspaces: Workspace[]
  loading: boolean
  creating: boolean
  error: string | null
  load: () => Promise<void>
  create: (name: string) => Promise<void>
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
}))
