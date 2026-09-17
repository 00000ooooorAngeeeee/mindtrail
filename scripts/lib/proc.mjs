// 进程工具（S5：Electron 壳退役后，原 desktop/main/backend-process.js 的 killProcessTree 迁到此）。
// 供 scripts/dev.mjs、scripts/launch.mjs 与各 GUI 验收脚本共用；纯 Node，无 Electron 依赖。
import { execFile } from 'node:child_process'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/** 仓库根（scripts/lib/ 上溯两级）。 */
export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')

/** taskkill 参数构造（纯函数，便于单测）：/T 连带子进程、/F 强制。 */
export function buildTaskkillArgs(pid) {
  return ['/PID', String(pid), '/T', '/F']
}

/** 是否为本机回环地址（连接审计用）：127.0.0.0/8、::1、localhost。 */
export function isLoopback(addr) {
  if (!addr) return false
  const a = String(addr).trim().toLowerCase()
  if (a === 'localhost' || a === '::1' || a === '[::1]') return true
  if (a.startsWith('::ffff:127.')) return true
  return /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(a)
}

/** 终止进程及其整棵子树（Windows taskkill /T /F）；pid 无效时静默返回。 */
export function killProcessTree(pid) {
  return new Promise((resolve) => {
    if (!pid) return resolve()
    execFile('taskkill', buildTaskkillArgs(pid), { windowsHide: true }, () => resolve())
  })
}

/** 同步版（脚本收尾、进程即将退出时用）。 */
export function killProcessTreeSync(pid, execFileSyncImpl) {
  if (!pid) return
  try {
    execFileSyncImpl('taskkill', buildTaskkillArgs(pid), { windowsHide: true, stdio: 'ignore' })
  } catch { /* 进程已退出或权限不足 */ }
}

/** 读取根 .env（DB_USER/DB_PASS 等本地敏感配置不入库）；无 .env 时静默跳过。 */
export function loadEnvFile(root = ROOT) {
  try {
    process.loadEnvFile(path.join(root, '.env'))
  } catch { /* 无 .env：回落到 shell 环境变量 */ }
}

/** PID 是否存活（沙箱下 tasklist/Get-CimInstance 可能被拒，故用信号 0 探活）。 */
export function isAlive(pid) {
  if (!pid) return false
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

/** 供调试：把文件读成字符串（失败返回空串）。 */
export function readTextSafe(file) {
  try {
    return readFileSync(file, 'utf8')
  } catch {
    return ''
  }
}
