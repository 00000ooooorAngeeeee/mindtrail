// 一键拉起桌面端（「启动 TrailMind」快捷方式调用）：
// Electron 壳自拉后端 jar（backend/target/trailmind-backend-0.0.1.jar），
// 并加载 http://127.0.0.1:17860（Phase 0 起后端同源服务前端：/ → index.html、/api/v1 → 接口）——无需 vite/浏览器。
// 前置：jar 已构建（npm run build，含嵌入前端）、MySQL 已启动（3306）、.env 含 DB 凭据（electron 主进程 loadEnv 注入后端子进程）。
// 关闭窗口 → electron before-quit 停后端 jar；本脚本 killProcessTree 兜底。
// 注：若已有 TrailMind 实例在跑，单实例锁会使新实例退出（聚焦旧窗或无窗）——先结束残留 electron 再启动。
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'
import { killProcessTree } from '../desktop/main/backend-process.js'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const children = []
let shuttingDown = false

function spawnCmd(command, opts, onExit) {
  const child = spawn(command, { shell: true, windowsHide: true, stdio: 'inherit', ...opts })
  child.on('exit', (code) => {
    if (shuttingDown) return
    if (onExit) { onExit(code); return }
    if (code !== null && code !== 0) {
      console.error(`[launch] 子进程异常退出（code=${code}）：${command}`)
      void shutdown(code)
    }
  })
  children.push(child)
  return child
}

async function shutdown(code = 0) {
  if (shuttingDown) return
  shuttingDown = true
  console.log('\n[launch] 正在终止进程树…')
  await Promise.all(
    children.map((c) => (c.pid && c.exitCode === null ? killProcessTree(c.pid) : Promise.resolve())),
  )
  process.exit(code)
}

process.on('SIGINT', () => shutdown(0))
process.on('SIGTERM', () => shutdown(0))

console.log('[launch] 拉起 Electron 桌面端（自拉后端 jar，同源加载 http://127.0.0.1:17860；无需 vite）…')
// TRAILMIND_DEV_URL（desktop/main/index.js 第 7 行读取的变量名）让 electron 加载后端同源地址（Phase 0 起后端服务前端），而非默认 5173 vite dev server
spawnCmd(
  'npm --prefix desktop start',
  { cwd: ROOT, env: { ...process.env, TRAILMIND_DEV_URL: 'http://127.0.0.1:17860' } },
  (code) => {
    console.log(`[launch] Electron 已退出（code=${code}）。`)
    void shutdown(code ?? 0)
  },
)
