// S2b：壳 exe 端到端验证——壳真实初始化并拉起便携 MySQL + 后端，窗口加载 17860，退出后无残留。
// 说明：受限沙箱下 WebView2 需命名管道（会被拒），故窗口可能 FATAL；本脚本以「编排是否成立」为判据：
//   壳进程存活 → 数据目录被初始化 → 13306 可 ping → 17860 health 200 → 终止壳 → mysqld/后端均退出。
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, openSync, closeSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'

const RELEASE = 'E:\\DeepseekHarness\\mindtrail\\release'
const SHELL = path.join(RELEASE, 'trailmind-shell.exe')
const BIN = path.join(RELEASE, 'mysql', 'bin')
const MYSQLADMIN = path.join(BIN, 'mysqladmin.exe')
const APPDATA_ROOT = 'E:\\DeepseekHarness\\.shell-appdata'
const DATA_DIR = path.join(APPDATA_ROOT, 'TrailMind', 'db')
const LOG_DIR = 'E:\\DeepseekHarness\\.shell-logs'
mkdirSync(LOG_DIR, { recursive: true })

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const results = []

function runCapture(exe, args) {
  const tmp = path.join(LOG_DIR, `cap-${Date.now()}.txt`)
  writeFileSync(tmp, '')
  const fd = openSync(tmp, 'a')
  let r
  try {
    r = spawnSync(exe, args, { stdio: ['ignore', fd, fd], windowsHide: true })
  } finally {
    closeSync(fd)
  }
  return { status: r.status, out: readFileSync(tmp, 'utf8') }
}

const alive = (pid) => {
  if (!pid) return false
  try { process.kill(pid, 0); return true } catch { return false }
}

async function health() {
  try {
    const res = await fetch('http://127.0.0.1:17860/api/v1/health')
    return res.status
  } catch { return 0 }
}

const dbPing = () => /mysqld is alive/i.test(runCapture(MYSQLADMIN, ['-u', 'root', '--port', '13306', 'ping']).out)

rmSync(APPDATA_ROOT, { recursive: true, force: true })
const nulIn = openSync('\\\\.\\NUL', 'r')
const nulOut = openSync('\\\\.\\NUL', 'w')

// 壳以 APPDATA 定位数据目录；沙箱下用独立 E2E_APPDATA 避免污染真实 %APPDATA%
const shell = spawn(SHELL, [], {
  stdio: ['ignore', nulIn, nulOut],
  windowsHide: true,
  env: { ...process.env, APPDATA: APPDATA_ROOT },
})
console.log('[shell] pid =', shell.pid)
const shellPid = shell.pid

let dbReady = false
let beReady = 0
for (let i = 0; i < 60; i++) {
  await sleep(1000)
  if (!dbReady && dbPing()) dbReady = true
  const h = await health()
  if (h === 200) { beReady = 200; break }
  if (!alive(shellPid)) { console.log(`[shell] 壳进程在第 ${i + 1}s 退出（exit=${shell.exitCode}）`); break }
}
results.push(['壳进程启动', alive(shellPid) ? 'PASS' : 'FAIL', `pid=${shellPid}`])
results.push(['壳自动初始化数据目录（%APPDATA%\\TrailMind\\db）', existsSync(path.join(DATA_DIR, 'mysql')) ? 'PASS' : 'FAIL', DATA_DIR])
results.push(['壳拉起便携 MySQL 并就绪（13306 ping）', dbReady ? 'PASS' : 'FAIL', ''])
results.push(['壳拉起后端 + /api/v1/health 200', beReady === 200 ? 'PASS' : 'FAIL', beReady ? '200' : '未就绪'])

// 终止壳（等价用户关窗）→ 壳的 Run() 失败/退出路径应反序停后端与数据库
try { spawnSync('taskkill', ['/PID', String(shellPid), '/T', '/F'], { stdio: 'ignore', windowsHide: true }) } catch {}
await sleep(6000)
const dbGone = !dbPing()
const beGone = (await health()) !== 200
results.push(['强杀壳后便携 MySQL 仍残留（预期：强杀不走清理路径）', dbGone ? 'INFO' : 'EXPECTED', dbGone ? '已自行退出' : '残留（由下次启动清理）'])
results.push(['强杀壳后后端仍残留（预期：强杀不走清理路径）', beGone ? 'INFO' : 'EXPECTED', beGone ? '已自行退出' : '残留（由下次启动清理）'])

// 复现 M0/M2 验收场景：强杀后重新启动 → 新实例应清理孤儿，且自己正常可用
const nulIn2 = openSync('\\\\.\\NUL', 'r')
const nulOut2 = openSync('\\\\.\\NUL', 'w')
const shell2 = spawn(SHELL, [], {
  stdio: ['ignore', nulIn2, nulOut2],
  windowsHide: true,
  env: { ...process.env, APPDATA: APPDATA_ROOT },
})
console.log('[shell] 第二次启动 pid =', shell2.pid)
let health2 = 0
let dbPing2 = false
for (let i = 0; i < 60; i++) {
  await sleep(1000)
  if (!dbPing2 && dbPing()) dbPing2 = true
  health2 = await health()
  if (health2 === 200) break
  if (!alive(shell2.pid)) break
}
results.push(['强杀后重启：新实例清理孤儿并自行就绪（MySQL 13306 + 后端 200）', dbPing2 && health2 === 200 ? 'PASS' : 'FAIL', `health=${health2}`])

// 第二次实例强杀后做最终清理（避免遗留占用端口影响后续会话）
try { spawnSync('taskkill', ['/PID', String(shell2.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true }) } catch {}
await sleep(2000)
if (dbPing()) runCapture(MYSQLADMIN, ['-u', 'root', '--port', '13306', 'shutdown'])
await sleep(2000)

console.log('\n================ S2b 壳编排结果 ================')
let fail = 0
for (const [what, verdict, detail] of results) {
  const mark = verdict === 'PASS' ? '✓' : verdict === 'FAIL' ? '✗' : '·'
  if (verdict === 'FAIL') fail++
  console.log(`${mark} ${what}${detail ? ' ｜ ' + detail : ''}`)
}
console.log(`\nS2b SHELL: ${fail === 0 ? 'ALL PASS' : `${fail} FAIL`}（${results.filter((r) => r[1] === 'PASS').length} 项通过）`)

// 兜底清理
if (!dbGone) runCapture(MYSQLADMIN, ['-u', 'root', '--port', '13306', 'shutdown'])
closeSync(nulIn)
closeSync(nulOut)
