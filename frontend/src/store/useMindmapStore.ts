// 导图编辑器状态（08 §4.3：画布节点/边变更必须走统一 store action，保证撤销/重做与保存一致性）。
// content 为唯一事实源；所有变更走纯函数（features/mindmap/content.ts）生成新对象，置 dirty 并记录历史。
// 保存策略（04 §6.1）：变更后 800ms 防抖自动保存；手动 Ctrl+S / 按钮保存；乐观锁冲突经 error 透出提示。
import { create } from 'zustand'
import { getMindmap, saveMindmap } from '../api/mindmaps'
import type { Mindmap } from '../api/types'
import {
  addChild as addChildPure,
  addStickyNote as addStickyNotePure,
  deleteNodes as deleteNodesPure,
  deleteSubtree,
  moveNode as moveNodePure,
  parseContent,
  serializeContent,
  toggleCollapse as toggleCollapsePure,
  updateEdgeLabel as updateEdgeLabelPure,
  updateNodesStyle as updateNodesStylePure,
  updateNodeText,
} from '../features/mindmap/content'
import type { MindmapContent, MindmapNodeStyle } from '../features/mindmap/content'
import {
  addFreeEdge as addFreeEdgePure,
  flattenLayout,
  isStrictTree,
  moveNodesLayout as moveNodesLayoutPure,
  removeAllFreeEdges,
  removeFreeEdge as removeFreeEdgePure,
} from '../features/mindmap/canvas'
import { computeTreeLayout } from '../features/mindmap/treeLayout'
import {
  record as recordHistory,
  redo as redoHistory,
  undo as undoHistory,
  type History,
} from '../features/mindmap/history'

/** 防抖保存间隔（04 §6.1：800ms 无操作即保存）。 */
const SAVE_DEBOUNCE_MS = 800

/** 导图视图模式（PRD B3.1）：同一份 content 的两种视图，模式本身不入库（05 §4 无模式字段）。 */
export type MindmapMode = 'tree' | 'canvas'

interface MindmapState {
  mindmap: Mindmap | null
  content: MindmapContent | null
  history: History
  /** 当前选中节点 id 集合（多选：框选/Shift+点选；单选时长度 0 或 1，PRD B2.6）。 */
  selectedIds: string[]
  mode: MindmapMode
  loading: boolean
  saving: boolean
  dirty: boolean
  error: string | null
  load: (id: number) => Promise<void>
  /** 单选（传 null 清空选择）。 */
  select: (id: string | null) => void
  /** 框选/Shift 多选结果：整体替换选中集（由 React Flow onSelectionChange 回填）。 */
  setSelectedIds: (ids: string[]) => void
  addChild: (parentId: string, layout?: { x: number; y: number } | null) => void
  addStickyNote: (layout?: { x: number; y: number } | null) => void
  updateText: (id: string, text: string) => void
  updateStyles: (ids: string[], style: Partial<MindmapNodeStyle>) => void
  deleteNode: (id: string) => void
  deleteNodes: (ids: string[]) => void
  moveNode: (id: string, newParentId: string) => void
  toggleCollapse: (id: string) => void
  moveNodesLayout: (updates: { id: string; x: number; y: number }[]) => void
  addFreeEdge: (source: string, target: string) => void
  removeFreeEdge: (edgeId: string) => void
  /** 更新自由边标签（PRD B2.2 P1「可编辑标签」）；空白视为清除（置 null）。 */
  updateEdgeLabel: (edgeId: string, label: string) => void
  /** 切换模式；画布→树遇非树边返回 'non-tree'（由 UI 弹三选一，07 §5）。 */
  switchMode: (next: MindmapMode) => 'ok' | 'non-tree'
  /** 三选一之「仅重排树形部分」：保留自由边切回树状（树视图忽略自由边，PRD B3.3）。 */
  forceTreeMode: () => void
  /** 三选一之「忽略非树边」：删除全部自由边后切回树状。 */
  ignoreFreeEdgesToTree: () => void
  undo: () => void
  redo: () => void
  clearError: () => void
  save: () => Promise<void>
}

