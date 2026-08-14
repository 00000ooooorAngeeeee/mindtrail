// 构建（docs/10 §10）：前端 vite build（含 tsc 类型检查）+ 后端 mvn clean package（含测试）。
// 产出 frontend/dist 与 backend/target/trailmind-backend-0.0.1.jar，供 dev:desktop 与打包使用。
// 前置：JDK 21（JAVA_HOME 指向 jdk-21）、DB_PASS 注入（后端集成测试需连 MySQL）。
import { spawnSync } from 'node:child_process'

function run(command) {
  console.log(`\n[build] ${command}`)
  const r = spawnSync(command, { shell: true, stdio: 'inherit', windowsHide: true })
  if (r.status !== 0) process.exit(r.status ?? 1)
}

run('npm --prefix frontend run build')
run('mvn -f backend/pom.xml clean package')
console.log('\n[build] 完成：frontend/dist + backend/target/trailmind-backend-0.0.1.jar')
