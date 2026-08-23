// 一键拉起 Electron 壳（「启动 TrailMind」快捷方式调用，docs/10 §10）：
// 并行启动前端 vite dev server（提供 /api 代理 + HMR）与 Electron 桌面壳（自拉后端 jar、加载 5173），
// 关闭 Electron 窗口或 Ctrl+C 即终止整棵树（vite + 后端 jar）。
//
// 与 scripts/dev.mjs 的区别：dev.mjs 起后端(mvn)+vite，不打开壳；本脚本不起 mvn（Electron 主进程
// 自拉已构建的后端 jar，backend/target/trailmind-backend-0.0.1.jar），仅起 vite + electron，
// 因此更轻、启动更快，且前端走 vite HMR（无需重建 dist，规避 stale dist）。
//
// 前置：MySQL 已启动（3306，库 trailmind）；DB 凭据由 Electron 主进程从仓库根 .env 加载并注入后端子进程。
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'
import { killProcessTree } from '../desktop/main/backend-process.js'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const children = []
let shuttingDown = false

/**
 * spawn 一个经 shell 执行的命令（兼容 npm.cmd），输出透传到本控制台。
 * onExit 非空时由其自行决定善后（如 Electron 退出 → 终止全部）；否则异常退出即终止整棵树。
 */
function spawnCmd(command, opts, onExit) {
  const child = spawn(command, { shell: true, windowsHide: true, stdio: 'inherit', ...opts })
  child.on('exit', (code) => {
    if (shuttingDown) return
    if (onExit) {
      onExit(code)
      return
    }
    if (code !== null && code !== 0) {
      console.error(`[launch] 子进程异常退出（code=${code}）：${command}，终止全部`)
      void shutdown(code)
    }
  })
  children.push(child)
  return child
}

async function shutdown(code = 0) {
  if (shuttingDown) return
  shuttingDown = true
  console.log('\n[launch] 正在终止进程树（vite + 后端 jar）…')
  await Promise.all(
    children.map((c) => (c.pid && c.exitCode === null ? killProcessTree(c.pid) : Promise.resolve())),
  )
  process.exit(code)
}

process.on('SIGINT', () => shutdown(0))
process.on('SIGTERM', () => shutdown(0))

console.log('[launch] 启动前端 vite dev server（→ http://localhost:5173，/api 代理后端）…')
spawnCmd('npm run dev', { cwd: path.join(ROOT, 'frontend') })

console.log('[launch] 启动 Electron 壳（自拉后端 jar + 加载 5173；关闭窗口即终止全部）…')
spawnCmd('npm --prefix desktop start', { cwd: ROOT }, (code) => {
  console.log(`[launch] Electron 壳已退出（code=${code}），终止 vite 与后端…`)
  void shutdown(code ?? 0)
})