/** 选中节点在内容变更后可能已不存在（如撤销了删除它的那一步），过滤掉不存在的 id；无变化返回原数组引用。 */
function fixSelection(content: MindmapContent, selectedIds: string[]): string[] {
  if (selectedIds.every((id) => content.nodes[id])) return selectedIds
  return selectedIds.filter((id) => content.nodes[id])
}

/**
 * 选中集相同（顺序无关、含新数组字面量）判定。
 * React Flow 的 onSelectionChange 会在节点渲染/选中属性变化时反复回填同一个选中集，
 * 若每次都 set 一个新数组会触发 effect 重放 setNodes → 再触发 onSelectionChange，形成
 * 「最大更新深度」无限循环（React error #185）。同集时跳过 set 即可打断该环。
 */
function sameIdSet(a: string[], b: string[]): boolean {
  if (a === b) return true
  if (a.length !== b.length) return false
  return a.every((id) => b.includes(id))
}

export const useMindmapStore = create<MindmapState>()((set, get) => {
  // 防抖定时器挂在闭包中，随 store 单例生命周期存在。
  let saveTimer: ReturnType<typeof setTimeout> | null = null
  const clearTimer = () => {
    if (saveTimer !== null) {
      clearTimeout(saveTimer)
      saveTimer = null
    }
  }
  const scheduleSave = () => {
    clearTimer()
    saveTimer = setTimeout(() => void get().save(), SAVE_DEBOUNCE_MS)
  }

  /** 统一变更入口：记录历史、置 dirty、调度防抖保存；无变化（next===content）则跳过。 */
  const apply = (next: MindmapContent, selectedIds?: string[]) => {
    const { content, history } = get()
    if (!content || next === content) return
    set({
      content: next,
      history: recordHistory(history, content),
      dirty: true,
      ...(selectedIds !== undefined ? { selectedIds } : {}),
    })
    scheduleSave()
  }

  return {
    mindmap: null,
    content: null,
    history: { past: [], future: [] },
    selectedIds: [],
    mode: 'tree',
    loading: false,
    saving: false,
    dirty: false,
    error: null,

    load: async (id) => {
      clearTimer()
      // 07 §25：切换导图时立即清空旧内容——旧 content/positions 残留会与「新 mindmapId + 旧 positions」
      // 组合，使自动适应门控（nodesReadyForFit）对上一图边界成立 → fitView 用错边界且 doneKey 记到
      // 新图 key 上，新图真正内容到达后不再适应（「切图往返随机无法适应」根因，实机打点证实）。
      set({
        loading: true,
        error: null,
        mindmap: null,
        content: null,
        history: { past: [], future: [] },
        selectedIds: [],
        mode: 'tree',
        dirty: false,
      })
      try {
        const mindmap = await getMindmap(id)
        set({
          mindmap,
          content: parseContent(mindmap.contentJson),
          history: { past: [], future: [] },
          selectedIds: [],
          mode: 'tree',
          loading: false,
          dirty: false,
        })
      } catch (e) {
        set({ loading: false, error: e instanceof Error ? e.message : '加载导图失败' })
      }
    },

    select: (id) => set({ selectedIds: id ? [id] : [] }),

    setSelectedIds: (ids) => {
      // 同集幂等跳过：打断 onSelectionChange 回填 → effect 重放 setNodes → onSelectionChange 的无限环
      if (sameIdSet(ids, get().selectedIds)) return
      set({ selectedIds: ids })
    },

    addChild: (parentId, layout = null) => {
      const { content } = get()
      if (!content) return
      const next = addChildPure(content, parentId, '', layout)
      const newId = Object.keys(next.nodes).find((id) => !(id in content.nodes))
      apply(next, [newId ?? parentId])
    },

    addStickyNote: (layout = null) => {
      const { content, selectedIds } = get()
      if (!content) return
      // 人工验收：便签应挂到选中节点（无选中/选中无效时回退根节点）
      const parentId = selectedIds[0] ?? content.rootNodeId
      const next = addStickyNotePure(content, layout, parentId)
      const newId = Object.keys(next.nodes).find((id) => !(id in content.nodes))
      apply(next, [newId ?? content.rootNodeId])
    },

    updateText: (id, text) => {
      const { content } = get()
      if (!content) return
      apply(updateNodeText(content, id, text))
    },

    updateStyles: (ids, style) => {
      const { content } = get()
      if (!content) return
      apply(updateNodesStylePure(content, ids, style))
    },

    deleteNode: (id) => {
      const { content, selectedIds } = get()
      if (!content) return
      const next = deleteSubtree(content, id)
      apply(next, fixSelection(next, selectedIds))
    },

    deleteNodes: (ids) => {
      const { content, selectedIds } = get()
      if (!content) return
      const next = deleteNodesPure(content, ids)
      apply(next, fixSelection(next, selectedIds))
    },

    moveNode: (id, newParentId) => {
      const { content } = get()
      if (!content) return
      apply(moveNodePure(content, id, newParentId))
    },

    toggleCollapse: (id) => {
      const { content } = get()
      if (!content) return
      apply(toggleCollapsePure(content, id))
    },

    moveNodesLayout: (updates) => {
      const { content } = get()
      if (!content) return
      // 坐标取整（防抖保存序列化时避免拖拽浮点噪声，PRD B2.1 位置持久化）。
      apply(moveNodesLayoutPure(content, updates.map((u) => ({ id: u.id, x: Math.round(u.x), y: Math.round(u.y) }))))
    },

    addFreeEdge: (source, target) => {
      const { content } = get()
      if (!content) return
      apply(addFreeEdgePure(content, source, target))
    },

    removeFreeEdge: (edgeId) => {
      const { content } = get()
      if (!content) return
      apply(removeFreeEdgePure(content, edgeId))
    },

    updateEdgeLabel: (edgeId, label) => {
      const { content } = get()
      if (!content) return
      apply(updateEdgeLabelPure(content, edgeId, label))
    },

    switchMode: (next) => {
      const { content, mode } = get()
      if (!content || next === mode) return 'ok'
      if (next === 'canvas') {
        // 树→画布：布局结果平铺为坐标（04 §6.4「布局结果平铺」）；折叠子树也平铺（画布忽略折叠）。
        set({ mode: next })
        apply(flattenLayout(content, computeTreeLayout(content, true)))
        return 'ok'
      }
      // 画布→树：边集构成严格树则直接切，否则交 UI 三选一（07 §5）。
      if (isStrictTree(content)) {
        set({ mode: 'tree' })
        return 'ok'
      }
      return 'non-tree'
    },

    forceTreeMode: () => set({ mode: 'tree' }),

    ignoreFreeEdgesToTree: () => {
      const { content } = get()
      if (!content) return
      apply(removeAllFreeEdges(content))
      set({ mode: 'tree' })
    },

    undo: () => {
      const { content, history, selectedIds } = get()
      if (!content) return
      const r = undoHistory(history, content)
      if (!r) return
      set({
        content: r.content,
        history: r.history,
        dirty: true,
        selectedIds: fixSelection(r.content, selectedIds),
      })
      scheduleSave()
    },

    redo: () => {
      const { content, history, selectedIds } = get()
      if (!content) return
      const r = redoHistory(history, content)
      if (!r) return
      set({
        content: r.content,
        history: r.history,
        dirty: true,
        selectedIds: fixSelection(r.content, selectedIds),
      })
      scheduleSave()
    },

    clearError: () => set({ error: null }),

    save: async () => {
      clearTimer()
      const { mindmap, content, saving } = get()
      if (!mindmap || !content || saving) return
      set({ saving: true, error: null })
      try {
        const updated = await saveMindmap(mindmap.id, serializeContent(content), mindmap.updatedAt)
        // 保存期间若内容又变了，保持 dirty 并继续调度下一次防抖保存；否则清 dirty。
        const unchanged = get().content === content
        set({ mindmap: updated, saving: false, ...(unchanged ? { dirty: false } : {}) })
        if (!unchanged) scheduleSave()
      } catch (e) {
        // 失败（含 409 乐观锁冲突）保留 dirty，不自动重试，由用户重试/刷新。
        set({ saving: false, error: e instanceof Error ? e.message : '保存失败' })
      }
    },
  }
})
