// M2 GUI 验收脚本纯函数单测（node:test，无第三方依赖）。
// 覆盖 100 节点画布内容生成器（docs/08 §6 DoD「关键逻辑补单测」）。
import { test } from 'node:test'
import assert from 'node:assert'
import { gridContent } from '../verify-m2-gui.mjs'

test('gridContent：默认生成 100 业务节点 + 1 根，构成严格树（全部挂根）', () => {
  const c = gridContent()
  const nodes = Object.values(c.nodes)
  assert.strictEqual(nodes.length, 101)
  assert.strictEqual(c.rootNodeId, 'n1')
  assert.strictEqual(c.nodes.n1.parentId, null)
  for (const n of nodes) {
    if (n.id !== 'n1') assert.strictEqual(n.parentId, 'n1', `节点 ${n.id} 应挂根`)
  }
  assert.deepStrictEqual(c.edges, [])
})

test('gridContent：10 列网格布局坐标确定（第 i 个节点 x=(i-1)%10*220）', () => {
  const c = gridContent(20)
  assert.deepStrictEqual(c.nodes.n1.layout, { x: -240, y: 405 })
  assert.deepStrictEqual(c.nodes.n2.layout, { x: 0, y: 0 }) // i=1
  assert.deepStrictEqual(c.nodes.n11.layout, { x: 1980, y: 0 }) // i=10 → 第 1 行末列
  assert.deepStrictEqual(c.nodes.n21.layout, { x: 1980, y: 90 }) // i=20 → 第 2 行末列
  assert.strictEqual(Object.keys(c.nodes).length, 21)
})

test('gridContent：count 参数决定业务节点数', () => {
  assert.strictEqual(Object.keys(gridContent(0).nodes).length, 1)
  assert.strictEqual(Object.keys(gridContent(5).nodes).length, 6)
})
