// 一键开发（S5 起 Electron 壳退役）：并行启动后端（mvn spring-boot:run）与前端（vite dev server），
// Ctrl+C 整棵树终止。浏览 http://localhost:5173 开发前端（vite proxy 转发 /api 到 17860）。
//
// 与打包态的关系：打包态由 Wails 壳加载「后端同源服务的前端产物」（http://127.0.0.1:17860）。
// 想让壳加载你刚改的前端，跑 `npm run dev:shell`（build 前端 → 进后端 static → 起壳）。
//
// 前置：MySQL 已启动（默认 127.0.0.1:3306，库 trailmind）；DB 凭据从根 .env 加载（gitignore 已忽略）。
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'
import { killProcessTree, loadEnvFile } from './lib/proc.mjs'

loadEnvFile()

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const children = []

// spawn 一个经 cmd.exe 执行的命令（兼容 mvn.cmd / npm.cmd），输出透传；异常退出则终止全部。
function spawnCmd(command, opts) {
  const child = spawn(command, { shell: true, windowsHide: true, stdio: 'inherit', ...opts })
  child.on('exit', (code) => {
    if (!shuttingDown && code !== null && code !== 0) {
      console.error(`[dev] 子进程退出（code=${code}）：${command}，终止全部`)
      shutdown(code)
    }
  })
  children.push(child)
  return child
}

let shuttingDown = false
async function shutdown(code = 0) {
  if (shuttingDown) return
  shuttingDown = true
  console.log('\n[dev] 正在终止前后端进程树…')
  await Promise.all(
    children.map((c) => (c.pid && c.exitCode === null ? killProcessTree(c.pid) : Promise.resolve())),
  )
  process.exit(code)
}

process.on('SIGINT', () => shutdown(0))
process.on('SIGTERM', () => shutdown(0))

console.log('[dev] 启动后端（mvn spring-boot:run → http://127.0.0.1:17860）…')
spawnCmd('mvn spring-boot:run', { cwd: path.join(ROOT, 'backend') })
console.log('[dev] 启动前端（vite dev server → http://localhost:5173，/api 代理到 17860）…')
spawnCmd('npm run dev', { cwd: path.join(ROOT, 'frontend') })
