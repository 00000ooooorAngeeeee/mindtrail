// 导图编辑器状态（08 §4.3：画布节点/边变更必须走统一 store action，保证后续撤销/重做与保存一致性）。
// content 为唯一事实源；所有变更走纯函数（features/mindmap/content.ts）生成新对象，置 dirty。
import { create } from 'zustand'
import { getMindmap, saveMindmap } from '../api/mindmaps'
import type { Mindmap } from '../api/types'
import {
  addChild as addChildPure,
  deleteSubtree,
  moveNode as moveNodePure,
  parseContent,
  serializeContent,
  toggleCollapse as toggleCollapsePure,
  updateNodeText,
} from '../features/mindmap/content'
import type { MindmapContent } from '../features/mindmap/content'

interface MindmapState {
  mindmap: Mindmap | null
  content: MindmapContent | null
  selectedId: string | null
  loading: boolean
  saving: boolean
  dirty: boolean
  error: string | null
  load: (id: number) => Promise<void>
  select: (id: string | null) => void
  addChild: (parentId: string) => void
  updateText: (id: string, text: string) => void
  deleteNode: (id: string) => void
  moveNode: (id: string, newParentId: string) => void
  toggleCollapse: (id: string) => void
  save: () => Promise<void>
}

export const useMindmapStore = create<MindmapState>()((set, get) => ({
  mindmap: null,
  content: null,
  selectedId: null,
  loading: false,
  saving: false,
  dirty: false,
  error: null,

  load: async (id) => {
    set({ loading: true, error: null })
    try {
      const mindmap = await getMindmap(id)
      set({
        mindmap,
        content: parseContent(mindmap.contentJson),
        selectedId: null,
        loading: false,
        dirty: false,
      })
    } catch (e) {
      set({ loading: false, error: e instanceof Error ? e.message : '加载导图失败' })
    }
  },

  select: (id) => set({ selectedId: id }),

  addChild: (parentId) => {
    const { content } = get()
    if (!content) return
    const next = addChildPure(content, parentId)
    const newId = Object.keys(next.nodes).find((id) => !(id in content.nodes))
    set({ content: next, dirty: true, selectedId: newId ?? parentId })
  },

  updateText: (id, text) => {
    const { content } = get()
    if (!content) return
    set({ content: updateNodeText(content, id, text), dirty: true })
  },

  deleteNode: (id) => {
    const { content, selectedId } = get()
    if (!content) return
    set({ content: deleteSubtree(content, id), dirty: true, selectedId: selectedId === id ? null : selectedId })
  },

  moveNode: (id, newParentId) => {
    const { content } = get()
    if (!content) return
    set({ content: moveNodePure(content, id, newParentId), dirty: true })
  },

  toggleCollapse: (id) => {
    const { content } = get()
    if (!content) return
    set({ content: toggleCollapsePure(content, id), dirty: true })
  },

  save: async () => {
    const { mindmap, content, saving } = get()
    if (!mindmap || !content || saving) return
    set({ saving: true, error: null })
    try {
      const updated = await saveMindmap(mindmap.id, serializeContent(content), mindmap.updatedAt)
      set({ mindmap: updated, dirty: false, saving: false })
    } catch (e) {
      set({ saving: false, error: e instanceof Error ? e.message : '保存失败' })
    }
  },
}))
