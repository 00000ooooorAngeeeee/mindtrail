// 验收冒烟脚本关键逻辑单测（node:test，无第三方依赖）。
// 覆盖纯决策函数：缺失表检测、通过/失败汇总（docs/08 §6 DoD「关键逻辑补单测」）。
import { test } from 'node:test'
import assert from 'node:assert'
import { EXPECTED_TABLES, missingTables, summarize } from '../verify.mjs'

test('EXPECTED_TABLES：固定 8 张表，与 schema.sql 一致', () => {
  assert.strictEqual(EXPECTED_TABLES.length, 8)
  assert.ok(EXPECTED_TABLES.includes('workspace'))
  assert.ok(EXPECTED_TABLES.includes('entry_commit'))
})

test('missingTables：全部齐全返回空数组', () => {
  assert.deepStrictEqual(missingTables(EXPECTED_TABLES), [])
})

test('missingTables：缺表时返回缺失表名', () => {
  const actual = ['workspace', 'mindmap', 'session', 'entry', 'tag', 'entry_tag', 'entry_commit'] // 少 setting
  assert.deepStrictEqual(missingTables(actual), ['setting'])
})

test('summarize：全部通过输出 ALL PASS 且 pass=true', () => {
  const { pass, message } = summarize([
    { ok: true, name: 'A' },
    { ok: true, name: 'B' },
  ])
  assert.strictEqual(pass, true)
  assert.match(message, /M0 SMOKE: ALL PASS/)
  assert.match(message, /✓ A/)
})

test('summarize：任一失败输出 FAILED 且 pass=false，含失败项', () => {
  const { pass, message } = summarize([
    { ok: true, name: 'A' },
    { ok: false, name: 'B', error: '原因' },
  ])
  assert.strictEqual(pass, false)
  assert.match(message, /M0 SMOKE: FAILED/)
  assert.match(message, /✗ B — 原因/)
})
