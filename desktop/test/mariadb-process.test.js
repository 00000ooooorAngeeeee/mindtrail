// MariaDB 生命周期关键逻辑单测（node:test，无 Electron 依赖，镜像 backend-process.test.js 思路）。
// 覆盖设计文档 §9 要求的：端口决策、datadir 路径计算、初始化决策（含半初始化清理）、就绪判定、shutdown 命令构造。
const { test } = require('node:test')
const assert = require('node:assert')
const path = require('node:path')
const {
  resolveDataDir,
  resolveBinDir,
  resolveExe,
  buildInitArgs,
  buildStartArgs,
  buildShutdownArgs,
  buildPingArgs,
  decideInit,
  decidePort,
  parseMysqladminPing,
  waitForReady,
  init,
  start,
  stop,
} = require('../main/mariadb-process')

test('resolveDataDir：%APPDATA%\\TrailMind\\db', () => {
  assert.strictEqual(resolveDataDir('C:\\Users\\x\\AppData\\Roaming'), path.join('C:\\Users\\x\\AppData\\Roaming', 'TrailMind', 'db'))
})

test('resolveBinDir / resolveExe：vendor\\mariadb\\bin + exe 名', () => {
  assert.strictEqual(resolveBinDir('D:\\t\\desktop\\vendor'), path.join('D:\\t\\desktop\\vendor', 'mariadb', 'bin'))
  assert.strictEqual(resolveExe('D:\\v\\bin', 'mariadbd.exe'), path.join('D:\\v\\bin', 'mariadbd.exe'))
})

test('buildInitArgs：仅 --datadir', () => {
  assert.deepStrictEqual(buildInitArgs('C:\\d\\db'), ['--datadir', 'C:\\d\\db'])
})

test('buildStartArgs：回环 + 固定端口 + datadir + 显式开启网络', () => {
  assert.deepStrictEqual(buildStartArgs({ dataDir: 'C:\\d\\db' }), [
    '--port', '13306', '--bind-address', '127.0.0.1', '--datadir', 'C:\\d\\db', '--skip-networking=off',
  ])
})

test('buildShutdownArgs / buildPingArgs：mysqladmin 命令构造（带 -u root）', () => {
  assert.deepStrictEqual(buildShutdownArgs(13306), ['-u', 'root', '--port', '13306', 'shutdown'])
  assert.deepStrictEqual(buildPingArgs(), ['-u', 'root', '--port', '13306', 'ping'])
})

test('decideInit：目录不存在 → 首次初始化', () => {
  assert.deepStrictEqual(decideInit(false, false), { action: 'init', reason: '数据目录不存在，首次初始化' })
})

test('decideInit：目录在但缺 mysql 系统库 → 半初始化清理重建', () => {
  const r = decideInit(true, false)
  assert.strictEqual(r.action, 'cleanup-and-init')
  assert.match(r.reason, /半初始化/)
})

test('decideInit：已初始化 → 跳过', () => {
  assert.deepStrictEqual(decideInit(true, true), { action: 'skip', reason: '数据目录已初始化' })
})

test('decidePort：空闲 → 启动；占用 → 报错（不静默换端口）', () => {
  assert.deepStrictEqual(decidePort(false), { action: 'start' })
  const r = decidePort(true)
  assert.strictEqual(r.action, 'error')
  assert.match(r.reason, /13306/)
})

test('parseMysqladminPing：识别 is alive', () => {
  assert.strictEqual(parseMysqladminPing('mysqld is alive'), true)
  assert.strictEqual(parseMysqladminPing('mysqladmin: connect failed'), false)
  assert.strictEqual(parseMysqladminPing(''), false)
})

test('waitForReady：就绪即返回 true 并按需重试', async () => {
  let calls = 0
  const check = async () => ++calls >= 3
  const ok = await waitForReady('127.0.0.1', 13306, { intervalMs: 1, timeoutMs: 200, check })
  assert.strictEqual(ok, true)
  assert.strictEqual(calls, 3)
})

test('waitForReady：超时返回 false', async () => {
  const ok = await waitForReady('127.0.0.1', 13306, { intervalMs: 1, timeoutMs: 10, check: async () => false })
  assert.strictEqual(ok, false)
})

