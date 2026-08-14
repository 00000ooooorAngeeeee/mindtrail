import { describe, expect, it } from 'vitest'
import {
  addChild,
  defaultContent,
  deleteSubtree,
  descendants,
  moveNode,
  nextEdgeId,
  nextNodeId,
  parseContent,
  serializeContent,
  toggleCollapse,
  updateNodeText,
} from './content'

describe('parseContent / serializeContent', () => {
  it('空值回退默认内容（单根节点「中心主题」）', () => {
    const c = parseContent(null)
    expect(c.rootNodeId).toBe('n1')
    expect(c.nodes.n1.text).toBe('中心主题')
    expect(parseContent('  ').rootNodeId).toBe('n1')
  })

  it('序列化后解析往返一致', () => {
    const c = addChild(defaultContent(), 'n1', '子')
    const back = parseContent(serializeContent(c))
    expect(back.nodes.n2.text).toBe('子')
    expect(back.nodes.n2.parentId).toBe('n1')
  })

  it('非法 JSON 抛错', () => {
    expect(() => parseContent('{not-json')).toThrow('合法 JSON')
  })
})

describe('节点/边 id 生成', () => {
  it('nextNodeId 取现有最大数字 +1', () => {
    expect(nextNodeId(defaultContent())).toBe('n2')
  })

  it('nextEdgeId 从 e1 开始', () => {
    expect(nextEdgeId(defaultContent())).toBe('e1')
  })
})

describe('节点增删改移折叠（纯函数）', () => {
  it('addChild 挂到指定父节点并分配新 id', () => {
    const c = addChild(defaultContent(), 'n1', '子节点')
    expect(c.nodes.n2.parentId).toBe('n1')
    expect(c.nodes.n2.text).toBe('子节点')
  })

  it('updateNodeText 更新文本', () => {
    const c = updateNodeText(defaultContent(), 'n1', '改后的主题')
    expect(c.nodes.n1.text).toBe('改后的主题')
  })

  it('deleteSubtree 删除节点及其后代，根不可删', () => {
    let c = defaultContent()
    c = addChild(c, 'n1', 'a') // n2
    c = addChild(c, 'n2', 'b') // n3
    c = deleteSubtree(c, 'n2')
    expect(c.nodes.n2).toBeUndefined()
    expect(c.nodes.n3).toBeUndefined()
    expect(deleteSubtree(c, 'n1')).toBe(c) // 根不可删
  })

  it('moveNode 改层级', () => {
    let c = defaultContent()
    c = addChild(c, 'n1', 'a') // n2
    c = addChild(c, 'n1', 'b') // n3
    const moved = moveNode(c, 'n3', 'n2')
    expect(moved.nodes.n3.parentId).toBe('n2')
  })

  it('moveNode 拒绝环（移到自身后代）', () => {
    let c = defaultContent()
    c = addChild(c, 'n1', 'a') // n2
    c = addChild(c, 'n2', 'b') // n3
    c = addChild(c, 'n3', 'c') // n4
    expect(moveNode(c, 'n2', 'n4')).toBe(c)
  })

  it('moveNode 根不可移', () => {
    const c = addChild(defaultContent(), 'n1', 'a') // n2
    expect(moveNode(c, 'n1', 'n2')).toBe(c)
  })

  it('toggleCollapse 切换折叠状态', () => {
    const c = addChild(defaultContent(), 'n1', 'a') // n2
    const collapsed = toggleCollapse(c, 'n2')
    expect(collapsed.nodes.n2.collapsed).toBe(true)
    expect(toggleCollapse(collapsed, 'n2').nodes.n2.collapsed).toBe(false)
  })

  it('descendants 返回后代集合（不含自身）', () => {
    let c = defaultContent()
    c = addChild(c, 'n1', 'a') // n2
    c = addChild(c, 'n2', 'b') // n3
    expect(descendants(c, 'n2')).toEqual(new Set(['n3']))
  })
})
