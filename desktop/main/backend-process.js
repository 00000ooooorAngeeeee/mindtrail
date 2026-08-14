// 后端进程生命周期管理（Electron 主进程调用）。
// 职责：探测端口占用 → 决策启动方式 → 拉起 java -jar → 健康等待 → 优雅关闭 + 强杀兜底。
// 本模块仅依赖 Node 内建 API，不依赖 Electron，因此可被 node:test 直接单测。

const net = require('net')
const http = require('http')
const path = require('path')
const { spawn, execFile } = require('child_process')

const DEFAULT_PORT = 17860

// 判断命令行是否属于本应用（残留进程判定依据：jar 名/路径含 trailmind）
function isTrailMindProcess(cmdline) {
  return /trailmind/i.test(cmdline || '')
}

// 纯决策函数（单测重点）：根据端口占用与占用者命令行，决定启动动作。
// 返回 { action: 'spawn' | 'kill-and-spawn' | 'error', reason? }
function decideStart(portInUse, ownerCmdline) {
  if (!portInUse) return { action: 'spawn' }
  if (isTrailMindProcess(ownerCmdline)) return { action: 'kill-and-spawn' }
  return { action: 'error', reason: `端口 ${DEFAULT_PORT} 被其他程序占用，无法启动后端` }
}

// TCP 探测端口是否被占用（127.0.0.1）
function probePort(port) {
  return new Promise((resolve) => {
    const socket = net.connect({ port, host: '127.0.0.1' })
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

// 按端口查占用 PID（Windows netstat -ano，仅 LISTENING 状态）
function findPidByPort(port) {
  return new Promise((resolve) => {
    execFile('netstat', ['-ano'], { windowsHide: true }, (err, stdout) => {
      if (err) return resolve(null)
      const re = new RegExp(`^\\s*TCP\\s+\\S+:(\\d+)\\s+\\S+\\s+LISTENING\\s+(\\d+)`)
      for (const line of (stdout || '').split(/\r?\n/)) {
        const m = line.match(re)
        if (m && Number(m[1]) === port) return resolve(Number(m[2]))
      }
      resolve(null)
    })
  })
}

// 按 PID 查命令行（Windows：优先 PowerShell，wmic 在 Win11 已弃用）
function queryCmdlineByPid(pid) {
  return new Promise((resolve) => {
    execFile(
      'powershell',
      ['-NoProfile', '-Command', `(Get-CimInstance Win32_Process -Filter 'ProcessId=${pid}').CommandLine`],
      { windowsHide: true },
      (err, stdout) => {
        resolve(err ? '' : (stdout || '').trim())
      },
    )
  })
}

// 组合探测：端口是否占用 + 占用者 PID 与命令行
async function queryPortOwner(port) {
  const inUse = await probePort(port)
  if (!inUse) return { inUse: false, pid: null, cmdline: '' }
  const pid = await findPidByPort(port)
  const cmdline = pid ? await queryCmdlineByPid(pid) : ''
  return { inUse: true, pid, cmdline }
}

// 健康检查：GET /health 返回 200 即视为就绪
function getHealth(url) {
  return new Promise((resolve) => {
    const req = http.get(url, (res) => {
      res.resume()
      resolve(res.statusCode === 200)
    })
    req.on('error', () => resolve(false))
    req.setTimeout(1000, () => {
      req.destroy()
      resolve(false)
    })
  })
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

// 健康等待：轮询直到就绪或超时（默认 500ms 间隔、10s 上限）
async function waitForHealth(url, opts = {}) {
  const { intervalMs = 500, timeoutMs = 10000, check = getHealth } = opts
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await check(url)) return true
    await sleep(intervalMs)
  }
  return false
}

// 杀死进程及其子进程树（Windows taskkill，必须带 /T 杀派生 java 进程）
function killProcessTree(pid) {
  return new Promise((resolve) => {
    if (!pid) return resolve()
    execFile('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true }, () => resolve())
  })
}

// 拉起 java -jar（优先用 JAVA_HOME 拼接，避免 spawn('java') 找不到）
function spawnJavaProcess(jarPath) {
  const javaBin = process.env.JAVA_HOME ? path.join(process.env.JAVA_HOME, 'bin', 'java') : 'java'
  return spawn(javaBin, ['-jar', jarPath], { stdio: 'ignore', windowsHide: true })
}

// 优雅关闭：POST /shutdown（best-effort，不抛错）
function postShutdown(port) {
  return new Promise((resolve) => {
    const req = http.request(
      { host: '127.0.0.1', port, path: '/api/v1/shutdown', method: 'POST', timeout: 2000 },
      (res) => {
        res.resume()
        resolve()
      },
    )
    req.on('error', () => resolve())
    req.on('timeout', () => {
      req.destroy()
      resolve()
    })
    req.end()
  })
}

// 等待子进程退出（timeoutMs 内退出返回 true，否则 false）
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

// 启动后端：探测 → 决策 → 拉起 → 健康等待。
// config 的 queryOwner/kill/spawnJava/check 可注入，便于单测；默认走真实实现。
async function start(config) {
  const {
    jarPath,
    port = DEFAULT_PORT,
    queryOwner = queryPortOwner,
    kill = killProcessTree,
    spawnJava = spawnJavaProcess,
    check = getHealth,
    healthUrl = null,
  } = config

  const owner = await queryOwner(port)
  const decision = decideStart(owner.inUse, owner.cmdline)

  if (decision.action === 'error') {
    throw new Error(decision.reason)
  }
  if (decision.action === 'kill-and-spawn') {
    await kill(owner.pid)
  }
  const child = spawnJava(jarPath)
  const healthy = await waitForHealth(healthUrl || `http://127.0.0.1:${port}/api/v1/health`, { check })
  return { child, healthy }
}

// 关闭后端：优雅 shutdown → 等待 3s 退出 → 超时 taskkill 强杀兜底。
async function stop(backend) {
  if (!backend || !backend.child) return
  await postShutdown(backend.port || DEFAULT_PORT)
  const exited = await waitForExit(backend.child, 3000)
  if (!exited) {
    await killProcessTree(backend.child.pid)
  }
}

module.exports = {
  DEFAULT_PORT,
  isTrailMindProcess,
  decideStart,
  probePort,
  findPidByPort,
  queryCmdlineByPid,
  queryPortOwner,
  getHealth,
  waitForHealth,
  killProcessTree,
  spawnJavaProcess,
  postShutdown,
  waitForExit,
  start,
  stop,
}
