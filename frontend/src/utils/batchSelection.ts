/**
 * 批量选择纯函数（04 §5 批量删除前端「选择模式」开关配套，无 React 依赖，可单测）。
 * 选中态用不可变 Set<number> 表示，避免 React 状态突变；toggle/selectAll/isAllSelected
 * 均为纯函数，便于在多列表（工作区/导图/会话/标签）复用同一套选择语义。
 */

/** 切换某 id 的选中态（不可变：返回新 Set，原 Set 不变）。 */
export function toggleIdInSet(ids: Set<number>, id: number): Set<number> {
  const next = new Set(ids)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  return next
}

/** 全选：用全部 id 构造选中集（新 Set）。 */
export function selectAllIds(allIds: number[]): Set<number> {
  return new Set(allIds)
}

/** 是否已全选：allIds 非空且其中每个 id 均被选中。 */
export function isAllSelected(selected: Set<number>, allIds: number[]): boolean {
  return allIds.length > 0 && allIds.every((id) => selected.has(id))
}

/** 仍被选中的有效条目数（剔除已不在列表中的陈旧 id）。 */
export function effectiveSelectedCount(selected: Set<number>, allIds: number[]): number {
  return allIds.filter((id) => selected.has(id)).length
}

/** 批量删除二次确认文案（删除前 confirm() 调用；cascade=true 时提示级联删除子数据）。 */
export function batchConfirmText(entityLabel: string, count: number, cascade = false): string {
  const note = cascade ? '（将级联删除其全部子数据，此操作不可撤销）' : '（此操作不可撤销）'
  return `确认删除选中的 ${count} 个${entityLabel}？${note}`
}

/** 批量合并二次确认文案（合并前 confirm() 调用；提示 N-1 个源将被删除、条目改挂目标）。 */
export function batchMergeConfirmText(sourceCount: number, targetName: string): string {
  return `确认将选中的 ${sourceCount} 个标签合并到「${targetName}」？其余 ${sourceCount - 1} 个标签将被删除，其条目改挂到「${targetName}」（此操作不可撤销）`
}
