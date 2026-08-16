// M4 任务七 性能回归脚本纯函数单测（node:test，无第三方依赖）。
// 覆盖帧率计算与结果汇总（docs/08 §6 DoD「关键逻辑补单测」）。
import { test } from 'node:test'
import assert from 'node:assert'
import { BUDGET, fpsOf, summarizePerf } from '../perf-regression.mjs'

test('BUDGET：04 §8 预算值正确（画布 45fps / 增删改 100ms / 时间线首屏 500ms）', () => {
  assert.strictEqual(BUDGET.canvasZoomFps, 45)
  assert.strictEqual(BUDGET.editResponseMs, 100)
  assert.strictEqual(BUDGET.timelineFirstScreenMs, 500)
})

test('fpsOf：由 rAF 样本计算帧率', () => {
  assert.strictEqual(fpsOf({ frames: 60, dtMs: 1000 }), 60)
  assert.strictEqual(fpsOf({ frames: 45, dtMs: 1000 }), 45)
  assert.ok(Math.abs(fpsOf({ frames: 113, dtMs: 2500 }) - 45.2) < 0.01)
})

test('fpsOf：非法样本返回 0（不抛异常）', () => {
  assert.strictEqual(fpsOf({ frames: 0, dtMs: 0 }), 0)
  assert.strictEqual(fpsOf({ frames: 10, dtMs: -1 }), 0)
  assert.strictEqual(fpsOf({}), 0)
})

test('summarizePerf：全部通过输出 ALL PASS', () => {
  const r = summarizePerf([
    { name: 'a', ok: true },
    { name: 'b', ok: true },
  ])
  assert.strictEqual(r.pass, true)
  assert.match(r.message, /PERF-REGRESSION: ALL PASS/)
})

test('summarizePerf：存在失败输出 FAILED 并带错误信息', () => {
  const r = summarizePerf([
    { name: 'a', ok: true },
    { name: 'b', ok: false, error: '超预算 20ms' },
  ])
  assert.strictEqual(r.pass, false)
  assert.match(r.message, /PERF-REGRESSION: FAILED/)
  assert.match(r.message, /超预算 20ms/)
})
