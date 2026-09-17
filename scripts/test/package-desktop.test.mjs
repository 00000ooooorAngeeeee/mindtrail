// 桌面端打包脚本关键逻辑单测（node:test，无第三方依赖）。
// 覆盖纯函数：便携 MySQL 下载 URL/命名/缓存定位、vendor 路径、就位判定、Wails 图标/exe 路径、release 组装清单（docs/08 §6 DoD「关键逻辑补单测」）。
// 2026-08-24 由 MariaDB 改绑 MySQL（MariaDB 不支持 MySQL `WITH PARSER ngram`，见设计文档 §10）。
import { test } from 'node:test'
import assert from 'node:assert'
import path from 'node:path'
import {
  SHELL_APP_NAME,
  MYSQL_VERSION,
  mysqlZipName,
  mysqlExtractedDir,
  mysqlZipUrl,
  majorMinor,
  resolveVendorDir,
  resolveMySQLDir,
  resolveMySQLBin,
  resolveMySQLCacheDir,
  isMySQLReady,
  locateExtractedMySQL,
  resolveShellIcon,
  resolveShellBuildDir,
  resolveShellExe,
  resolveBackendAppImage,
  resolveReleaseDir,
  buildReleaseLayout,
} from '../package-desktop.mjs'

test('mysqlZipUrl：dev.mysql.com/get 下载路径（按 minor 系列分目录）', () => {
  assert.strictEqual(mysqlZipUrl('8.4.6'), 'https://dev.mysql.com/get/Downloads/MySQL-8.4/mysql-8.4.6-winx64.zip')
  assert.strictEqual(mysqlZipUrl('8.0.45'), 'https://dev.mysql.com/get/Downloads/MySQL-8.0/mysql-8.0.45-winx64.zip')
})

test('majorMinor：版本号取 major.minor', () => {
  assert.strictEqual(majorMinor('8.4.6'), '8.4')
  assert.strictEqual(majorMinor('8'), '8')
})

test('mysqlZipName / mysqlExtractedDir：命名约定一致', () => {
  assert.strictEqual(mysqlZipName('8.4.6'), 'mysql-8.4.6-winx64.zip')
  assert.strictEqual(mysqlExtractedDir('8.4.6'), 'mysql-8.4.6-winx64')
})

test('MYSQL_VERSION 缺省为 8.4 LTS 系列', () => {
  assert.match(MYSQL_VERSION, /^8\.4\./)
})

test('resolveVendorDir / resolveMySQLDir / resolveMySQLBin：vendor/mysql/bin', () => {
  const v = resolveVendorDir('D:\\t')
  assert.strictEqual(v, path.join('D:\\t', 'desktop', 'vendor'))
  assert.strictEqual(resolveMySQLDir(v), path.join(v, 'mysql'))
  assert.strictEqual(resolveMySQLBin(v), path.join(v, 'mysql', 'bin'))
})

test('resolveMySQLCacheDir：缓存键含版本号（升级不复用旧版本）', () => {
  const v = resolveVendorDir('D:\\t')
  assert.strictEqual(resolveMySQLCacheDir(v, '8.4.6'), path.join(v, 'mysql-cache', '8.4.6'))
  assert.notStrictEqual(resolveMySQLCacheDir(v, '8.4.7'), resolveMySQLCacheDir(v, '8.4.6'))
})

test('isMySQLReady：mysqld + mysqladmin 齐全才算就位', () => {
  const all = (p) => ['mysqld.exe', 'mysqladmin.exe'].includes(path.basename(p))
  assert.strictEqual(isMySQLReady('C:\\v\\bin', all), true)
  const missingAdmin = (p) => path.basename(p) !== 'mysqladmin.exe'
  assert.strictEqual(isMySQLReady('C:\\v\\bin', missingAdmin), false)
  assert.strictEqual(isMySQLReady('C:\\v\\bin', () => false), false)
})

test('locateExtractedMySQL：优先 zip 顶层目录，其次已是 bin 结构', () => {
  const dir = 'C:\\v\\cache'
  const nested = path.join(dir, 'mysql-8.4.6-winx64')
  assert.strictEqual(locateExtractedMySQL(dir, '8.4.6', (p) => p === nested), nested)
  assert.strictEqual(locateExtractedMySQL(dir, '8.4.6', (p) => p === path.join(dir, 'bin')), dir)
  assert.strictEqual(locateExtractedMySQL(dir, '8.4.6', () => false), null)
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

test('buildReleaseLayout：壳 exe + 后端 app-image + mysql 平铺到 release/', () => {
  const layout = buildReleaseLayout({ shellExe: 'D:\\shell.exe', backendAppImage: 'D:\\backend', mysqlDir: 'D:\\mysql' })
  assert.deepStrictEqual(layout, [
    { from: 'D:\\shell.exe', to: `${SHELL_APP_NAME}.exe`, isDir: false },
    { from: 'D:\\backend', to: 'trailmind-backend', isDir: true },
    { from: 'D:\\mysql', to: 'mysql', isDir: true },
  ])
})
