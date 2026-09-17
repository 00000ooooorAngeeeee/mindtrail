// S2 端到端自包含验证（壳编排等价流程，用本机 MySQL 8.0.45 夹具替代官方 8.4 zip）。
// 步骤：mysqld --initialize-insecure → 起 mysqld(13306) → mysqladmin ping 就绪 →
//       起 release/trailmind-backend/trailmind-backend.exe（注入 DB env）→ /api/v1/health →
//       schema 9 表 + entry 含 FULLTEXT ngram → 建工作区/导图 → 中文 FULLTEXT 搜索命中 →
//       起 WebView2 壳窗口（可选）→ 反序关闭并确认无残留进程。
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, openSync, closeSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'

const FIX = 'E:\\DeepseekHarness\\.mysql-fixture'
const MYSQL_DIR = path.join(FIX, 'mysql-8.0.45-winx64')
const BIN = path.join(MYSQL_DIR, 'bin')
const MYSQLD = path.join(BIN, 'mysqld.exe')
const MYSQLADMIN = path.join(BIN, 'mysqladmin.exe')
const MYSQL_CLI = path.join(BIN, 'mysql.exe')
const APP_DIR = 'E:\\DeepseekHarness\\mindtrail\\release'
const BACKEND_EXE = path.join(APP_DIR, 'trailmind-backend', 'trailmind-backend.exe')
const APPDATA_ROOT = process.env.E2E_APPDATA_ROOT || 'E:\\DeepseekHarness\\.e2e-appdata'
const DATA_DIR = path.join(APPDATA_ROOT, 'TrailMind', 'db')
const LOG_DIR = process.env.E2E_LOG_DIR || 'E:\\DeepseekHarness\\.e2e-logs'
const DB_PORT = Number(process.env.E2E_DB_PORT || 13306)
const BE_PORT = 17860

const log = (...a) => console.log(`[e2e]`, ...a)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function runCapture(exe, args) {
  // 沙箱/受限环境下 async spawn + pipe 会 EPERM；spawnSync + fd 重定向可用，故用临时文件捕获输出。
  const tmp = path.join(LOG_DIR, `cap-${process.pid}-${Date.now()}.txt`)
  mkdirSync(LOG_DIR, { recursive: true })
  writeFileSync(tmp, '')
  const fd = openSync(tmp, 'a')
  let r
  try {
    r = spawnSync(exe, args, { stdio: ['ignore', fd, fd], windowsHide: true })
  } finally {
    closeSync(fd)
  }
  let out = ''
  try {
    out = readFileSync(tmp, 'utf8')
  } catch {}
  return { status: r.status, error: r.error?.code, out }
}

function runQuiet(exe, args, opts = {}) {
  const r = runCapture(exe, args)
  return { status: r.status, stdout: r.out, stderr: '' }
}

function startDetached(exe, args, env, tag) {
  // 注意：stdio 必须用 'ignore'（而非把父进程打开的 fd 传进去）——父进程 close 后子进程句柄会失效，
  // 导致服务进程虽在跑但行为异常。日志由被拉起的进程自己写（mysqld 写 datadir/*.err，后端可加 --logging.file）。
  const child = spawn(exe, args, {
    stdio: 'ignore',
    windowsHide: true,
    detached: false,
    env: { ...process.env, ...(env || {}) },
  })
  child.tag = tag
  return child
}

function alive(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return false
  try {
    process.kill(child.pid, 0)
    return true
  } catch {
    return false
  }
}

async function tcpOk(port) {
  const net = await import('node:net')
  return new Promise((resolve) => {
    const s = net.connect({ port, host: '127.0.0.1' })
    const done = (v) => { try { s.destroy() } catch {} resolve(v) }
    s.once('connect', () => done(true))
    s.once('error', () => done(false))
    s.setTimeout(500, () => done(false))
  })
}

async function dbReady() {
  const r = runQuiet(MYSQLADMIN, ['-u', 'root', '--port', String(DB_PORT), 'ping'])
  const text = `${r.stdout ?? ''}`
  pingLog.push(`status=${r.status} out=${JSON.stringify(text.trim()).slice(0, 120)}`)
  return /mysqld is alive/i.test(text)
}
const pingLog = []

async function waitFor(check, timeoutMs, label, aliveCheck) {
  const t0 = Date.now()
  while (Date.now() - t0 < timeoutMs) {
    if (await check()) return true
    if (aliveCheck && !aliveCheck()) throw new Error(`${label} 失败：进程已退出`)
    await sleep(500)
  }
  throw new Error(`${label} 超时（${timeoutMs}ms）`)
}

async function httpGet(url) {
  const res = await fetch(url)
  const text = await res.text()
  return { status: res.status, text }
}

const procs = []
const results = []

