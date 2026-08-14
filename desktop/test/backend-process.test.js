// 后端进程管理关键逻辑单测（node:test，无 Electron 依赖）。
// 重点覆盖 docs/10 §9 要求的「端口被本应用残留占用」分支。
const { test } = require('node:test')
const assert = require('node:assert')
const {
  isTrailMindProcess,
  decideStart,
  waitForHealth,
  start,
} = require('../main/backend-process')

test('isTrailMindProcess：命令行含 trailmind 判定为本应用', () => {
  assert.strictEqual(isTrailMindProcess('java -jar trailmind-backend-0.0.1.jar'), true)
  assert.strictEqual(isTrailMindProcess('C:\\java\\bin\\java -jar D:\\trailmind.jar'), true)
  assert.strictEqual(isTrailMindProcess('nginx.exe'), false)
  assert.strictEqual(isTrailMindProcess(''), false)
  assert.strictEqual(isTrailMindProcess(null), false)
})

test('decideStart：端口空闲 → 直接拉起', () => {
  assert.deepStrictEqual(decideStart(false, ''), { action: 'spawn' })
})

test('decideStart：端口被本应用残留占用 → 先杀再起', () => {
  const r = decideStart(true, 'java -jar trailmind-backend-0.0.1.jar')
  assert.deepStrictEqual(r, { action: 'kill-and-spawn' })
})

test('decideStart：端口被其他程序占用 → 报错不启动', () => {
  const r = decideStart(true, 'nginx.exe')
  assert.strictEqual(r.action, 'error')
  assert.match(r.reason, /被其他程序占用/)
})

test('waitForHealth：就绪即返回 true，并按需重试', async () => {
  let calls = 0
  const check = async () => ++calls >= 3
  const ok = await waitForHealth('http://x', { intervalMs: 1, timeoutMs: 200, check })
  assert.strictEqual(ok, true)
  assert.strictEqual(calls, 3)
})

test('waitForHealth：超时返回 false', async () => {
  const ok = await waitForHealth('http://x', { intervalMs: 1, timeoutMs: 10, check: async () => false })
  assert.strictEqual(ok, false)
})

test('start：端口被本应用残留占用 → 先 taskkill 再 spawn', async () => {
  const killed = []
  const spawned = []
  const child = { pid: 4242, exitCode: null }
  const result = await start({
    jarPath: '/x/y.jar',
    queryOwner: async () => ({ inUse: true, pid: 4242, cmdline: 'java -jar trailmind-backend-0.0.1.jar' }),
    kill: async (pid) => killed.push(pid),
    spawnJava: (jar) => {
      spawned.push(jar)
      return child
    },
    check: async () => true,
  })
  assert.deepStrictEqual(killed, [4242])
  assert.deepStrictEqual(spawned, ['/x/y.jar'])
  assert.strictEqual(result.child, child)
  assert.strictEqual(result.healthy, true)
})

test('start：端口空闲 → 直接 spawn 不 kill', async () => {
  let killed = false
  let spawned = false
  await start({
    jarPath: '/x/y.jar',
    queryOwner: async () => ({ inUse: false, pid: null, cmdline: '' }),
    kill: async () => {
      killed = true
    },
    spawnJava: () => {
      spawned = true
      return { pid: 1, exitCode: null }
    },
    check: async () => true,
  })
  assert.strictEqual(killed, false)
  assert.strictEqual(spawned, true)
})

test('start：端口被其他程序占用 → 抛错且不 spawn', async () => {
  let spawned = false
  await assert.rejects(
    () =>
      start({
        jarPath: '/x/y.jar',
        queryOwner: async () => ({ inUse: true, pid: 999, cmdline: 'nginx.exe' }),
        kill: async () => {},
        spawnJava: () => {
          spawned = true
        },
        check: async () => true,
      }),
    /被其他程序占用/,
  )
  assert.strictEqual(spawned, false)
})
