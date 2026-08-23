import { useCallback, useState } from 'react'
import {
  effectiveSelectedCount,
  isAllSelected,
  selectAllIds,
  toggleIdInSet,
} from './batchSelection'

export interface BatchSelect {
  /** 是否处于「选择模式」（复选框可见、点击行即选中而非打开）。 */
  selectMode: boolean
  /** 当前选中 id 集合（不可变更新）。 */
  selected: Set<number>
  /** 仍存在于列表中的已选数量（剔除删除后陈旧 id）。 */
  selectedCount: number
  /** 是否已全选（allIds 非空且全被选中）。 */
  isAllSelected: boolean
  /** 进入选择模式并清空已选。 */
  enter: () => void
  /** 退出选择模式并清空已选。 */
  exit: () => void
  /** 切换某 id 选中态。 */
  toggle: (id: number) => void
  /** 全选当前 allIds。 */
  selectAll: () => void
  /** 清空已选（保持选择模式）。 */
  clearSelection: () => void
}

/**
 * 批量选择状态管理（04 §5 批量删除「选择模式」开关配套 hook）。
 *
 * allIds 为当前列表全部 id（由调用方从 items 派生）；删除后重载列表时 allIds 变化，
 * selectedCount/isAllSelected 自动重算（陈旧 id 不计入）。批量删除成功后调用方应 exit() 退出。
 */
export function useBatchSelect(allIds: number[]): BatchSelect {
  const [selectMode, setSelectMode] = useState(false)
  const [selected, setSelected] = useState<Set<number>>(() => new Set())

  const enter = useCallback(() => {
    setSelectMode(true)
    setSelected(new Set())
  }, [])
  const exit = useCallback(() => {
    setSelectMode(false)
    setSelected(new Set())
  }, [])
  const toggle = useCallback((id: number) => {
    setSelected((prev) => toggleIdInSet(prev, id))
  }, [])
  const selectAll = useCallback(() => {
    setSelected(selectAllIds(allIds))
  }, [allIds])
  const clearSelection = useCallback(() => {
    setSelected(new Set())
  }, [])

  return {
    selectMode,
    selected,
    selectedCount: effectiveSelectedCount(selected, allIds),
    isAllSelected: isAllSelected(selected, allIds),
    enter,
    exit,
    toggle,
    selectAll,
    clearSelection,
  }
}
