// 进程工具关键逻辑单测（node:test）。
import { test } from 'node:test'
import assert from 'node:assert'
import path from 'node:path'
import { ROOT, buildTaskkillArgs, isAlive, isLoopback, readTextSafe } from '../lib/proc.mjs'

test('buildTaskkillArgs：/T 连带子树 + /F 强制', () => {
  assert.deepStrictEqual(buildTaskkillArgs(4242), ['/PID', '4242', '/T', '/F'])
})

test('isLoopback：回环地址判定（含 IPv6 与 v4-mapped）', () => {
  for (const a of ['127.0.0.1', '127.1.2.3', 'localhost', 'LOCALHOST', '::1', '[::1]', '::ffff:127.0.0.1']) {
    assert.strictEqual(isLoopback(a), true, `${a} 应判定为回环`)
  }
  for (const a of ['0.0.0.0', '10.0.0.1', '8.8.8.8', '192.168.1.1', '::ffff:8.8.8.8', '', undefined]) {
    assert.strictEqual(isLoopback(a), false, `${String(a)} 不应判定为回环`)
  }
})

test('isAlive：当前进程存活、无效 pid 为 false', () => {
  assert.strictEqual(isAlive(process.pid), true)
  assert.strictEqual(isAlive(0), false)
  assert.strictEqual(isAlive(undefined), false)
  // 极端 pid 在 Windows 上不存在
  assert.strictEqual(isAlive(999999), false)
})

test('ROOT 指向仓库根（含 package.json）', () => {
  assert.strictEqual(path.basename(ROOT), 'mindtrail')
  assert.match(readTextSafe(path.join(ROOT, 'package.json')), /"name": "trailmind"/)
})

test('readTextSafe：文件不存在返回空串', () => {
  assert.strictEqual(readTextSafe(path.join(ROOT, 'no-such-file-xyz.txt')), '')
})
