// 画布模式纯函数单测（08 §6「前端纯函数单测」：布局平铺、严格树判定、自由边增删、坐标持久化）。
import { describe, expect, it } from 'vitest'
import { addChild, defaultContent } from './content'
import {
  addFreeEdge,
  flattenLayout,
  isStrictTree,
  moveNodesLayout,
  removeAllFreeEdges,
  removeFreeEdge,
} from './canvas'

/** 三节点树：n1 根 + n2/n3 两个分支。 */
function threeNodeTree() {
  let c = defaultContent()
  c = addChild(c, 'n1', 'a') // n2
  c = addChild(c, 'n1', 'b') // n3
  return c
}

describe('flattenLayout（树→画布平铺）', () => {
  it('把布局坐标写入各节点 layout', () => {
    const c = threeNodeTree()
    const positions = new Map([
      ['n1', { x: 0, y: 0 }],
      ['n2', { x: 200, y: 0 }],
      ['n3', { x: 200, y: 64 }],
    ])
    const flat = flattenLayout(c, positions)
    expect(flat.nodes.n1.layout).toEqual({ x: 0, y: 0 })
    expect(flat.nodes.n2.layout).toEqual({ x: 200, y: 0 })
    expect(flat.nodes.n3.layout).toEqual({ x: 200, y: 64 })
  })

  it('无坐标的节点保持原 layout，且不修改原内容', () => {
    const c = threeNodeTree()
    const flat = flattenLayout(c, new Map([['n1', { x: 1, y: 2 }]]))
    expect(flat.nodes.n2.layout).toBeNull()
    expect(c.nodes.n1.layout).toBeNull()
  })

  it('坐标未变化时返回原对象（重复平铺不产生历史/保存噪声）', () => {
    const c = threeNodeTree()
    const positions = new Map([
      ['n1', { x: 0, y: 0 }],
      ['n2', { x: 200, y: 0 }],
      ['n3', { x: 200, y: 64 }],
    ])
    const flat = flattenLayout(c, positions)
    expect(flattenLayout(flat, positions)).toBe(flat)
  })
})

describe('isStrictTree（画布→树严格树判定）', () => {
  it('纯树（无自由边）为严格树', () => {
    expect(isStrictTree(threeNodeTree())).toBe(true)
  })

  it('自由边指向已有父链的节点（多父）非严格树', () => {
    const c = threeNodeTree()
    expect(isStrictTree(addFreeEdge(c, 'n2', 'n3'))).toBe(false)
  })

  it('自由边指向根非严格树', () => {
    const c = threeNodeTree()
    expect(isStrictTree(addFreeEdge(c, 'n2', 'n1'))).toBe(false)
  })

  it('自由边成环（根不可达）非严格树', () => {
    let c = threeNodeTree()
    c = { ...c, nodes: { ...c.nodes, n4: { ...c.nodes.n2, id: 'n4', parentId: null }, n5: { ...c.nodes.n2, id: 'n5', parentId: null } } }
    c = addFreeEdge(c, 'n4', 'n5')
    c = addFreeEdge(c, 'n5', 'n4')
    expect(isStrictTree(c)).toBe(false)
  })

  it('自由边把孤立节点接入树（仍为严格树）为 true', () => {
    let c = threeNodeTree()
    const orphan = { ...c.nodes.n2, id: 'n9', parentId: null }
    c = { ...c, nodes: { ...c.nodes, n9: orphan } }
    c = addFreeEdge(c, 'n2', 'n9')
    expect(isStrictTree(c)).toBe(true)
  })
})

describe('moveNodesLayout（画布移动坐标持久化，PRD B2.1/B2.6）', () => {
  it('批量更新多个节点 layout', () => {
    const c = threeNodeTree()
    const out = moveNodesLayout(c, [
      { id: 'n2', x: 100, y: 200 },
      { id: 'n3', x: 300, y: 400 },
    ])
    expect(out.nodes.n2.layout).toEqual({ x: 100, y: 200 })
    expect(out.nodes.n3.layout).toEqual({ x: 300, y: 400 })
    expect(out.nodes.n1.layout).toBeNull()
  })

  it('节点不存在跳过；全无变化返回原内容', () => {
    const c = threeNodeTree()
    expect(moveNodesLayout(c, [{ id: 'n99', x: 1, y: 2 }])).toBe(c)
  })
})

describe('addFreeEdge（画布自由连线）', () => {
  it('新增 type=free 的边并分配边 id', () => {
    const c = addFreeEdge(threeNodeTree(), 'n2', 'n3')
    expect(c.edges).toHaveLength(1)
    expect(c.edges[0]).toMatchObject({ source: 'n2', target: 'n3', type: 'free' })
    expect(c.edges[0].id).toBe('e1')
  })

  it('自环、重复连线、节点不存在均返回原内容', () => {
    const c = threeNodeTree()
    expect(addFreeEdge(c, 'n2', 'n2')).toBe(c)
    const withEdge = addFreeEdge(c, 'n2', 'n3')
    expect(addFreeEdge(withEdge, 'n2', 'n3')).toBe(withEdge)
    expect(addFreeEdge(c, 'n2', 'n99')).toBe(c)
    expect(addFreeEdge(c, 'n99', 'n2')).toBe(c)
  })
})

describe('removeFreeEdge / removeAllFreeEdges（自由边删除）', () => {
  it('按 id 删除自由边；边不存在返回原内容', () => {
    let c = threeNodeTree()
    c = addFreeEdge(c, 'n2', 'n3')
    const removed = removeFreeEdge(c, 'e1')
    expect(removed.edges).toHaveLength(0)
    expect(removeFreeEdge(c, 'e99')).toBe(c)
  })

  it('removeAllFreeEdges 清空全部自由边（忽略非树边）', () => {
    let c = threeNodeTree()
    c = addFreeEdge(c, 'n2', 'n3')
    c = addFreeEdge(c, 'n3', 'n1')
    expect(removeAllFreeEdges(c).edges).toHaveLength(0)
  })
})
