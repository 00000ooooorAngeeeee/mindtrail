import { describe, expect, it } from 'vitest'
import { buildNodePath, previewLine, toggleSelection } from './linkage'
import type { MindmapContent } from '../mindmap/content'

/** 构造最小 content（id → text/parentId）。 */
function contentOf(spec: Record<string, { text?: string; parentId?: string | null }>): MindmapContent {
  const nodes: MindmapContent['nodes'] = {}
  for (const [id, n] of Object.entries(spec)) {
    nodes[id] = {
      id,
      text: n.text ?? '',
      style: { color: 'default', bold: false, shape: 'rounded' },
      tags: [],
      parentId: n.parentId ?? null,
      layout: null,
      collapsed: false,
      sticky: false,
    }
  }
  return { version: 1, rootNodeId: 'n1', nodes, edges: [] }
}

describe('toggleSelection 挂接勾选集合', () => {
  it('未含则追加（保持顺序）', () => {
    expect(toggleSelection([1, 3], 2)).toEqual([1, 3, 2])
  })

  it('已含则移除', () => {
    expect(toggleSelection([1, 3, 2], 3)).toEqual([1, 2])
  })

  it('不修改原数组', () => {
    const cur = [1]
    toggleSelection(cur, 2)
    expect(cur).toEqual([1])
  })

  it('空集合追加', () => {
    expect(toggleSelection([], 7)).toEqual([7])
  })
})

describe('buildNodePath 祖先链路径', () => {
  const content = contentOf({
    n1: { text: '根' },
    n2: { text: '思维导图', parentId: 'n1' },
    n3: { text: '导图', parentId: 'n2' },
  })

  it('根节点路径为自身', () => {
    expect(buildNodePath(content, 'n1')).toBe('根')
  })

  it('深层节点含完整祖先链', () => {
    expect(buildNodePath(content, 'n3')).toBe('根 / 思维导图 / 导图')
  })

  it('空白文本节点回退显示 id', () => {
    const c = contentOf({ n1: { text: '根' }, n2: { text: '  ', parentId: 'n1' } })
    expect(buildNodePath(c, 'n2')).toBe('根 / n2')
  })

  it('成环脏数据截断不死循环', () => {
    const c = contentOf({ n1: { parentId: 'n2' }, n2: { parentId: 'n1' } })
    expect(buildNodePath(c, 'n1').split(' / ').length).toBeLessThanOrEqual(20)
  })
})

describe('previewLine 候选条目单行预览', () => {
  it('取首个非空行并去空白', () => {
    expect(previewLine('\n  第一行内容  \n第二行')).toBe('第一行内容')
  })

  it('超长截断加省略号', () => {
    expect(previewLine('x'.repeat(100))).toBe(`${'x'.repeat(60)}…`)
  })

  it('空值返回空串', () => {
    expect(previewLine(null)).toBe('')
    expect(previewLine('  \n  ')).toBe('')
  })
})
