// 打包桌面端（specs 自包含打包 Phase 4 / 设计文档 §4.5、§4.6；2026-08-24 由 MariaDB 改绑 MySQL）。
// 全流程（§4.6）：① build（前端+后端 jar）② 后端 app-image（jdeps→jlink→jpackage，复用 package-backend.mjs）
// ③ 取便携 MySQL（vendor 缓存或下载解压）④ 复制图标 + wails build 出壳 exe ⑤ 组装 release/（壳 exe + 后端 app-image + mysql）。
// 前置：JDK 21；Go + Wails + 64 位 mingw-w64（wails build 需 CGO）；网络可达（下载 MySQL zip；或手工放入 vendor 缓存）。
// 关键逻辑（纯函数）单测见 scripts/test/package-desktop.test.mjs；编排走 spawn，镜像 build.mjs/package.mjs。
import { spawnSync } from 'node:child_process'
import { copyFileSync, cpSync, existsSync, mkdirSync, renameSync, rmSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

// —— 常量与纯函数（单测覆盖）——

// MySQL 8.4 LTS winx64 免安装 zip（可经 MYSQL_VERSION 覆盖；版本号需为 cdn.mysql.com 实际存在的发布）。
export const MYSQL_VERSION = process.env.MYSQL_VERSION || '8.4.6'
// Wails 壳应用名（wails init -n trailmind-shell，设计 §4.4），决定壳 exe 名。
export const SHELL_APP_NAME = 'trailmind-shell'

export function mysqlZipName(version = MYSQL_VERSION) {
  return `mysql-${version}-winx64.zip`
}

// zip 解压后的顶层目录名（MySQL Windows zip 约定）。
export function mysqlExtractedDir(version = MYSQL_VERSION) {
  return `mysql-${version}-winx64`
}

// MySQL 官方下载地址（dev.mysql.com/get 会 302 到 cdn.mysql.com，两种均可）。
export function mysqlZipUrl(version = MYSQL_VERSION) {
  return `https://dev.mysql.com/get/Downloads/MySQL-${majorMinor(version)}/${mysqlZipName(version)}`
}

// 版本号取 major.minor（8.4.6 → 8.4；下载路径按 minor 系列分目录）。
export function majorMinor(version = MYSQL_VERSION) {
  const parts = String(version).split('.')
  return parts.length >= 2 ? `${parts[0]}.${parts[1]}` : String(version)
}

export function resolveVendorDir(root) {
  return path.join(root, 'desktop', 'vendor')
}

export function resolveMySQLDir(vendorDir) {
  return path.join(vendorDir, 'mysql')
}

export function resolveMySQLBin(vendorDir) {
  return path.join(resolveMySQLDir(vendorDir), 'bin')
}

// 便携 MySQL 是否已就位：bin 下关键 exe 齐全（与壳/生命周期库 EXE 常量同源：mysqld 兼顾初始化与常驻）。
export function isMySQLReady(binDir, exists = existsSync) {
  return ['mysqld.exe', 'mysqladmin.exe'].every((n) => exists(path.join(binDir, n)))
}

// 便携 MySQL 是否已解压（vendor 缓存目录：vendor/mysql/<version>）。缓存键含版本号，便于升级时不复用旧版本。
export function resolveMySQLCacheDir(vendorDir, version = MYSQL_VERSION) {
  return path.join(vendorDir, 'mysql-cache', version)
}

// Wails 壳图标位置（§4.5：打包前从 branding/icon.ico 复制到此，wails build 读取它）。
export function resolveShellIcon(root) {
  return path.join(root, 'desktop', 'wails', 'build', 'windows', 'icon.ico')
}

export function resolveShellBuildDir(root) {
  return path.join(root, 'desktop', 'wails', 'build')
}

export function resolveShellExe(buildDir) {
  return path.join(buildDir, 'bin', `${SHELL_APP_NAME}.exe`)
}

export function resolveBackendAppImage(root) {
  return path.join(root, 'backend', 'target', 'trailmind-backend')
}

export function resolveReleaseDir(root) {
  return path.join(root, 'release')
}

// release 组装清单（相对 release 根）。壳 exe 与后端 app-image 均已内嵌图标；mysql 保持相对路径供壳按 %APPDIR% 定位（§4.6 步骤 7，与 orchestrator.ResolvePortableDbDir 同名）。
export function buildReleaseLayout({ shellExe, backendAppImage, mysqlDir }) {
  return [
    { from: shellExe, to: `${SHELL_APP_NAME}.exe`, isDir: false },
    { from: backendAppImage, to: 'trailmind-backend', isDir: true },
    { from: mysqlDir, to: 'mysql', isDir: true },
  ]
}

// 已解压的便携 MySQL 根目录定位：<dir>/mysql-<version>-winx64（zip 顶层）或 <dir> 自身（手工解压成 mysql/bin 结构）。
export function locateExtractedMySQL(dir, version = MYSQL_VERSION, exists = existsSync) {
  const nested = path.join(dir, mysqlExtractedDir(version))
  if (exists(nested)) return nested
  if (exists(path.join(dir, 'bin'))) return dir
  return null
}

// —— 编排 ——

function run(command, opts = {}) {
  console.log(`\n[package-desktop] ${command}`)
  const r = spawnSync(command, { shell: true, stdio: 'inherit', windowsHide: true, ...opts })
  if (r.status !== 0) process.exit(r.status ?? 1)
}

// ③ 便携 MySQL 就位（三级回退：已就位 → vendor 缓存 → 下载解压）。
function ensureMySQL() {
  const vendorDir = resolveVendorDir(ROOT)
  const mysqlDir = resolveMySQLDir(vendorDir)
  const binDir = resolveMySQLBin(vendorDir)
  if (isMySQLReady(binDir)) {
    console.log(`[package-desktop] 便携 MySQL 已就位：${binDir}`)
    return
  }

  const cacheDir = resolveMySQLCacheDir(vendorDir)
  let source = locateExtractedMySQL(cacheDir)
  if (source) {
    console.log(`[package-desktop] 复用 vendor 缓存：${source}`)
  } else {
    const zipPath = path.join(vendorDir, mysqlZipName(MYSQL_VERSION))
    mkdirSync(vendorDir, { recursive: true })
    if (existsSync(zipPath)) {
      console.log(`[package-desktop] 复用已下载 ${zipPath}`)
    } else {
      console.log(`[package-desktop] 下载 MySQL ${MYSQL_VERSION}（winx64 免安装 zip）…`)
      run(`curl.exe -L -o "${zipPath}" "${mysqlZipUrl(MYSQL_VERSION)}"`)
    }
    mkdirSync(cacheDir, { recursive: true })
    console.log(`[package-desktop] 解压到 ${cacheDir} …`)
    run(`tar.exe -xf "${zipPath}" -C "${cacheDir}"`)
    source = locateExtractedMySQL(cacheDir)
    if (!source) {
      console.error(`[package-desktop] 解压后未找到便携 MySQL（期望 ${mysqlExtractedDir(MYSQL_VERSION)} 或 bin/），zip 结构可能变化`)
      process.exit(1)
    }
  }

  if (existsSync(mysqlDir)) rmSync(mysqlDir, { recursive: true, force: true })
  mkdirSync(path.dirname(mysqlDir), { recursive: true })
  if (path.resolve(source) !== path.resolve(mysqlDir)) renameSync(source, mysqlDir)
  if (!isMySQLReady(binDir)) {
    console.error(`[package-desktop] 便携 MySQL 关键 exe 缺失：${binDir}`)
    process.exit(1)
  }
  console.log(`[package-desktop] 便携 MySQL 就位：${binDir}`)
}

// ④ 图标复制：branding/icon.ico → desktop/wails/build/windows/icon.ico（§4.5 约定式换图标）。
function copyShellIcon() {
  const src = path.join(ROOT, 'branding', 'icon.ico')
  const dst = resolveShellIcon(ROOT)
  if (!existsSync(src)) {
    console.error(`[package-desktop] 缺少约定图标 ${src}（branding/icon.ico）`)
    process.exit(1)
  }
  mkdirSync(path.dirname(dst), { recursive: true })
  copyFileSync(src, dst)
  console.log(`[package-desktop] 图标已复制 ${path.relative(ROOT, src)} → ${path.relative(ROOT, dst)}`)
}

// ⑤ release 组装。
function assembleRelease() {
  const shellExe = resolveShellExe(resolveShellBuildDir(ROOT))
  const backendAppImage = resolveBackendAppImage(ROOT)
  const mysqlDir = resolveMySQLDir(resolveVendorDir(ROOT))
  const releaseDir = resolveReleaseDir(ROOT)
  if (existsSync(releaseDir)) rmSync(releaseDir, { recursive: true, force: true })
  mkdirSync(releaseDir, { recursive: true })
  for (const { from, to, isDir } of buildReleaseLayout({ shellExe, backendAppImage, mysqlDir })) {
    if (!existsSync(from)) {
      console.error(`[package-desktop] 组装失败：缺少 ${from}（前序步骤未产出）`)
      process.exit(1)
    }
    const dest = path.join(releaseDir, to)
    if (isDir) cpSync(from, dest, { recursive: true })
    else copyFileSync(from, dest)
    console.log(`[package-desktop] 组装 ${to}`)
  }
  console.log(`\n[package-desktop] 完成：release/ 自包含产物（双击 ${SHELL_APP_NAME}.exe，无需预装 Java/MySQL）`)
}

function main() {
  run('node scripts/build.mjs') // ① 前端 build + 复制 dist + mvn package
  run('node scripts/package-backend.mjs') // ② jdeps→jlink→jpackage 后端 app-image
  ensureMySQL() // ③
  copyShellIcon() // ④ 图标
  run('wails build', { cwd: path.join(ROOT, 'desktop', 'wails') }) // ④ wails build（需 Go+Wails+64 位 mingw）
  assembleRelease() // ⑤
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
}
