// 构建（docs/10 §10）：前端 vite build（含 tsc 类型检查）+ 后端 mvn clean package（含测试）。
// 产出 frontend/dist 与 backend/target/trailmind-backend-0.0.1.jar，供 dev:desktop 与打包使用。
// 前置：DB_PASS 注入（后端集成测试需连 MySQL）；JDK 21 自动解析（scripts/java.mjs），无需手动设 JAVA_HOME。
import { spawnSync } from 'node:child_process'
import { resolveJdk21 } from './java.mjs'

// 强制用 JDK 21 构建：MyBatis-Plus 在 Java 25 下无法建 sqlSessionTemplate，会令 mvn test 失败。
const jdk21 = resolveJdk21()
if (jdk21) {
  process.env.JAVA_HOME = jdk21
  console.log(`[build] 使用 JDK 21：${jdk21}`)
} else {
  console.warn('[build] 警告：未找到 JDK 21，将用当前 java（若为 Java 25 会因 MyBatis 失败）')
}

function run(command) {
  console.log(`\n[build] ${command}`)
  const r = spawnSync(command, { shell: true, stdio: 'inherit', windowsHide: true })
  if (r.status !== 0) process.exit(r.status ?? 1)
}

run('npm --prefix frontend run build')
run('mvn -f backend/pom.xml clean package')
console.log('\n[build] 完成：frontend/dist + backend/target/trailmind-backend-0.0.1.jar')
