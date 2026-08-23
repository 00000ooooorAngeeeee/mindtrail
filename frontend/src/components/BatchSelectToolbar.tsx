import type { BatchSelect } from '../utils/useBatchSelect'

/**
 * 批量操作栏（04 §5 批量删除「选择模式」开关 + v1.2 P2 批量合并）：
 * - 非选择模式且 canEnter：渲染「批量操作」入口按钮（点击进入选择模式）；
 * - 选择模式：渲染「全选/取消全选」+「批量合并（N）」（onMerge 提供且 ≥2 选中可用）+「批量删除（N）」（0 选中禁用）+「退出选择」。
 *
 * 删除/合并前的二次确认与 API 调用由调用方 onDelete/onMerge 承担（不同实体文案/级联不同，
 * 调用方用 batchConfirmText/batchMergeConfirmText）。
 */
export function BatchSelectToolbar({
  batch,
  canEnter = true,
  onDelete,
  onMerge,
  mergeDisabled = false,
}: {
  batch: BatchSelect
  /** 是否存在可选条目（无条目时不显示入口，避免空操作）。 */
  canEnter?: boolean
  onDelete: () => void
  /** 批量合并入口（仅标签面板提供）：进入目标选择，由调用方承载确认与 API。 */
  onMerge?: () => void
  /** 合并动作是否被禁用（如加载中）。 */
  mergeDisabled?: boolean
}) {
  if (!batch.selectMode) {
    return canEnter ? (
      <button className="batch-enter" onClick={batch.enter}>
        批量操作
      </button>
    ) : null
  }
  return (
    <div className="batch-toolbar">
      <button onClick={() => (batch.isAllSelected ? batch.clearSelection() : batch.selectAll())}>
        {batch.isAllSelected ? '取消全选' : '全选'}
      </button>
      {onMerge && (
        <button disabled={batch.selectedCount < 2 || mergeDisabled} onClick={onMerge}>
          批量合并（{batch.selectedCount}）
        </button>
      )}
      <button className="danger" disabled={batch.selectedCount === 0} onClick={onDelete}>
        批量删除（{batch.selectedCount}）
      </button>
      <button onClick={batch.exit}>退出选择</button>
    </div>
  )
}
