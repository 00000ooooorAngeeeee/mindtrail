// 一键开发（docs/10 §10）：并行启动后端（mvn spring-boot:run）与前端（npm run dev），Ctrl+C 整棵树终止。
// 前置：MySQL 已启动（见 docs/10 任务 0.0/0.3）；JDK 21 自动解析（scripts/java.mjs），无需手动设 JAVA_HOME。
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'
import { resolveJdk21 } from './java.mjs'
import { killProcessTree } from '../desktop/main/backend-process.js'

// 强制用 JDK 21 跑后端：MyBatis-Plus 在 Java 25 下无法建 sqlSessionTemplate。
const jdk21 = resolveJdk21()
if (jdk21) {
  process.env.JAVA_HOME = jdk21
  console.log(`[dev] 使用 JDK 21：${jdk21}`)
} else {
  console.warn('[dev] 警告：未找到 JDK 21，将用当前 java（若为 Java 25 会因 MyBatis 失败）')
}

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

console.log('[dev] 启动后端（mvn spring-boot:run）…')
spawnCmd('mvn spring-boot:run', { cwd: path.join(ROOT, 'backend') })
console.log('[dev] 启动前端（vite dev server → http://localhost:5173）…')
spawnCmd('npm run dev', { cwd: path.join(ROOT, 'frontend') })
