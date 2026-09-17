// NSIS 安装包脚本生成器单测（node:test）。
// 覆盖：产物命名、release 布局校验、makensis 定位、参数构造、.nsi 内容要点（递归打包/快捷方式/卸载保留数据/约定式图标）。
import { test } from 'node:test'
import assert from 'node:assert'
import path from 'node:path'
import {
  APP_DIR_NAME,
  APP_DISPLAY_NAME,
  REQUIRED_RELEASE_ENTRIES,
  SHELL_EXE_NAME,
  buildMakensisArgs,
  buildNsiScript,
  findMakensis,
  installerName,
  missingReleaseEntries,
  readVersion,
  resolveInstallerPath,
  resolveNsiPath,
  toNsisPath,
} from '../package-installer.mjs'

const ROOT = 'D:\\t'
const RELEASE = path.join(ROOT, 'release')

test('installerName / resolveInstallerPath / resolveNsiPath', () => {
  assert.strictEqual(installerName('0.0.1'), 'TrailMind-Setup-0.0.1.exe')
  assert.strictEqual(resolveInstallerPath(ROOT, '0.0.1'), path.join(ROOT, 'release', 'TrailMind-Setup-0.0.1.exe'))
  assert.strictEqual(resolveNsiPath(ROOT), path.join(ROOT, 'release', 'trailmind-installer.nsi'))
})

test('readVersion：取 package.json 版本号', () => {
  const v = readVersion(process.cwd())
  assert.match(v, /^\d+\.\d+\.\d+$/)
})

test('requiredReleaseEntries：含壳 exe、便携库与后端 app-image', () => {
  assert.ok(REQUIRED_RELEASE_ENTRIES.includes(SHELL_EXE_NAME))
  assert.ok(REQUIRED_RELEASE_ENTRIES.includes(path.join('mysql', 'bin', 'mysqld.exe')))
  assert.ok(REQUIRED_RELEASE_ENTRIES.includes(path.join('trailmind-backend', 'trailmind-backend.exe')))
})

test('missingReleaseEntries：齐全返回空、缺项逐个报出', () => {
  assert.deepStrictEqual(missingReleaseEntries(RELEASE, () => true), [])
  const missing = missingReleaseEntries(RELEASE, (p) => !p.includes('mysqld.exe'))
  assert.deepStrictEqual(missing, [path.join('mysql', 'bin', 'mysqld.exe')])
})

test('toNsisPath：统一反斜杠（makensis 要求）', () => {
  assert.strictEqual(toNsisPath('D:/a/b/icon.ico'), 'D:\\a\\b\\icon.ico')
})

test('findMakensis：NSIS_HOME 优先', () => {
  const env = { NSIS_HOME: 'D:\\nsis', 'ProgramFiles(x86)': 'C:\\PF86' }
  const got = findMakensis(env, (p) => p === path.join('D:\\nsis', 'makensis.exe'))
  assert.strictEqual(got, path.join('D:\\nsis', 'makensis.exe'))
})

test('findMakensis：回退 Program Files(x86)/Program Files/LOCALAPPDATA', () => {
  const env = { 'ProgramFiles(x86)': 'C:\\PF86', ProgramFiles: 'C:\\PF', LOCALAPPDATA: 'C:\\LA' }
  const target = path.join('C:\\PF', 'NSIS', 'makensis.exe')
  assert.strictEqual(findMakensis(env, (p) => p === target), target)
})

test('findMakensis：均不存在返回 null（调用方回落 PATH）', () => {
  assert.strictEqual(findMakensis({}, () => false), null)
})

test('buildMakensisArgs：/V2 + 约定式图标 + 脚本路径', () => {
  const args = buildMakensisArgs('D:\\t\\release\\a.nsi', 'D:/t/branding/icon.ico')
  assert.deepStrictEqual(args, ['/V2', '/DICON_FILE=D:\\t\\branding\\icon.ico', 'D:\\t\\release\\a.nsi'])
  assert.deepStrictEqual(buildMakensisArgs('D:\\t\\a.nsi'), ['/V2', 'D:\\t\\a.nsi'])
})

test('buildNsiScript：递归打包 release 整份布局（含 mysql 与后端）', () => {
  const nsi = buildNsiScript({ version: '0.0.1', releaseDir: RELEASE, outFile: 'D:\\t\\release\\setup.exe', iconFile: 'D:\\t\\branding\\icon.ico' })
  assert.match(nsi, /File \/r "D:\\t\\release\\\*\.\*"/)
  assert.match(nsi, /OutFile "D:\\t\\release\\setup\.exe"/)
  assert.match(nsi, /Unicode true/)
})

test('buildNsiScript：安装目录在 Program Files、快捷方式指向壳 exe', () => {
  const nsi = buildNsiScript({ version: '0.0.1', releaseDir: RELEASE, outFile: 'D:\\o.exe', iconFile: '' })
  assert.ok(nsi.includes(`InstallDir "$PROGRAMFILES64\\${'${APP_DIR}'}"`), '安装目录应为 $PROGRAMFILES64\\${APP_DIR}')
  assert.match(nsi, /CreateShortCut "\$SMPROGRAMS[^\n]*\$\{SHELL_EXE\}/)
  assert.match(nsi, /CreateShortCut "\$DESKTOP[^\n]*\$\{SHELL_EXE\}/)
  assert.ok(nsi.includes(APP_DISPLAY_NAME))
})

test('buildNsiScript：卸载保留用户数据并给出提示', () => {
  const nsi = buildNsiScript({ version: '0.0.1', releaseDir: RELEASE, outFile: 'D:\\o.exe', iconFile: '' })
  assert.match(nsi, /用户数据保留在 %APPDATA%\\TrailMind/)  // 脚本里为转义形式，见下一断言
  assert.match(nsi, /DeleteRegKey HKLM "Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall/)
})

test('buildNsiScript：有/无图标两种情况（安装包 + 卸载程序图标同源）', () => {
  const withIcon = buildNsiScript({ version: '1.2.3', releaseDir: RELEASE, outFile: 'D:\\o.exe', iconFile: 'D:\\t\\branding\\icon.ico' })
  assert.match(withIcon, /MUI_ICON "D:\\t\\branding\\icon\.ico"/)
  assert.match(withIcon, /MUI_UNICON "D:\\t\\branding\\icon\.ico"/)
  const noIcon = buildNsiScript({ version: '1.2.3', releaseDir: RELEASE, outFile: 'D:\\o.exe', iconFile: '' })
  assert.ok(!/MUI_ICON/.test(noIcon))
  assert.ok(!/MUI_UNICON/.test(noIcon))
})

test('buildNsiScript：版本号进入产物与注册表', () => {
  const nsi = buildNsiScript({ version: '9.9.9', releaseDir: RELEASE, outFile: 'D:\\o.exe', iconFile: '' })
  assert.match(nsi, /APP_VERSION "9\.9\.9"/)
  assert.match(nsi, /"DisplayVersion" "\$\{APP_VERSION\}"/)
})
