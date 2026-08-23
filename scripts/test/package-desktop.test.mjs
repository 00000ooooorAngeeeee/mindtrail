// 桌面端打包脚本关键逻辑单测（node:test，无第三方依赖）。
// 覆盖纯函数：MariaDB 下载 URL/命名、vendor 路径、就位判定、Wails 图标/exe 路径、release 组装清单（docs/08 §6 DoD「关键逻辑补单测」）。
import { test } from 'node:test'
import assert from 'node:assert'
import path from 'node:path'
import {
  SHELL_APP_NAME,
  mariadbZipName,
  mariadbExtractedDir,
  mariadbZipUrl,
  resolveVendorDir,
  resolveMariaDbDir,
  resolveMariaDbBin,
  isMariaDbDownloaded,
  resolveShellIcon,
  resolveShellBuildDir,
  resolveShellExe,
  resolveBackendAppImage,
  resolveReleaseDir,
  buildReleaseLayout,
} from '../package-desktop.mjs'

test('mariadbZipUrl：archive.mariadb.org winx64-packages 路径', () => {
  assert.strictEqual(mariadbZipUrl('11.4.5'), 'https://archive.mariadb.org/mariadb-11.4.5/winx64-packages/mariadb-11.4.5-winx64.zip')
})

test('mariadbZipName / mariadbExtractedDir：命名约定一致', () => {
  assert.strictEqual(mariadbZipName('11.4.5'), 'mariadb-11.4.5-winx64.zip')
  assert.strictEqual(mariadbExtractedDir('11.4.5'), 'mariadb-11.4.5-winx64')
})

test('resolveVendorDir / resolveMariaDbDir / resolveMariaDbBin：vendor/mariadb/bin', () => {
  const v = resolveVendorDir('D:\\t')
  assert.strictEqual(v, path.join('D:\\t', 'desktop', 'vendor'))
  assert.strictEqual(resolveMariaDbDir(v), path.join(v, 'mariadb'))
  assert.strictEqual(resolveMariaDbBin(v), path.join(v, 'mariadb', 'bin'))
})

test('isMariaDbDownloaded：三 exe 齐全才算就位', () => {
  const all = (p) => ['mariadbd.exe', 'mariadb-install-db.exe', 'mysqladmin.exe'].includes(path.basename(p))
  assert.strictEqual(isMariaDbDownloaded('C:\\v\\bin', all), true)
  const missingAdmin = (p) => path.basename(p) !== 'mysqladmin.exe'
  assert.strictEqual(isMariaDbDownloaded('C:\\v\\bin', missingAdmin), false)
})

test('resolveShellIcon：branding→desktop/wails/build/windows/icon.ico 约定路径', () => {
  assert.strictEqual(resolveShellIcon('D:\\t'), path.join('D:\\t', 'desktop', 'wails', 'build', 'windows', 'icon.ico'))
})

test('resolveShellExe：wails build/bin/<app>.exe', () => {
  assert.strictEqual(resolveShellExe(resolveShellBuildDir('D:\\t')), path.join('D:\\t', 'desktop', 'wails', 'build', 'bin', `${SHELL_APP_NAME}.exe`))
})

test('resolveBackendAppImage / resolveReleaseDir', () => {
  assert.strictEqual(resolveBackendAppImage('D:\\t'), path.join('D:\\t', 'backend', 'target', 'trailmind-backend'))
  assert.strictEqual(resolveReleaseDir('D:\\t'), path.join('D:\\t', 'release'))
})

test('buildReleaseLayout：壳 exe + 后端 app-image + mariadb 平铺到 release/', () => {
  const layout = buildReleaseLayout({ shellExe: 'D:\\shell.exe', backendAppImage: 'D:\\backend', mariadbDir: 'D:\\mariadb' })
  assert.deepStrictEqual(layout, [
    { from: 'D:\\shell.exe', to: `${SHELL_APP_NAME}.exe`, isDir: false },
    { from: 'D:\\backend', to: 'trailmind-backend', isDir: true },
    { from: 'D:\\mariadb', to: 'mariadb', isDir: true },
  ])
})
