// NSIS 安装包（S3）：把 `release/` 自包含产物做成「双击安装即用」的 Setup.exe。
//
// 为什么不用 `wails build -nsis`：Wails 内置的 NSIS 模板只打包壳 exe（不含我们的 mysql/ 与
// trailmind-backend/ 两个同级目录，壳按 %APPDIR% 定位它们）。故本脚本自生成 .nsi：
//   - 递归安装整份 release 布局（壳 exe + mysql/ + trailmind-backend/）；
//   - 数据不放进安装目录：运行期数据仍在 %APPDATA%\TrailMind（升级/卸载不丢数据）；
//   - 卸载只删程序目录，保留用户数据（显式提示）。
//
// 前置：NSIS 3.x（makensis.exe 在 PATH 或用 NSIS_HOME 指定）—— 人工安装：
//        https://nsis.sourceforge.io/Download
//
// 用法：node scripts/package-installer.mjs   （或 npm run package:installer）
// 产物：release/TrailMind-Setup-<version>.exe
//
// 关键逻辑（纯函数）单测见 scripts/test/package-installer.test.mjs。
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

/** 应用显示名（安装目录名、快捷方式名、卸载项名）。 */
export const APP_DISPLAY_NAME = '思迹 TrailMind'
/** 安装目录名（%ProgramFiles% 下）。 */
export const APP_DIR_NAME = 'TrailMind'
/** 壳 exe 名（与 wails.json 的 outputfilename 一致）。 */
export const SHELL_EXE_NAME = 'trailmind-shell.exe'
/** release 产物内必须存在的条目（壳 exe + 便携库 + 后端 app-image）。 */
export const REQUIRED_RELEASE_ENTRIES = [
  SHELL_EXE_NAME,
  path.join('mysql', 'bin', 'mysqld.exe'),
  path.join('trailmind-backend', 'trailmind-backend.exe'),
]

/** 生成产物名：TrailMind-Setup-<version>.exe（与旧 electron-builder 命名一致）。 */
export function installerName(version) {
  return `TrailMind-Setup-${version}.exe`
}

/** 安装包输出路径（release/ 根，与旧 electron-builder 一致）。 */
export function resolveInstallerPath(root, version) {
  return path.join(root, 'release', installerName(version))
}

/** .nsi 生成路径（构建中间物，放 release/ 下，gitignore 已忽略该目录）。 */
export function resolveNsiPath(root) {
  return path.join(root, 'release', 'trailmind-installer.nsi')
}

/** 版本号来源：package.json（与 docs/11 §5 版本号管理一致）。 */
export function readVersion(root) {
  const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'))
  return pkg.version || '0.0.0'
}

/** 校验 release 布局完整性，返回缺失项数组（空数组 = 可打包）。 */
export function missingReleaseEntries(releaseDir, exists = existsSync) {
  return REQUIRED_RELEASE_ENTRIES.filter((rel) => !exists(path.join(releaseDir, rel)))
}

