import { describe, expect, it } from 'vitest'
import { computeTreeLayout, LEVEL_GAP } from './treeLayout'
import { addChild, defaultContent, toggleCollapse } from './content'

/** 构造 root n1 → n2,n3；n2 → n4,n5。 */
function buildTree() {
  let c = defaultContent()
  c = addChild(c, 'n1', 'a') // n2
  c = addChild(c, 'n1', 'b') // n3
  c = addChild(c, 'n2', 'c') // n4
  c = addChild(c, 'n2', 'd') // n5
  return c
}

describe('computeTreeLayout 自研树布局', () => {
  it('单根节点位于原点', () => {
    const pos = computeTreeLayout(defaultContent())
    expect(pos.get('n1')).toEqual({ x: 0, y: 0 })
  })

  it('子节点在右侧一层，父节点垂直居中于子节点之间', () => {
    const pos = computeTreeLayout(buildTree())
    expect(pos.get('n2')!.x).toBe(LEVEL_GAP)
    expect(pos.get('n3')!.x).toBe(LEVEL_GAP)
    expect(pos.get('n2')!.y).not.toBe(pos.get('n3')!.y)
    expect(pos.get('n1')!.y).toBe((pos.get('n2')!.y + pos.get('n3')!.y) / 2)
  })

  it('所有可见节点坐标互不重叠', () => {
    const pos = computeTreeLayout(buildTree())
    const seen = new Set<string>()
    for (const p of pos.values()) {
      const key = `${p.x},${p.y}`
      expect(seen.has(key)).toBe(false)
      seen.add(key)
    }
  })

  it('折叠节点的子树不占位（布局收缩）', () => {
    const pos = computeTreeLayout(toggleCollapse(buildTree(), 'n2'))
    expect(pos.has('n2')).toBe(true)
    expect(pos.has('n4')).toBe(false)
    expect(pos.has('n5')).toBe(false)
    expect(pos.has('n3')).toBe(true)
  })

  it('ignoreCollapsed=true 时折叠子树也参与布局（画布模式忽略折叠，05 §4）', () => {
    const collapsed = toggleCollapse(buildTree(), 'n2')
    const pos = computeTreeLayout(collapsed, true)
    expect(pos.has('n4')).toBe(true)
    expect(pos.has('n5')).toBe(true)
    expect(computeTreeLayout(collapsed).has('n4')).toBe(false)
  })

  it('同一父下的叶子按 DFS 序垂直递增', () => {
    const pos = computeTreeLayout(buildTree())
    expect(pos.get('n4')!.y).toBeLessThan(pos.get('n5')!.y)
  })
})
