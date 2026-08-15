import { describe, expect, it } from 'vitest'
import {
  addChild,
  addStickyNote,
  defaultContent,
  deleteNodes,
  deleteSubtree,
  descendants,
  moveNode,
  nextEdgeId,
  nextNodeId,
  parseContent,
  serializeContent,
  toggleCollapse,
  updateNodesStyle,
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

  it('addChild 可带布局坐标（画布模式在点击处加节点），缺省为 null', () => {
    const c = addChild(defaultContent(), 'n1', '', { x: 100, y: 200 })
    expect(c.nodes.n2.layout).toEqual({ x: 100, y: 200 })
    expect(addChild(defaultContent(), 'n1').nodes.n2.layout).toBeNull()
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

describe('addStickyNote（自由便签，PRD B2.5）', () => {
  it('新增便签：text 为空、sticky 标记、挂根节点、默认琥珀色、可带坐标', () => {
    const c = addStickyNote(defaultContent(), { x: 100, y: 200 })
    const n = c.nodes.n2
    expect(n.text).toBe('')
    expect(n.sticky).toBe(true)
    expect(n.parentId).toBe('n1')
    expect(n.style.color).toBe('amber')
    expect(n.layout).toEqual({ x: 100, y: 200 })
  })

  it('缺省坐标为 null', () => {
    expect(addStickyNote(defaultContent()).nodes.n2.layout).toBeNull()
  })
})

describe('deleteNodes（批量删除，PRD B2.6）', () => {
  it('删除多个节点及其子树，根跳过', () => {
    let c = defaultContent()
    c = addChild(c, 'n1', 'a') // n2
    c = addChild(c, 'n2', 'b') // n3（n2 子树）
    c = addChild(c, 'n1', 'c') // n4
    const out = deleteNodes(c, ['n2', 'n4'])
    expect(out.nodes.n2).toBeUndefined()
    expect(out.nodes.n3).toBeUndefined() // 子树级联
    expect(out.nodes.n4).toBeUndefined()
    expect(out.nodes.n1).toBeDefined()
  })

  it('选中子树根与后代时按并集只删一次', () => {
    let c = defaultContent()
    c = addChild(c, 'n1', 'a') // n2
    c = addChild(c, 'n2', 'b') // n3
    const out = deleteNodes(c, ['n2', 'n3'])
    expect(out.nodes.n2).toBeUndefined()
    expect(out.nodes.n3).toBeUndefined()
  })

  it('空列表或全为根返回原内容', () => {
    const c = defaultContent()
    expect(deleteNodes(c, [])).toBe(c)
    expect(deleteNodes(c, ['n1'])).toBe(c) // 根不可删
  })
})

describe('updateNodesStyle（批量设色/设形，PRD B2.6）', () => {
  it('批量合并更新多个节点样式，未选中不变', () => {
    let c = defaultContent()
    c = addChild(c, 'n1', 'a') // n2
    c = addChild(c, 'n1', 'b') // n3
    const out = updateNodesStyle(c, ['n2', 'n3'], { shape: 'diamond', color: 'red' })
    expect(out.nodes.n2.style).toEqual({ color: 'red', bold: false, shape: 'diamond' })
    expect(out.nodes.n3.style).toEqual({ color: 'red', bold: false, shape: 'diamond' })
    expect(out.nodes.n1.style.shape).toBe('rounded')
  })

  it('节点不存在跳过', () => {
    const c = defaultContent()
    expect(updateNodesStyle(c, ['n99'], { shape: 'rect' })).toBe(c)
  })
})

describe('parseContent 归一化 sticky 字段（旧数据缺省 false）', () => {
  it('缺省为 false，显式 true 保留', () => {
    const legacy = parseContent(
      JSON.stringify({ rootNodeId: 'n1', nodes: { n1: { id: 'n1', text: 'x', style: {}, parentId: null } }, edges: [] }),
    )
    expect(legacy.nodes.n1.sticky).toBe(false)
    const withSticky = parseContent(
      JSON.stringify({
        rootNodeId: 'n1',
        nodes: { n1: { id: 'n1', text: '', sticky: true, style: {}, parentId: null } },
        edges: [],
      }),
    )
    expect(withSticky.nodes.n1.sticky).toBe(true)
  })
})
