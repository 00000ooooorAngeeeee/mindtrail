// 撤销/重做历史（07 §4「撤销/重做」验收项）：基于 content 不可变快照的 past/future 双栈。
// 纯函数，无 React/状态依赖，便于单测（08 §6「前端纯函数单测」）。
// 语义：record 把 present 压入 past 并清空 future（开始新分支）；undo 回退一步、redo 前进一步。

import type { MindmapContent } from './content'

export interface History {
  past: MindmapContent[]
  future: MindmapContent[]
}

/** 记录一次变更：把当前内容 present 压入 past，并清空 future。 */
export function record(history: History, present: MindmapContent): History {
  return { past: [...history.past, present], future: [] }
}

/** 撤销一步：返回上一步内容与新历史；无可撤销返回 null。 */
export function undo(
  history: History,
  present: MindmapContent,
): { history: History; content: MindmapContent } | null {
  const prev = history.past[history.past.length - 1]
  if (!prev) return null
  return {
    history: { past: history.past.slice(0, -1), future: [present, ...history.future] },
    content: prev,
  }
}

/** 重做一步：返回下一步内容与新历史；无可重做返回 null。 */
export function redo(
  history: History,
  present: MindmapContent,
): { history: History; content: MindmapContent } | null {
  const next = history.future[0]
  if (!next) return null
  return {
    history: { past: [...history.past, present], future: history.future.slice(1) },
    content: next,
  }
}
