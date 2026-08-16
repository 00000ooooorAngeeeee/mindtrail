// M2 GUI 验收脚本纯函数单测（node:test，无第三方依赖）。
// 覆盖 100 节点画布内容生成器与断网模拟（死代理/连接审计）（docs/08 §6 DoD「关键逻辑补单测」）。
import { test } from 'node:test'
import assert from 'node:assert'
import { gridContent, offlineProxyArgs, parseNetstatRow, isLoopback, auditConnections } from '../verify-m2-gui.mjs'

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

// ---------- M4 收尾验收：断网模拟（OFFLINE_MODE=1） ----------

test('offlineProxyArgs：死代理指向不可达端口 + 回环显式 bypass', () => {
  const args = offlineProxyArgs()
  assert.ok(args.some((a) => a.startsWith('--proxy-server=http://127.0.0.1:')))
  assert.ok(args.some((a) => a.startsWith('--proxy-bypass-list=') && a.includes('127.0.0.1')))
})

test('parseNetstatRow：解析 Windows TCP 行（LISTENING/ESTABLISHED），非 TCP 行返回 null', () => {
  assert.deepStrictEqual(parseNetstatRow('  TCP    127.0.0.1:17860   0.0.0.0:0   LISTENING   1234'), {
    local: '127.0.0.1:17860', remote: '0.0.0.0:0', state: 'LISTENING', pid: 1234,
  })
  assert.deepStrictEqual(parseNetstatRow('  TCP    127.0.0.1:5177   127.0.0.1:17860   ESTABLISHED   5678'), {
    local: '127.0.0.1:5177', remote: '127.0.0.1:17860', state: 'ESTABLISHED', pid: 5678,
  })
  assert.strictEqual(parseNetstatRow('  UDP    0.0.0.0:1900   *:*   999'), null)
  assert.strictEqual(parseNetstatRow('垃圾行'), null)
})

test('isLoopback：127.0.0.1 / ::1（含 [::1] 端口形态）为回环，其余非回环', () => {
  assert.strictEqual(isLoopback('127.0.0.1:3306'), true)
  assert.strictEqual(isLoopback('[::1]:9222'), true)
  assert.strictEqual(isLoopback('0.0.0.0:0'), false)
  assert.strictEqual(isLoopback('1.2.3.4:443'), false)
  assert.strictEqual(isLoopback(''), false)
})

test('auditConnections：目标进程仅回环连接通过；外网连接被检出', () => {
  const rows = [
    parseNetstatRow('  TCP    127.0.0.1:5177   127.0.0.1:17860   ESTABLISHED   100'),
    parseNetstatRow('  TCP    127.0.0.1:17860   0.0.0.0:0   LISTENING   100'),
    parseNetstatRow('  TCP    127.0.0.1:3306   127.0.0.1:2222   ESTABLISHED   200'),
  ]
  assert.deepStrictEqual(auditConnections(rows, [100]), []) // LISTENING 不参与、回环通过
  const bad = [parseNetstatRow('  TCP    10.0.0.5:54321   8.8.8.8:443   ESTABLISHED   100')]
  assert.strictEqual(auditConnections(bad, [100]).length, 1)
  assert.deepStrictEqual(auditConnections(bad, [999]), []) // 非目标进程不审计
})
