// M4 收尾验收 复盘路径脚本纯函数单测（node:test，无第三方依赖）。
// 覆盖夹具回填判定/时间计划/回填 SQL（docs/08 §6 DoD「关键逻辑补单测」）。
import { test } from 'node:test'
import assert from 'node:assert'
import { FIXTURE, isOldEnough, planFixtureTimes, backdateSql } from '../verify-m4-acceptance.mjs'

const DAY = 86400_000

test('isOldEnough：距今 ≥7 天为真，不足为假，非法串为假', () => {
  const now = Date.parse('2026-08-16T12:00:00+08:00')
  assert.strictEqual(isOldEnough('2026-08-06T09:00:00', 7, now), true)
  assert.strictEqual(isOldEnough('2026-08-09T12:00:00', 7, now), true) // 恰好 7 天
  assert.strictEqual(isOldEnough('2026-08-09T12:30:00', 7, now), false) // 差 30 分钟（超容差）
  assert.strictEqual(isOldEnough('2026-08-16T12:00:00', 7, now), false)
  assert.strictEqual(isOldEnough('不是时间', 7, now), false)
})

test('planFixtureTimes：10 天前 09:00–11:30，9 个条目时间单调递增且格式合法', () => {
  const t = planFixtureTimes(Date.parse('2026-08-16T21:00:00+08:00'))
  assert.strictEqual(t.sessionStart.slice(0, 10), '2026-08-06')
  assert.strictEqual(t.sessionStart.slice(11), '09:00:00')
  assert.strictEqual(t.sessionEnd.slice(11), '11:30:00')
  assert.strictEqual(t.entries.length, 9)
  for (const v of t.entries) assert.match(v, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/)
  for (let i = 1; i < t.entries.length; i++) {
    assert.ok(t.entries[i] > t.entries[i - 1], `条目时间应递增：${t.entries[i - 1]} → ${t.entries[i]}`)
  }
})

test('backdateSql：session 起止时间回填 + 条目按 seq 回填 + ELSE 保护防 NULL', () => {
  const t = planFixtureTimes(Date.parse('2026-08-16T21:00:00+08:00'))
  const sql = backdateSql(248, t)
  assert.ok(sql.includes(`UPDATE session SET started_at='${t.sessionStart}'`))
  assert.ok(sql.includes(`WHERE id=248`))
  assert.ok(sql.includes(`UPDATE entry SET created_at=CASE seq`))
  assert.ok(sql.includes(`WHEN 1 THEN '${t.entries[0]}'`))
  assert.ok(sql.includes(`WHEN 9 THEN '${t.entries[8]}'`))
  assert.ok(sql.includes('ELSE created_at END')) // CASE 未命中分支不落 NULL
  assert.ok(sql.includes('WHERE session_id=248'))
})

test('FIXTURE：夹具定义完备（goal/review 齐备、关键词覆盖、标签非空）', () => {
  const types = FIXTURE.entries.map((e) => e.type)
  assert.ok(types.includes('goal') && types.includes('review') && types.includes('next'))
  assert.strictEqual(FIXTURE.entries.filter((e) => e.contentMd.includes(FIXTURE.keyword)).length >= 3, true)
  assert.ok(FIXTURE.entries.some((e) => e.tags.includes(FIXTURE.tag)))
  assert.strictEqual(FIXTURE.entryCount, FIXTURE.entries.length + 1) // +1 为完成时后端写入的 summary review
})
