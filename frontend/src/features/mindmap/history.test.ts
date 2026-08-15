import { describe, expect, it } from 'vitest'
import { record, redo, undo, type History } from './history'
import { addChild, defaultContent, updateNodeText } from './content'

describe('撤销/重做历史（纯函数）', () => {
  it('record 把当前内容压入 past 并清空 future', () => {
    const c0 = defaultContent()
    const h = record({ past: [], future: [] }, c0)
    expect(h.past).toEqual([c0])
    expect(h.future).toEqual([])
  })

  it('在已有 future 的分支上记录新变更会清空 future', () => {
    const c0 = defaultContent()
    const c1 = addChild(c0, 'n1', 'a')
    const h = record({ past: [c0], future: [c1] }, c1)
    expect(h.past).toEqual([c0, c1])
    expect(h.future).toEqual([])
  })

  it('undo 返回上一步内容，把 present 移到 future 头部', () => {
    const c0 = defaultContent()
    const c1 = addChild(c0, 'n1', 'a')
    const r = undo({ past: [c0], future: [] }, c1)
    expect(r).not.toBeNull()
    expect(r!.content).toBe(c0)
    expect(r!.history.past).toEqual([])
    expect(r!.history.future).toEqual([c1])
  })

  it('undo 到空栈返回 null；redo 到空栈返回 null', () => {
    const c0 = defaultContent()
    const c1 = addChild(c0, 'n1', 'a')
    let h: History = { past: [c0], future: [] }
    const u = undo(h, c1)!
    expect(u.content).toBe(c0)
    expect(undo(u.history, u.content)).toBeNull()

    const r = redo(u.history, u.content)!
    expect(r.content).toBe(c1)
    expect(r.history.past).toEqual([c0])
    expect(r.history.future).toEqual([])
    expect(redo(r.history, r.content)).toBeNull()
  })

  it('多次操作后 undo/redo 依次回退与前进（覆盖增删改）', () => {
    let c = defaultContent()
    let h: History = { past: [], future: [] }
    const snapshots: typeof c[] = [c]
    const apply = (next: typeof c) => {
      h = record(h, c)
      c = next
      snapshots.push(c)
    }
    apply(addChild(c, 'n1', 'a')) // n2
    apply(updateNodeText(c, 'n2', '改后的文本'))
    apply(addChild(c, 'n1', 'b')) // n3

    for (let i = 2; i >= 0; i--) {
      const r = undo(h, c)!
      c = r.content
      h = r.history
      expect(c).toBe(snapshots[i])
    }
    expect(undo(h, c)).toBeNull()

    for (let i = 1; i <= 3; i++) {
      const r = redo(h, c)!
      c = r.content
      h = r.history
      expect(c).toBe(snapshots[i])
    }
    expect(redo(h, c)).toBeNull()
  })
})
