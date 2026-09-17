// 开发态：让 Wails 壳加载你刚改的前端。
//
// 链路（镜像打包态，避免「改了源码却跑 stale 产物」这类坑）：
//   ① 前端 vite build → frontend/dist
//   ② 复制 dist/* → backend/src/main/resources/static/（后端同源服务前端，04 §26 Phase 0）
//   ③ 后端 mvn package → jar（壳用的是 app-image，故这一步只为保持 static 与 jar 同步）
//   ④ 起 release 里的壳（壳自拉便携 MySQL + 后端 app-image）
// 若只想改前端并马上看效果，用 `npm run dev`（vite 热更新 + 浏览器）；本脚本用于验证「打包态壳里的表现」。
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { resolveShellExe } from './lib/shell-launcher.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

function run(command, opts = {}) {
  console.log(`\n[dev:shell] ${command}`)
  const r = spawnSync(command, { shell: true, stdio: 'inherit', windowsHide: true, cwd: ROOT, ...opts })
  if (r.status !== 0) process.exit(r.status ?? 1)
}

// ①+② 前端构建并同步到后端静态资源；③ 后端 jar
run('node scripts/build.mjs')

// ④ 后端 app-image（壳实际拉起的是它；只在缺失时构建，避免每次等 jlink/jpackage）
const appImage = path.join(ROOT, 'backend', 'target', 'trailmind-backend', 'trailmind-backend.exe')
if (!existsSync(appImage)) {
  console.log('[dev:shell] 后端 app-image 缺失，先构建（npm run package:backend）…')
  run('node scripts/package-backend.mjs')
}

const shell = resolveShellExe(ROOT)
if (!shell) {
  console.error('[dev:shell] 未找到壳 exe：请先跑 npm run package（完整打包）或 cd desktop/wails && wails build')
  process.exit(1)
}
console.log(`[dev:shell] 起壳（加载刚构建的前端产物）：${shell}`)
run(`"${shell}"`, { cwd: path.dirname(shell) })
