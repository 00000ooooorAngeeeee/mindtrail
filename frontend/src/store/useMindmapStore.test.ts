// useMindmapStore 选中集幂等更新单测。
// 背景：React Flow onSelectionChange 回填同一选中集时，若每次都 set 新数组会引发
// effect 重放 setNodes → 再触发 onSelectionChange 的无限循环（React error #185，M2 总验收 GUI 实测抓出）。
import { beforeEach, describe, expect, it } from 'vitest'
import { useMindmapStore } from './useMindmapStore'

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
