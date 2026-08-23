import { describe, expect, it } from 'vitest'
import { focusLeftEditor } from './renameBlur'

describe('focusLeftEditor 重命名失焦判定', () => {
  it('relatedTarget 为 null（点击非聚焦空白处）→ 视为离开', () => {
    expect(focusLeftEditor(null)).toBe(true)
  })

  it('relatedTarget 在编辑容器内（保存/取消按钮）→ 不视为离开，交给按钮 onClick', () => {
    const editor = document.createElement('span')
    editor.className = 'item-edit'
    const saveBtn = document.createElement('button')
    editor.appendChild(saveBtn)
    expect(focusLeftEditor(saveBtn)).toBe(false)

    const cancelBtn = document.createElement('button')
    editor.appendChild(cancelBtn)
    expect(focusLeftEditor(cancelBtn)).toBe(false)
  })

  it('relatedTarget 为容器外元素 → 视为离开（丢弃草稿保留原内容）', () => {
    const other = document.createElement('button')
    expect(focusLeftEditor(other)).toBe(true)
  })

  it('自定义编辑容器类名生效', () => {
    const editor = document.createElement('span')
    editor.className = 'tag-edit'
    const btn = document.createElement('button')
    editor.appendChild(btn)
    expect(focusLeftEditor(btn, 'tag-edit')).toBe(false)
    expect(focusLeftEditor(btn, 'item-edit')).toBe(true) // 不匹配的类名 → 视为离开
  })
})