try {
  rmSync(LOG_DIR, { recursive: true, force: true })
  mkdirSync(LOG_DIR, { recursive: true })
  log('日志目录', LOG_DIR)

  // 1) 初始化数据目录（等价壳 DecideInit：全新目录 → init）
  rmSync(DATA_DIR, { recursive: true, force: true })
  mkdirSync(path.dirname(DATA_DIR), { recursive: true })
  log('mysqld --initialize-insecure →', DATA_DIR)
  let t0 = Date.now()
  const init = runQuiet(MYSQLD, ['--initialize-insecure', `--basedir=${MYSQL_DIR}`, `--datadir=${DATA_DIR}`, '--mysqlx=OFF', '--skip-networking=off'])
  const initMs = Date.now() - t0
  if (init.status !== 0) throw new Error(`初始化失败 status=${init.status} ${init.stderr ?? ''}`)
  if (!existsSync(path.join(DATA_DIR, 'mysql'))) throw new Error('初始化后缺 datadir/mysql 系统库')
  results.push(['① mysqld --initialize-insecure（首运行建系统表）', 'PASS', `${initMs}ms`])

  // 2) 起 mysqld
  log('启动 mysqld 13306 …')
  const db = startDetached(MYSQLD, ['--port', String(DB_PORT), '--bind-address', '127.0.0.1', '--datadir', DATA_DIR, '--skip-networking=off', '--mysqlx=OFF'], null, 'mysqld')
  procs.push({ name: 'mysqld', child: db })
  t0 = Date.now()
  await waitFor(dbReady, 60000, 'mysqld 就绪（mysqladmin ping）', () => alive(db))
  results.push(['② mysqld 以 13306 启动并就绪（ping 判定）', 'PASS', `${Date.now() - t0}ms`])

  // 3) 起后端 app-image（注入 DB env，等价壳 BuildBackendEnv）
  log('启动 trailmind-backend.exe …')
  const backend = startDetached(BACKEND_EXE, [], { DB_HOST: '127.0.0.1', DB_PORT: String(DB_PORT), DB_USER: 'root', DB_PASS: '' }, 'backend')
  procs.push({ name: 'backend', child: backend })
  t0 = Date.now()
  await waitFor(async () => {
    try {
      const r = await httpGet(`http://127.0.0.1:${BE_PORT}/api/v1/health`)
      return r.status === 200
    } catch {
      return false
    }
  }, 90000, '后端 /api/v1/health', () => alive(backend))
  results.push(['③ 后端 app-image 启动（bundled JRE）+ /api/v1/health 200', 'PASS', `${Date.now() - t0}ms`])

  // 4) 同源服务前端（打包态 /api 根因验证）
  const root = await httpGet(`http://127.0.0.1:${BE_PORT}/`)
  if (root.status !== 200 || !/<\/html>/i.test(root.text)) throw new Error(`根路径未返回 SPA：${root.status}`)
  results.push(['④ 后端同源服务前端（/ → index.html，壳加载 17860 即得完整 UI）', 'PASS', `${root.text.length}B`])
  const health = JSON.parse((await httpGet(`http://127.0.0.1:${BE_PORT}/api/v1/health`)).text)
  results.push(['   后端版本号', 'INFO', JSON.stringify(health.data ?? health)])

  // 5) schema 幂等建表 + ngram 全文索引（原 MariaDB 阻塞点）
  const q = (sql) => {
    const r = runQuiet(MYSQL_CLI, ['-u', 'root', '--port', String(DB_PORT), '--default-character-set=utf8mb4', '-N', '-B', '-e', sql])
    return `${r.stdout ?? ''}`.trim()
  }
  const tables = q("SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='trailmind'")
  if (Number(tables) !== 9) throw new Error(`trailmind 库表数 = ${tables}，期望 9`)
  results.push(['⑤ 幂等建表 9 张（backend 启动自动执行 schema.sql）', 'PASS', `${tables} 表`])
  const ddl = q("SELECT IF(COUNT(*)>0,'yes','no') FROM information_schema.statistics WHERE table_schema='trailmind' AND index_type='FULLTEXT'")
  if (ddl !== 'yes') throw new Error('未找到 FULLTEXT 索引')
  const ngram = q("SHOW CREATE TABLE trailmind.entry")
  if (!/WITH PARSER `?ngram`?/i.test(ngram)) throw new Error('entry 未使用 ngram 解析器')
  results.push(['⑥ FULLTEXT ... WITH PARSER ngram 建索引成功（MariaDB 阻塞点解除）', 'PASS', 'entry/mindmap'])

  // 6) 中文 FULLTEXT 往返：建工作区/导图 → MATCH AGAINST 命中
  const api = async (method, url, body) => {
    const res = await fetch(`http://127.0.0.1:${BE_PORT}${url}`, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    })
    const json = await res.json()
    if (json.code !== 0) throw new Error(`${method} ${url} → code=${json.code} ${json.message}`)
    return json.data
  }
  const ws = await api('POST', '/api/v1/workspaces', { name: 'S2 端到端验证工作区', description: 'Wails 自包含验证' })
  const mm = await api('POST', `/api/v1/workspaces/${ws.id}/mindmaps`, { name: '便携库验证导图' })
  // 契约（05 §4）：content_json 的 nodes 是「以节点 id 为键的对象」，不是数组；
  // search_text = name + 各节点 text/note/tags + 边 label，node_count = 节点数。
  await api('PUT', `/api/v1/mindmaps/${mm.id}`, {
    contentJson: JSON.stringify({
      version: 1,
      rootNodeId: 'n1',
      nodes: {
        n1: { id: 'n1', text: '端到端自包含验证节点', note: '', style: { color: 'default', bold: false, shape: 'rounded' }, tags: [], parentId: null, layout: null, collapsed: false },
      },
      edges: [],
    }),
  })
  const saved = await api('GET', `/api/v1/mindmaps/${mm.id}`)
  if (Number(saved.nodeCount) !== 1) throw new Error(`node_count 未按契约维护：${saved.nodeCount}`)
  if (!String(saved.searchText ?? '').includes('端到端自包含')) throw new Error(`search_text 未含节点文本：${saved.searchText}`)
  results.push(['⑥.5 保存后 search_text/node_count 按 05 §4 维护', 'PASS', `node_count=${saved.nodeCount}`])
  const found = await api('GET', `/api/v1/search?q=${encodeURIComponent('端到端自包含')}&workspaceId=${ws.id}`)
  const hit = (found.mindmaps ?? [])[0]
  if (!hit) throw new Error(`中文 FULLTEXT 搜索未命中：${JSON.stringify(found).slice(0, 300)}`)
  if (!String(hit.snippet ?? '').includes('端到端自包含')) throw new Error(`命中片段不含关键词：${hit.snippet}`)
  if (hit.nodeId !== 'n1') throw new Error(`未返回命中节点定位字段 nodeId：${JSON.stringify(hit)}`)
  results.push(['⑦ 中文全文搜索 MATCH…ngram 命中（真实写入 → 查询往返，含片段与节点定位）', 'PASS', `snippet=${hit.snippet}`])

  // 7) 壳窗口（WebView2）——用既有 wails 壳 exe 验证「非 CMD、非浏览器」
  const SHELL = path.join(APP_DIR, 'trailmind-shell.exe')
  if (existsSync(SHELL)) {
    results.push(['⑧ Wails 壳 exe 存在（窗口验证需交互，见人工步骤）', 'INFO', SHELL])
  }
} catch (e) {
  results.push(['ERROR', 'FAIL', e.message])
  console.error('[e2e] 失败：', e.message)
  if (pingLog.length) console.error('[e2e] ping 诊断（前 5 / 共 ' + pingLog.length + '）：', pingLog.slice(0, 5).join(' | '))
} finally {
  // 反序清理（等价壳 StopBackend → StopDatabase）
  const backend = procs.find((p) => p.name === 'backend')
  if (backend) {
    try {
      await fetch(`http://127.0.0.1:${BE_PORT}/api/v1/shutdown`, { method: 'POST' })
    } catch {}
    await sleep(2000)
    try { process.kill(backend.child.pid) } catch {}
  }
  const db = procs.find((p) => p.name === 'mysqld')
  if (db) {
    runQuiet(MYSQLADMIN, ['-u', 'root', '--port', String(DB_PORT), 'shutdown'])
    await sleep(2500)
    try { process.kill(db.child.pid) } catch {}
  }
  await sleep(1500)
  // 残留检查：先按 PID 探活（tasklist 在受限沙箱下会 Access denied，不能作为判据）。
  const mysqldLeft = alive(db)
  const backendLeft = alive(backend)
  results.push(['⑨ 关窗/退出后无残留 mysqld.exe', mysqldLeft ? 'FAIL' : 'PASS', mysqldLeft ? `pid ${db?.pid} 仍存活` : '0 残留'])
  results.push(['⑩ 退出后无残留 trailmind-backend.exe', backendLeft ? 'FAIL' : 'PASS', backendLeft ? `pid ${backend?.pid} 仍存活` : '0 残留'])

  console.log('\n================ S2 E2E 结果 ================')
  let fail = 0
  for (const [what, verdict, detail] of results) {
    if (verdict === 'FAIL') fail++
    console.log(`${verdict === 'PASS' ? '✓' : verdict === 'INFO' ? '·' : '✗'} ${what}${detail ? ' ｜ ' + detail : ''}`)
  }
  console.log(`\nS2 E2E: ${fail === 0 ? 'ALL PASS' : `${fail} FAIL`}（${results.filter((r) => r[1] === 'PASS').length} 项通过）`)
}
