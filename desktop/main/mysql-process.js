// 便携 MySQL 生命周期管理（specs 自包含打包 Phase 2 / 设计文档 §4.3、§6、§8；2026-08-24 由 MariaDB 改绑 MySQL）。
// 职责：路径/状态计算 → 首运行初始化（mysqld --initialize-insecure）→ 拉起 mysqld（仅回环 13306）→ 就绪等待 → 优雅关闭（mysqladmin shutdown）+ 强杀兜底。
// 本模块仅依赖 Node 内建 API，不依赖 Electron，因此可被 node:test 直接单测（镜像 backend-process.js 思路）。
// 说明：
//   - 改绑 MySQL 的原因：MariaDB 不支持 MySQL 的 `WITH PARSER ngram` 全文解析器，schema.sql/搜索会建表失败（设计文档 §10）。
//   - 本库为 Go 壳 `desktop/wails/internal/orchestrator/mysql.go` 的可执行规格，两者命令/路径/状态机必须一致。
//   - 真实 MySQL zip 的下载/解压属 Phase 4 打包脚本（§4.6），本库按约定假设 vendor 目录已就位。
const fs = require('fs')
const net = require('net')
const path = require('path')
const { spawn, execFile } = require('child_process')

const DEFAULT_PORT = 13306
const DEFAULT_BIND_ADDRESS = '127.0.0.1'
const APP_DIR = 'TrailMind'
const DB_DIR = 'db'
const PORTABLE_DIR = 'mysql'
const EXE = {
  server: 'mysqld.exe', // 服务进程
  initDb: 'mysqld.exe', // 首运行初始化数据目录（--initialize-insecure）
  admin: 'mysqladmin.exe', // ping / shutdown 管理命令
}

// —— 路径纯函数 ——

// 数据目录：%APPDATA%\TrailMind\db（首运行初始化与运行期数据均在此；设计 §3/§4.3）。
function resolveDataDir(appDataRoot = process.env.APPDATA) {
  return path.join(appDataRoot, APP_DIR, DB_DIR)
}

// 便携 MySQL bin 目录：<vendor>/mysql/bin（Phase 4 打包脚本下载解压到此处，gitignore）。
function resolveBinDir(vendorDir) {
  return path.join(vendorDir, PORTABLE_DIR, 'bin')
}

// 取具体 exe 绝对路径（name 见 EXE 常量）。
function resolveExe(binDir, name) {
  return path.join(binDir, name)
}

// —— 命令构造纯函数 ——

// mysqld 初始化参数：建系统表 + root 空密码；--basedir 强制用便携目录的 share，避免误读机器上已装的 MySQL；
// --mysqlx=OFF 不额外开 X Protocol 端口（33060）。
function buildInitArgs(dataDir, portableDir) {
  return ['--initialize-insecure', `--basedir=${portableDir}`, `--datadir=${dataDir}`, '--mysqlx=OFF', '--skip-networking=off']
}

// mysqld 启动参数：固定端口 + 仅回环监听 + 显式开启 TCP（设计 §4.3）。
function buildStartArgs({ port = DEFAULT_PORT, bindAddress = DEFAULT_BIND_ADDRESS, dataDir } = {}) {
  return ['--port', String(port), '--bind-address', bindAddress, '--datadir', dataDir, '--skip-networking=off', '--mysqlx=OFF']
}

// mysqladmin shutdown 优雅关闭参数（-u root：否则 mysqladmin 用当前 OS 用户名，root 无密码场景会 Access denied）。
function buildShutdownArgs(port = DEFAULT_PORT) {
  return ['-u', 'root', '--port', String(port), 'shutdown']
}

// mysqladmin ping 就绪探测参数（同上 -u root）。
function buildPingArgs(port = DEFAULT_PORT) {
  return ['-u', 'root', '--port', String(port), 'ping']
}

// —— 决策纯函数 ——

// 初始化决策：数据目录是否存在 × mysql 系统库是否已建（= 初始化完成标记，mysqld --initialize-insecure 会建 datadir/mysql）。
// 半初始化（目录在但缺 mysql 库，如首运行中断）→ 清理重建（设计 §8）。
function decideInit(dataDirExists, mysqlDirExists) {
  if (!dataDirExists) return { action: 'init', reason: '数据目录不存在，首次初始化' }
  if (!mysqlDirExists) return { action: 'cleanup-and-init', reason: '检测到半初始化数据目录（缺 mysql 系统库），清理后重建' }
  return { action: 'skip', reason: '数据目录已初始化' }
}

// 端口决策：13306 被占则报错（设计 §8：不静默换端口、避免多实例；崩溃残留由壳 defer 兜底清理）。
function decidePort(portInUse) {
  if (portInUse) return { action: 'error', reason: `端口 ${DEFAULT_PORT} 被占用，请先关闭占用程序` }
  return { action: 'start' }
}

