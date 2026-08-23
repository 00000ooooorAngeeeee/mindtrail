import { showToast } from './toast'

/**
 * 删除带撤销（v1.2 P2「删除内容时采用带撤销操作的轻提示」）：
 * ① 乐观移除 UI（optimisticRemove）→ ② 弹「已删除 X · 撤销」toast →
 * ③ 到期未撤销才真正调用后端删除（performDelete）；撤销则恢复 UI 且不删除。
 * 删除失败回退（恢复 UI + 错误 toast）。
 *
 * 适用：侧边栏单条删除（工作区/导图/会话/标签）。批量删除仍用二次确认
 * （多选破坏性强、撤销多对象复杂度收益低，PRD A4/B1.4/C1.4 均写「二次确认」）。
 *
 * 注意：调用方需自行用 pendingDelete 集合过滤列表，避免删除窗口内重拉把
 * 「已乐观移除但未真删」的项又拉回（见 Sidebar 实现）。
 */
export interface UndoDeleteOptions {
  /** 人类可读标签，如「导图「需求梳理」」。 */
  label: string
  /** 真正的后端删除（到期未撤销时调用）。 */
  performDelete: () => Promise<void>
  /** 立即从 UI 移除（乐观）。 */
  optimisticRemove: () => void
  /** 撤销时恢复 UI。 */
  optimisticRestore: () => void
  /** toast 自动消失 / 真正删除延迟毫秒，默认 5000。 */
  durationMs?: number
}

export function deleteWithUndo(opts: UndoDeleteOptions): void {
  const duration = opts.durationMs ?? 5000
  opts.optimisticRemove()
  let undone = false
  showToast(`已删除 ${opts.label}`, {
    actionLabel: '撤销',
    durationMs: duration,
    onAction: () => {
      if (undone) return
      undone = true
      opts.optimisticRestore()
    },
  })
  // 到期（toast 自动消失）后若未撤销则真正删除。
  setTimeout(() => {
    if (undone) return
    opts
      .performDelete()
      .catch((e) => {
        opts.optimisticRestore()
        showToast(`删除失败：${e instanceof Error ? e.message : '未知错误'}`, { durationMs: 5000 })
      })
  }, duration)
}
