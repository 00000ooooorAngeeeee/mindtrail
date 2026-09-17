// 一键拉起 Wails 桌面端（「启动 TrailMind」快捷方式调用；S5 起 Electron 壳已退役）。
//
// 与旧版差异：不再由 Electron 拉起后端 jar，而是直接运行自包含产物 release/trailmind-shell.exe——
// 壳自行：初始化并启动便携 MySQL（13306）→ 启动后端 app-image（bundled JRE）→ 开 WebView2 窗口加载
// http://127.0.0.1:17860（后端同源服务前端）→ 关窗反序清理（含强杀兜底的运行态文件）。
//
// 前置：`npm run package:desktop`（或至少完成 build + package:backend + wails build 并组装 release/）。
// 关闭窗口即退出；本脚本 Ctrl+C 时整树终止（taskkill /T /F）兜底。
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { killProcessTree, loadEnvFile } from './lib/proc.mjs'
import { resolveReleaseShellPath, resolveShellExe } from './lib/shell-launcher.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
loadEnvFile(ROOT)

const children = []
let shuttingDown = false

async function shutdown(code = 0) {
  if (shuttingDown) return
  shuttingDown = true
  console.log('\n[launch] 正在终止进程树（壳会一并停掉后端与便携 MySQL）…')
  await Promise.all(children.map((c) => (c.pid && c.exitCode === null ? killProcessTree(c.pid) : Promise.resolve())))
  process.exit(code)
}

process.on('SIGINT', () => shutdown(0))
process.on('SIGTERM', () => shutdown(0))

const exe = resolveShellExe(ROOT)
if (!exe) {
  console.error('[launch] 未找到壳产物，请先执行：')
  console.error('         npm run package:desktop   # 完整自包含打包（前端+后端 app-image+便携 MySQL+壳）')
  console.error(`         期望位置：${resolveReleaseShellPath(ROOT)} 或 desktop/wails/build/bin/trailmind-shell.exe`)
  process.exit(1)
}

// 前置体检：release 布局需与壳的 %APPDIR% 约定一致（mysql/ 与 trailmind-backend/ 与壳 exe 同级）
const appDir = path.dirname(exe)
for (const [label, rel] of [['便携 MySQL', 'mysql/bin/mysqld.exe'], ['后端 app-image', 'trailmind-backend/trailmind-backend.exe']]) {
  if (!existsSync(path.join(appDir, rel))) {
    console.warn(`[launch] 警告：${label} 未就位（${rel}）——壳启动会失败，请先 npm run package:desktop`)
  }
}

console.log(`[launch] 拉起 Wails 桌面端：${exe}`)
console.log('[launch] 壳将自行启动便携 MySQL(13306) 与后端(17860)，窗口加载 http://127.0.0.1:17860；无需 vite/浏览器')
const child = spawn(exe, [], { cwd: appDir, stdio: 'inherit', windowsHide: false })
children.push(child)
child.on('exit', (code) => {
  console.log(`[launch] 桌面端已退出（code=${code}）。`)
  void shutdown(code ?? 0)
})
