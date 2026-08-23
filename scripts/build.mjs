// 构建（docs/10 §10）：前端 vite build（含 tsc 类型检查）→ 复制 dist 进后端静态资源（同源服务前端，specs 自包含打包 Phase 0）
// + 后端 mvn clean package（含测试）。产出 frontend/dist 与 backend/target/trailmind-backend-0.0.1.jar（jar 含同源前端），供 dev:desktop 与打包使用。
// 前置：MySQL 已启动；DB 凭据从根目录 .env（gitignore 已忽略）加载，已设的环境变量优先。
import { spawnSync } from 'node:child_process'
import { cpSync, rmSync, existsSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const DIST = path.join(ROOT, 'frontend', 'dist')
const STATIC = path.join(ROOT, 'backend', 'src', 'main', 'resources', 'static')

// 本地敏感配置（DB_USER/DB_PASS）不提交，从 .env 读入；shell 已设的环境变量不覆盖。
try { process.loadEnvFile(new URL('../.env', import.meta.url)) } catch { /* 无 .env 时回落到 shell 环境变量 */ }

// 生成打包态凭据回退文件（gitignore）：app-image 裸双击时经 spring.config.import 读取（docs/11 §6）。
// 环境变量注入（壳）优先级更高，此处仅为「无 env 时连既有 MySQL」的回退。
writeFileSync(
  path.join(ROOT, 'backend', 'src', 'main', 'resources', 'db-credentials.properties'),
  `DB_HOST=${process.env.DB_HOST || '127.0.0.1'}\n` +
    `DB_PORT=${process.env.DB_PORT || '3306'}\n` +
    `DB_USER=${process.env.DB_USER || 'root'}\n` +
    `DB_PASS=${process.env.DB_PASS || ''}\n`,
)

function run(command) {
  console.log(`\n[build] ${command}`)
  const r = spawnSync(command, { shell: true, stdio: 'inherit', windowsHide: true })
  if (r.status !== 0) process.exit(r.status ?? 1)
}

run('npm --prefix frontend run build')

// 复制前端产物进后端 classpath:/static/（同源服务前端：/ → index.html、/assets/* → 静态；specs 自包含打包 Phase 0）。
// static/ 已 gitignore（构建产物不入库）；mvn clean 不触及 src/，故 clean package 仍会纳入 jar。
if (existsSync(STATIC)) rmSync(STATIC, { recursive: true, force: true })
cpSync(DIST, STATIC, { recursive: true })
console.log(`[build] 已复制 ${path.relative(ROOT, DIST)} → ${path.relative(ROOT, STATIC)}`)

run('mvn -f backend/pom.xml clean package')
console.log('\n[build] 完成：frontend/dist + backend/target/trailmind-backend-0.0.1.jar（jar 含同源前端）')