/** NSIS 路径分隔符统一为反斜杠（makensis 在 Windows 下要求）。 */
export function toNsisPath(p) {
  return String(p).replace(/\//g, '\\')
}

/**
 * 生成 .nsi 脚本。
 * - /DICON_FILE 由命令行传入（约定式图标：branding/icon.ico → 安装包图标）；
 * - 用 File /r 递归打包 release/*，保持相对布局（壳按 %APPDIR% 找 mysql 与 trailing-backend）；
 * - 卸载不留用户数据（%APPDATA%\TrailMind 显式保留并提示）。
 */
export function buildNsiScript({ appName = APP_DISPLAY_NAME, appDirName = APP_DIR_NAME, version, releaseDir, outFile, iconFile, shellExeName = SHELL_EXE_NAME }) {
  const src = toNsisPath(releaseDir)
  const out = toNsisPath(outFile)
  const iconLine = iconFile ? `  !insertmacro MUI_ICON "${toNsisPath(iconFile)}"\n` : ''
  return `; 由 scripts/package-installer.mjs 生成——请勿手改（改动请改生成器）
Unicode true
!include "MUI2.nsh"

!define APP_NAME "${appName}"
!define APP_DIR "${appDirName}"
!define APP_VERSION "${version}"
!define SHELL_EXE "${shellExeName}"

Name "\${APP_NAME} \${APP_VERSION}"
OutFile "${out}"
InstallDir "$PROGRAMFILES64\\\${APP_DIR}"
InstallDirRegKey HKLM "Software\\\${APP_DIR}" "InstallDir"
RequestExecutionLevel admin
SetCompressor /SOLID lzma
ShowInstDetails show
ShowUnInstDetails show

!define MUI_ABORTWARNING
!define MUI_FINISHPAGE_RUN "$INSTDIR\\\${SHELL_EXE}"
!define MUI_FINISHPAGE_RUN_TEXT "立即启动 \${APP_NAME}"
!define MUI_FINISHPAGE_SHORTCUT
!define MUI_FINISHPAGE_SHORTCUT_NAME "\${APP_NAME}"
${iconLine}!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH

!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES

!insertmacro MUI_LANGUAGE "SimpChinese"
!insertmacro MUI_LANGUAGE "English"

Section "Install" SecInstall
  SetOutPath "$INSTDIR"
  ; 递归安装整份自包含产物：壳 exe + mysql\\（便携数据库）+ trailmind-backend\\（bundled JRE 后端）
  File /r "${src}\\*.*"

  ; 开始菜单与桌面快捷方式（指向壳 exe）
  CreateDirectory "$SMPROGRAMS\\\${APP_NAME}"
  CreateShortCut "$SMPROGRAMS\\\${APP_NAME}\\\${APP_NAME}.lnk" "$INSTDIR\\\${SHELL_EXE}" "" "$INSTDIR\\\${SHELL_EXE}" 0
  CreateShortCut "$DESKTOP\\\${APP_NAME}.lnk" "$INSTDIR\\\${SHELL_EXE}" "" "$INSTDIR\\\${SHELL_EXE}" 0

  ; 卸载信息（控制面板「应用和功能」）
  WriteRegStr HKLM "Software\\\${APP_DIR}" "InstallDir" "$INSTDIR"
  WriteRegStr HKLM "Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\\${APP_DIR}" "DisplayName" "\${APP_NAME}"
  WriteRegStr HKLM "Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\\${APP_DIR}" "DisplayVersion" "\${APP_VERSION}"
  WriteRegStr HKLM "Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\\${APP_DIR}" "Publisher" "TrailMind"
  WriteRegStr HKLM "Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\\${APP_DIR}" "UninstallString" "$INSTDIR\\uninstall.exe"
  WriteRegDWORD HKLM "Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\\${APP_DIR}" "NoModify" 1
  WriteRegDWORD HKLM "Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\\${APP_DIR}" "NoRepair" 1
  WriteUninstaller "$INSTDIR\\uninstall.exe"
SectionEnd

Section "Uninstall"
  ; 只删程序目录；用户数据在 %APPDATA%\\TrailMind（导图/会话/条目数据库），卸载不删以免丢数据
  Delete "$DESKTOP\\\${APP_NAME}.lnk"
  Delete "$SMPROGRAMS\\\${APP_NAME}\\\${APP_NAME}.lnk"
  RMDir "$SMPROGRAMS\\\${APP_NAME}"
  DeleteRegKey HKLM "Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\\${APP_DIR}"
  DeleteRegKey HKLM "Software\\\${APP_DIR}"
  MessageBox MB_OK|MB_ICONINFORMATION "\${APP_NAME} 已卸载。$\r$\n用户数据保留在 %APPDATA%\\TrailMind（如需彻底清除请手动删除该目录）。"
  RMDir /r "$INSTDIR"
SectionEnd
`
}

/** 定位 makensis：NSIS_HOME 优先，其次 PATH。返回 null 表示未安装。 */
export function findMakensis(env = process.env, exists = existsSync) {
  if (env.NSIS_HOME) {
    const p = path.join(env.NSIS_HOME, 'makensis.exe')
    if (exists(p)) return p
  }
  for (const base of ['ProgramFiles(x86)', 'ProgramFiles', 'LOCALAPPDATA']) {
    const root = env[base]
    if (!root) continue
    const p = path.join(root, 'NSIS', 'makensis.exe')
    if (exists(p)) return p
  }
  // PATH 查找（用 where 由调用方决定；此处仅返回裸名让 spawn 走 PATH）
  return null
}

/** 构造 makensis 参数：/V2 进度、/DICON_FILE 约定式图标、脚本路径。 */
export function buildMakensisArgs(nsiPath, iconFile) {
  const args = ['/V2']
  if (iconFile) args.push(`/DICON_FILE=${toNsisPath(iconFile)}`)
  args.push(toNsisPath(nsiPath))
  return args
}

function main() {
  const version = readVersion(ROOT)
  const releaseDir = path.join(ROOT, 'release')
  const iconFile = path.join(ROOT, 'branding', 'icon.ico')
  const outFile = resolveInstallerPath(ROOT, version)

  const missing = missingReleaseEntries(releaseDir)
  if (missing.length > 0) {
    console.error('[installer] release 产物不完整，缺少：')
    for (const m of missing) console.error(`           ${m}`)
    console.error('           请先执行 npm run package（完整自包含打包）')
    process.exit(1)
  }
  if (!existsSync(iconFile)) {
    console.error(`[installer] 缺少约定图标 ${iconFile}（branding/icon.ico）`)
    process.exit(1)
  }

  const nsiPath = resolveNsiPath(ROOT)
  mkdirSync(path.dirname(nsiPath), { recursive: true })
  writeFileSync(nsiPath, buildNsiScript({ version, releaseDir, outFile, iconFile }))
  console.log(`[installer] 已生成 NSIS 脚本：${nsiPath}`)

  const makensis = findMakensis() || 'makensis.exe'
  const args = buildMakensisArgs(nsiPath, iconFile)
  console.log(`[installer] 运行：${makensis} ${args.join(' ')}`)
  const r = spawnSync(makensis, args, { stdio: 'inherit', windowsHide: true, cwd: ROOT })
  if (r.error) {
    console.error(`[installer] 无法运行 makensis（${r.error.message}）`)
    console.error('            请安装 NSIS 3.x：https://nsis.sourceforge.io/Download（或设 NSIS_HOME）')
    process.exit(1)
  }
  if (r.status !== 0) {
    console.error(`[installer] makensis 失败（exit=${r.status}）`)
    process.exit(r.status ?? 1)
  }
  if (!existsSync(outFile)) {
    console.error(`[installer] 未生成预期产物：${outFile}`)
    process.exit(1)
  }
  rmSync(nsiPath, { force: true })
  console.log(`\n[installer] 完成：${outFile}`)
  console.log('[installer] 双击安装即可（向导 → 开始菜单/桌面快捷方式 → 启动即 Wails 窗口）')
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
}
