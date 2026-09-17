// 一键构建（前端产物 + 后端 jar）：S5 起打包链路由 scripts/package-desktop.mjs 统一编排
// （build → 后端 app-image → 便携 MySQL → 壳 → release 组装），故 `npm run package` 已改为
// 直接调用它（见 package.json）。本文件保留为「只构建、不打包」的入口，供开发与 CI 复用。
import { spawnSync } from 'node:child_process'

function run(command) {
  console.log(`\n[build] ${command}`)
  const r = spawnSync(command, { shell: true, stdio: 'inherit', windowsHide: true })
  if (r.status !== 0) process.exit(r.status ?? 1)
}

run('node scripts/build.mjs')
console.log('\n[build] 完成：前端产物已进 backend/src/main/resources/static，后端 jar 在 backend/target')
