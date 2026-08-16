// useMindmapStore 选中集幂等更新单测。
// 背景：React Flow onSelectionChange 回填同一选中集时，若每次都 set 新数组会引发
// effect 重放 setNodes → 再触发 onSelectionChange 的无限循环（React error #185，M2 总验收 GUI 实测抓出）。
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useMindmapStore } from './useMindmapStore'
import { addChild, defaultContent } from '../features/mindmap/content'
import { addFreeEdge } from '../features/mindmap/canvas'

describe('useMindmapStore.setSelectedIds（同集幂等）', () => {
  beforeEach(() => {
    useMindmapStore.setState({ selectedIds: [] })
  })

  it('空集回填空集：保持原数组引用（不触发状态变更）', () => {
    const before = useMindmapStore.getState().selectedIds
    useMindmapStore.getState().setSelectedIds([])
    expect(useMindmapStore.getState().selectedIds).toBe(before)
  })

  it('同集不同顺序/新数组：保持原数组引用', () => {
    useMindmapStore.setState({ selectedIds: ['a', 'b'] })
    const snap = useMindmapStore.getState().selectedIds
    useMindmapStore.getState().setSelectedIds(['b', 'a'])
    expect(useMindmapStore.getState().selectedIds).toBe(snap)
  })

  it('不同集：正常更新', () => {
    useMindmapStore.getState().setSelectedIds(['a'])
    expect(useMindmapStore.getState().selectedIds).toEqual(['a'])
    useMindmapStore.getState().setSelectedIds(['a', 'b'])
    expect(useMindmapStore.getState().selectedIds).toEqual(['a', 'b'])
  })
})

describe('useMindmapStore.updateEdgeLabel（统一 apply：历史/撤销/防抖保存，08 §4.3）', () => {
  beforeEach(() => {
    // 内容：根 n1 + 子 n2 + 自由边 e1（n1→n2）；假定时器避免防抖保存触发真实 API
    const c = addFreeEdge(addChild(defaultContent(), 'n1', '子'), 'n1', 'n2')
    useMindmapStore.setState({ content: c, history: { past: [], future: [] }, dirty: false, selectedIds: [] })
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    useMindmapStore.setState({ content: null, history: { past: [], future: [] } })
  })

  it('更新标签：置 dirty + 记录历史，可撤销还原', () => {
    useMindmapStore.getState().updateEdgeLabel('e1', '依赖关系')
    const s = useMindmapStore.getState()
    expect(s.content?.edges[0]?.label).toBe('依赖关系')
    expect(s.dirty).toBe(true)
    expect(s.history.past.length).toBe(1)
    s.undo()
    expect(useMindmapStore.getState().content?.edges[0]?.label).toBeNull()
  })

  it('同值更新不产生历史（apply 跳过）', () => {
    useMindmapStore.getState().updateEdgeLabel('e1', '依赖关系')
    useMindmapStore.getState().updateEdgeLabel('e1', '依赖关系')
    expect(useMindmapStore.getState().history.past.length).toBe(1)
  })
})
