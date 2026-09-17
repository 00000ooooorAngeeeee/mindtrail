// Wails 壳启动器（S5：Electron 退役后，GUI 验收脚本统一改用它拉起真实桌面端）。
//
// 背景：原脚本直接 spawn `desktop/node_modules/electron/dist/electron.exe` 并加载内建静态服务器；
// 现打包态桌面端是 Wails(Go) 壳，壳自身负责：初始化并拉起便携 MySQL → 拉起后端 app-image →
// 开 WebView2 窗口加载 http://127.0.0.1:17860（后端同源服务前端）→ 关窗反序清理。
// 因此脚本不再需要静态服务器与 TRAILMIND_DEV_URL，只需把壳拉起来并等 CDP 就绪。
//
// 远程调试：WebView2 通过环境变量 WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS 透传浏览器开关，
// 传入 --remote-debugging-port 后即可用与 Chromium 相同的 CDP 协议驱动（脚本里的 Cdp 类无需改动）。
//
// 关键逻辑（纯函数）单测见 scripts/test/shell-launcher.test.mjs。
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import path from 'node:path'

/** 壳 exe 名（与 desktop/wails/wails.json 的 outputfilename 一致）。 */
export const SHELL_EXE_NAME = 'trailmind-shell.exe'

/** release/ 相对仓库根（打包脚本 scripts/package-desktop.mjs 组装目标）。 */
export const RELEASE_DIR_NAME = 'release'

/** wails build 的产物相对仓库根。 */
export function resolveBuildOutputPath(root, exeName = SHELL_EXE_NAME) {
  return path.join(root, 'desktop', 'wails', 'build', 'bin', exeName)
}

/** 打包组装产物（release/<壳 exe>，与 mysql/、trailmind-backend/ 同级）。 */
export function resolveReleaseShellPath(root, exeName = SHELL_EXE_NAME) {
  return path.join(root, RELEASE_DIR_NAME, exeName)
}

/**
 * 选择要拉起的壳 exe：优先 release 组装产物（自包含，含 mysql/ 与 trailmind-backend/），
 * 回退 wails build 裸产物；都不存在则返回 null（调用方报错并给出构建命令）。
 */
export function resolveShellExe(root, exists = existsSync, exeName = SHELL_EXE_NAME) {
  const candidates = [resolveReleaseShellPath(root, exeName), resolveBuildOutputPath(root, exeName)]
  for (const p of candidates) {
    if (exists(p)) return p
  }
  return null
}

/** WebView2 用户数据目录：%LOCALAPPDATA%\<exe 名>\EBWebView（与 Chromium --user-data-dir 语义一致）。 */
export function resolveWebViewDataDir(localAppData, exeName = SHELL_EXE_NAME) {
  return path.join(localAppData, exeName, 'EBWebView')
}

/** DevToolsActivePort 文件：`<首行 端口>\n<次行 browser ws 路径>`。 */
export function resolveDevToolsActivePortPath(userDataDir) {
  return path.join(userDataDir, 'DevToolsActivePort')
}

/** 解析 DevToolsActivePort 内容为端口；格式不符返回 null。 */
export function parseDevToolsActivePort(content) {
  if (!content) return null
  const first = String(content).split(/\r?\n/)[0]?.trim()
  if (!/^\d+$/.test(first || '')) return null
  const port = Number(first)
  return port > 0 && port <= 65535 ? port : null
}

/**
 * 构造壳进程环境变量：
 * - WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS：注入远程调试端口（+ 可选额外开关，如断网死代理）；
 * - APPDATA：数据根（壳据此定位 %APPDATA%\TrailMind\db 与 run.json）——验收脚本指到工作区，避免污染真实数据；
 * - LOCALAPPDATA：WebView2 用户数据根。
 */
export function buildShellEnv(baseEnv, { cdpPort, appDataRoot, localAppDataRoot, extraBrowserArgs = [] } = {}) {
  const env = { ...baseEnv }
  const args = [`--remote-debugging-port=${cdpPort}`, ...extraBrowserArgs]
  env.WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = args.join(' ')
  if (appDataRoot) env.APPDATA = appDataRoot
  if (localAppDataRoot) env.LOCALAPPDATA = localAppDataRoot
  return env
}

/** 返回查询 CDP 端点 `/json/list` 的 URL。 */
export function cdpListUrl(port) {
  return `http://127.0.0.1:${port}/json/list`
}

/**
 * 过滤出真正的页面目标：WebView2 会同时暴露 about:blank 与多个后台目标，
 * 只取 `type === 'page'` 且 url 指向本应用（17860），优先最靠后的（最后创建的主窗口）。
 */
export function pickPageTarget(targets, backendPort = 17860) {
  if (!Array.isArray(targets)) return null
  const pages = targets.filter((t) => t?.type === 'page' && typeof t.webSocketDebuggerUrl === 'string')
  if (pages.length === 0) return null
  const appPages = pages.filter((t) => !t.url || t.url === 'about:blank' || t.url.includes(`:${backendPort}`))
  const pool = appPages.length > 0 ? appPages : pages
  return pool[pool.length - 1]
}

/** 拉起壳进程（不等待就绪；就绪由 waitForPageTarget 判定）。 */
export function spawnShell(exePath, env, opts = {}) {
  return spawn(exePath, [], {
    stdio: 'ignore',
    windowsHide: true,
    detached: false,
    env,
    ...opts,
  })
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/**
 * 等待 CDP 出现可用页面目标（壳完成 初始化库→起后端→开窗 之后才会出现）。
 * 两条判定路径：① 已知端口轮询 /json/list；② 读 WebView2 的 DevToolsActivePort 兜底（端口被系统重分配时）。
 * 返回 { target, port }。
 */
export async function waitForPageTarget({
  port,
  backendPort = 17860,
  timeoutMs = 180000,
  intervalMs = 500,
  userDataDir,
  fetchImpl = fetch,
} = {}) {
  const deadline = Date.now() + timeoutMs
  const seen = new Set()
  while (Date.now() < deadline) {
    const candidates = []
    if (port) candidates.push(port)
    if (userDataDir) {
      try {
        const p = parseDevToolsActivePort(readFileSync(resolveDevToolsActivePortPath(userDataDir), 'utf8'))
        if (p) candidates.push(p)
      } catch { /* 文件尚未生成 */ }
    }
    for (const p of candidates) {
      if (!seen.has(p)) seen.add(p)
      try {
        const res = await fetchImpl(cdpListUrl(p))
        const list = await res.json()
        const target = pickPageTarget(list, backendPort)
        if (target) return { target, port: p }
      } catch { /* CDP 尚未就绪 */ }
    }
    await sleep(intervalMs)
  }
  const where = userDataDir ? `（已探测端口：${[...seen].join(', ') || '无'}；userData=${userDataDir}）` : ''
  throw new Error(`等待壳窗口页面目标超时（CDP ${timeoutMs}ms）${where}`)
}

/** 确保 WebView2 用户数据目录存在（壳首次启动会自建，显式创建便于脚本读 DevToolsActivePort）。 */
export function ensureWebViewDataDir(userDataDir) {
  mkdirSync(userDataDir, { recursive: true })
  return userDataDir
}
