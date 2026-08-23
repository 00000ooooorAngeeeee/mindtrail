/**
 * 重命名失焦判定（03 §4 / 用户需求：重命名点击旁边空白处退出，丢弃草稿保留原内容）。
 *
 * 纯函数：判断焦点是否离开了重命名编辑容器（.item-edit）。点击保存/取消按钮（容器内）
 * 不视为离开，交给其 onClick 处理；点击空白处或容器外元素 → 视为离开，调用方据此取消
 * 重命名（setEditing(false) / setEditingId(null)），丢弃输入框草稿、保留原内容。
 *
 * 通过 relatedTarget 判定而非定时器/全局监听，无时序竞态，且可纯函数单测。
 */
export function focusLeftEditor(related: EventTarget | null, editorClass = 'item-edit'): boolean {
  if (related == null) return true
  const el = related as Element
  if (typeof el.closest !== 'function') return true
  return el.closest(`.${editorClass}`) == null
}
