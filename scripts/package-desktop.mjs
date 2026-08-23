// 打包桌面端（specs 自包含打包 Phase 4 / 设计文档 §4.5、§4.6）。
// 全流程（§4.6）：① build（前端+后端 jar）② 后端 app-image（jdeps→jlink→jpackage，复用 package-backend.mjs）
// ③ 下载/解压 MariaDB（若缺失）④ 复制图标 + wails build 出壳 exe ⑤ 组装 release/（壳 exe + 后端 app-image + mariadb）。
// 前置：JDK 21；Go + Wails + 64 位 mingw-w64（wails build 需 CGO）；网络可达（下载 MariaDB zip）。
// 关键逻辑（纯函数）单测见 scripts/test/package-desktop.test.mjs；编排走 spawn，镜像 build.mjs/package.mjs。
import { spawnSync } from 'node:child_process'
import { copyFileSync, cpSync, existsSync, mkdirSync, renameSync, rmSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

// —— 常量与纯函数（单测覆盖）——

// MariaDB 11.4 LTS winx64 便携 zip（可经 MARIADB_VERSION 覆盖；版本号需为 archive.mariadb.org 实际存在的发布）。
export const MARIADB_VERSION = process.env.MARIADB_VERSION || '11.4.5'
// Wails 壳应用名（wails init -n trailmind-shell，设计 §4.4），决定壳 exe 名。
export const SHELL_APP_NAME = 'trailmind-shell'

export function mariadbZipName(version = MARIADB_VERSION) {
  return `mariadb-${version}-winx64.zip`
}

// zip 解压后的顶层目录名（winx64-packages 约定）。
export function mariadbExtractedDir(version = MARIADB_VERSION) {
  return `mariadb-${version}-winx64`
}

// MariaDB 官方归档下载地址（winx64-packages）。
export function mariadbZipUrl(version = MARIADB_VERSION) {
  return `https://archive.mariadb.org/mariadb-${version}/winx64-packages/${mariadbZipName(version)}`
}

export function resolveVendorDir(root) {
  return path.join(root, 'desktop', 'vendor')
}

export function resolveMariaDbDir(vendorDir) {
  return path.join(vendorDir, 'mariadb')
}

export function resolveMariaDbBin(vendorDir) {
  return path.join(resolveMariaDbDir(vendorDir), 'bin')
}

// MariaDB 是否已就位：bin 下三个关键 exe 齐全（与 Phase 2 库 EXE 常量同源）。
export function isMariaDbDownloaded(binDir, exists = existsSync) {
  return ['mariadbd.exe', 'mariadb-install-db.exe', 'mysqladmin.exe'].every((n) => exists(path.join(binDir, n)))
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

// release 组装清单（相对 release 根）。壳 exe 与后端 app-image 均已内嵌图标；mariadb 保持相对路径供壳按 %APPDIR% 定位（§4.6 步骤 7）。
export function buildReleaseLayout({ shellExe, backendAppImage, mariadbDir }) {
  return [
    { from: shellExe, to: `${SHELL_APP_NAME}.exe`, isDir: false },
    { from: backendAppImage, to: 'trailmind-backend', isDir: true },
    { from: mariadbDir, to: 'mariadb', isDir: true },
  ]
}

// —— 编排 ——

function run(command, opts = {}) {
  console.log(`\n[package-desktop] ${command}`)
  const r = spawnSync(command, { shell: true, stdio: 'inherit', windowsHide: true, ...opts })
  if (r.status !== 0) process.exit(r.status ?? 1)
}

// ③ MariaDB 下载/解压（若缺失）。
function ensureMariaDb() {
  const vendorDir = resolveVendorDir(ROOT)
  const mariadbDir = resolveMariaDbDir(vendorDir)
  const binDir = resolveMariaDbBin(vendorDir)
  if (isMariaDbDownloaded(binDir)) {
    console.log(`[package-desktop] MariaDB 已就位：${binDir}`)
    return
  }
  const version = MARIADB_VERSION
  const zipPath = path.join(vendorDir, mariadbZipName(version))
  mkdirSync(vendorDir, { recursive: true })
  console.log(`[package-desktop] 下载 MariaDB ${version}（winx64 便携 zip）…`)
  run(`curl.exe -L -o "${zipPath}" "${mariadbZipUrl(version)}"`)
  console.log(`[package-desktop] 解压到 ${vendorDir} …`)
  run(`tar.exe -xf "${zipPath}" -C "${vendorDir}"`)
  const extracted = path.join(vendorDir, mariadbExtractedDir(version))
  if (!existsSync(extracted)) {
    console.error(`[package-desktop] 解压后未找到 ${extracted}，MariaDB zip 结构可能变化`)
    process.exit(1)
  }
  if (existsSync(mariadbDir)) rmSync(mariadbDir, { recursive: true, force: true })
  renameSync(extracted, mariadbDir)
  console.log(`[package-desktop] MariaDB 就位：${binDir}`)
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
  const mariadbDir = resolveMariaDbDir(resolveVendorDir(ROOT))
  const releaseDir = resolveReleaseDir(ROOT)
  if (existsSync(releaseDir)) rmSync(releaseDir, { recursive: true, force: true })
  mkdirSync(releaseDir, { recursive: true })
  for (const { from, to, isDir } of buildReleaseLayout({ shellExe, backendAppImage, mariadbDir })) {
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
  ensureMariaDb() // ③
  copyShellIcon() // ④ 图标
  run('wails build', { cwd: path.join(ROOT, 'desktop', 'wails') }) // ④ wails build（需 Go+Wails+64 位 mingw）
  assembleRelease() // ⑤
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
}