test('init：已初始化 → 跳过且不跑 install-db', async () => {
  let ran = false
  const r = await init({ dataDir: 'C:\\d\\db', exists: () => true, runInstallDb: async () => { ran = true; return true }, installDbExe: 'C:\\v\\bin\\mariadb-install-db.exe' })
  assert.strictEqual(r.action, 'skip')
  assert.strictEqual(ran, false)
})

test('init：全新目录 → 跑 install-db 且传 --datadir', async () => {
  let args = null
  const r = await init({ dataDir: 'C:\\d\\db', exists: () => false, runInstallDb: async (exe, a) => { args = a; return true }, installDbExe: 'C:\\v\\bin\\mariadb-install-db.exe' })
  assert.strictEqual(r.action, 'init')
  assert.deepStrictEqual(args, ['--datadir', 'C:\\d\\db'])
})

test('init：半初始化 → 先清理目录再重建', async () => {
  let removed = null
  let ran = false
  const r = await init({
    dataDir: 'C:\\d\\db',
    exists: (p) => p !== path.join('C:\\d\\db', 'mysql'), // 数据目录在，mysql 系统库缺失
    remove: (dir) => { removed = dir },
    runInstallDb: async () => { ran = true; return true },
    installDbExe: 'C:\\v\\bin\\mariadb-install-db.exe',
  })
  assert.strictEqual(r.action, 'cleanup-and-init')
  assert.strictEqual(removed, 'C:\\d\\db')
  assert.strictEqual(ran, true)
})

test('init：install-db 失败抛错', async () => {
  await assert.rejects(
    () => init({ dataDir: 'C:\\d\\db', exists: () => false, runInstallDb: async () => false, installDbExe: 'x' }),
    /初始化失败/,
  )
})

test('start：端口被占 → 抛错且不 init、不 spawn', async () => {
  let inited = false
  let spawned = false
  await assert.rejects(
    () => start({ dataDir: 'C:\\d\\db', serverExe: 's', probe: async () => true, doInit: async () => { inited = true }, spawnServerFn: () => { spawned = true } }),
    /被占用/,
  )
  assert.strictEqual(inited, false)
  assert.strictEqual(spawned, false)
})

test('start：正常 → 依次 init → spawn（含启动参数）→ 就绪', async () => {
  const order = []
  let captured = null
  const r = await start({
    dataDir: 'C:\\d\\db',
    serverExe: 'C:\\v\\bin\\mariadbd.exe',
    probe: async () => false,
    doInit: async () => { order.push('init'); return { ok: true } },
    spawnServerFn: (exe, args) => { order.push('spawn'); captured = { exe, args }; return { pid: 1, exitCode: null } },
    wait: async () => { order.push('wait'); return true },
  })
  assert.deepStrictEqual(order, ['init', 'spawn', 'wait'])
  assert.strictEqual(captured.exe, 'C:\\v\\bin\\mariadbd.exe')
  assert.deepStrictEqual(captured.args, ['--port', '13306', '--bind-address', '127.0.0.1', '--datadir', 'C:\\d\\db', '--skip-networking=off'])
  assert.strictEqual(r.ready, true)
})

test('start：就绪超时 → ready=false', async () => {
  const r = await start({ dataDir: 'C:\\d\\db', serverExe: 's', probe: async () => false, doInit: async () => ({ ok: true }), spawnServerFn: () => ({ pid: 1, exitCode: null }), wait: async () => false })
  assert.strictEqual(r.ready, false)
})

test('stop：优雅关闭后进程退出 → 不兜底 kill', async () => {
  let killed = false
  await stop({ child: { pid: 1, exitCode: null }, adminExe: 'C:\\v\\bin\\mysqladmin.exe', execShutdown: async () => true, wait: async () => true, kill: async () => { killed = true } })
  assert.strictEqual(killed, false)
})

test('stop：超时未退出 → taskkill 兜底', async () => {
  let killed = null
  await stop({ child: { pid: 4242, exitCode: null }, adminExe: 'C:\\v\\bin\\mysqladmin.exe', execShutdown: async () => true, wait: async () => false, kill: async (pid) => { killed = pid } })
  assert.strictEqual(killed, 4242)
})

test('stop：无 child 直接返回不抛错', async () => {
  await stop(null)
  await stop({})
})