// 解析 mysqladmin ping 输出（'mysqld is alive' 视为就绪）。
function parseMysqladminPing(stdout) {
  return /mysqld is alive/i.test(stdout || '')
}

// —— 运行期辅助（均可被编排注入，便于单测）——

function probeTcp(port, host = DEFAULT_BIND_ADDRESS) {
  return new Promise((resolve) => {
    const socket = net.connect({ port, host })
    let settled = false
    socket.once('connect', () => {
      settled = true
      socket.destroy()
      resolve(true)
    })
    socket.once('error', () => {
      if (!settled) resolve(false)
    })
    socket.setTimeout(500, () => {
      if (!settled) {
        settled = true
        socket.destroy()
        resolve(false)
      }
    })
  })
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

// 就绪等待：轮询直到就绪或超时（默认 500ms 间隔、60s 上限——--initialize-insecure 首运行建系统表较慢）。
async function waitForReady(host, port, opts = {}) {
  const { intervalMs = 500, timeoutMs = 60000, check } = opts
  const doCheck = check || (() => probeTcp(port, host))
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await doCheck()) return true
    await sleep(intervalMs)
  }
  return false
}

// 执行一次性命令（初始化 / mysqladmin），返回是否成功。
function execFileP(exe, args) {
  return new Promise((resolve) => {
    execFile(exe, args, { windowsHide: true }, (err) => resolve(!err))
  })
}

// 拉起 mysqld 常驻进程。
function spawnServer(exe, args) {
  return spawn(exe, args, { stdio: 'ignore', windowsHide: true })
}

// 杀死进程及其子进程树（Windows taskkill，兜底用）。
function killProcessTree(pid) {
  return new Promise((resolve) => {
    if (!pid) return resolve()
    execFile('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true }, () => resolve())
  })
}

// 等待子进程退出（timeoutMs 内退出返回 true，否则 false）。
function waitForExit(child, timeoutMs) {
  return new Promise((resolve) => {
    if (!child || child.exitCode !== null || child.signalCode !== null) return resolve(true)
    const timer = setTimeout(() => resolve(false), timeoutMs)
    child.once('exit', () => {
      clearTimeout(timer)
      resolve(true)
    })
  })
}

// —— 编排（关键动作可注入，便于单测）——

// 初始化：按 decideInit 决策，必要时清理半初始化目录后跑 mysqld --initialize-insecure。
async function init(config) {
  const {
    dataDir,
    portableDir,
    exists = fs.existsSync,
    remove = fs.rmSync,
    runInit = execFileP,
    initExe,
  } = config
  const decision = decideInit(exists(dataDir), exists(path.join(dataDir, 'mysql')))
  if (decision.action === 'skip') return { action: 'skip', ok: true }
  if (decision.action === 'cleanup-and-init') remove(dataDir, { recursive: true, force: true })
  const ok = await runInit(initExe, buildInitArgs(dataDir, portableDir))
  if (!ok) throw new Error('mysqld --initialize-insecure 初始化失败（权限或磁盘），见日志 %APPDATA%\\TrailMind\\logs')
  return { action: decision.action, ok: true }
}

// 启动：端口决策 → 初始化 → 拉起 mysqld → 就绪等待。
async function start(config) {
  const {
    dataDir,
    port = DEFAULT_PORT,
    bindAddress = DEFAULT_BIND_ADDRESS,
    probe = () => probeTcp(port),
    doInit = init,
    spawnServerFn = spawnServer,
    wait = waitForReady,
    serverExe,
  } = config

  const decision = decidePort(await probe())
  if (decision.action === 'error') throw new Error(decision.reason)

  await doInit({ ...config, dataDir })

  const child = spawnServerFn(serverExe, buildStartArgs({ port, bindAddress, dataDir }))
  const ready = await wait(bindAddress, port, config)
  return { child, ready }
}

// 关闭：mysqladmin shutdown 优雅关闭 → 等待退出 → taskkill 强杀兜底。
async function stop(mysql) {
  if (!mysql || !mysql.child) return
  const {
    child,
    port = DEFAULT_PORT,
    adminExe,
    execShutdown = execFileP,
    wait = waitForExit,
    kill = killProcessTree,
  } = mysql
  await execShutdown(adminExe, buildShutdownArgs(port))
  const exited = await wait(child, 3000)
  if (!exited) await kill(child.pid)
}

module.exports = {
  DEFAULT_PORT,
  DEFAULT_BIND_ADDRESS,
  APP_DIR,
  DB_DIR,
  PORTABLE_DIR,
  EXE,
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
  probeTcp,
  waitForReady,
  execFileP,
  spawnServer,
  killProcessTree,
  waitForExit,
  init,
  start,
  stop,
}
