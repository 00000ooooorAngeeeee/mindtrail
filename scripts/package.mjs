// 打包（docs/10 §10）：先构建（build.mjs），再 electron-builder 产出 NSIS 安装包到 release/。
// 前置：构建所需环境 + desktop 已 npm install（electron-builder 依赖；Electron 二进制走华为云镜像，见会话 5 review）。
import { spawnSync } from 'node:child_process'

function run(command) {
  console.log(`\n[package] ${command}`)
  const r = spawnSync(command, { shell: true, stdio: 'inherit', windowsHide: true })
  if (r.status !== 0) process.exit(r.status ?? 1)
}

run('node scripts/build.mjs')
run('npm --prefix desktop run dist')
console.log('\n[package] 完成：安装包位于 desktop/ 外的 release/ 目录')
