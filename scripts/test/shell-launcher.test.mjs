// Wails 壳启动器关键逻辑单测（node:test，无第三方依赖）。
// 覆盖：壳 exe 解析优先级、WebView2 用户数据/DevToolsActivePort 路径与解析、
// 壳进程环境构造（远程调试开关 + APPDATA/LOCALAPPDATA 重定向）、页面目标筛选、就绪等待的三条分支。
import { test } from 'node:test'
import assert from 'node:assert'
import { existsSync, rmSync } from 'node:fs'
import path from 'node:path'
import {
  SHELL_EXE_NAME,
  cdpListUrl,
  buildShellEnv,
  ensureWebViewDataDir,
  parseDevToolsActivePort,
  pickPageTarget,
  resolveBuildOutputPath,
  resolveDevToolsActivePortPath,
  resolveReleaseShellPath,
  resolveShellExe,
  resolveWebViewDataDir,
  waitForPageTarget,
} from '../lib/shell-launcher.mjs'

const ROOT = 'D:\\t'

test('壳 exe 名与 release/build 路径', () => {
  assert.strictEqual(SHELL_EXE_NAME, 'trailmind-shell.exe')
  assert.strictEqual(resolveReleaseShellPath(ROOT), path.join(ROOT, 'release', 'trailmind-shell.exe'))
  assert.strictEqual(resolveBuildOutputPath(ROOT), path.join(ROOT, 'desktop', 'wails', 'build', 'bin', 'trailmind-shell.exe'))
})

test('resolveShellExe：优先 release 组装产物', () => {
  const rel = resolveReleaseShellPath(ROOT)
  const build = resolveBuildOutputPath(ROOT)
  assert.strictEqual(resolveShellExe(ROOT, (p) => p === rel || p === build), rel)
})

test('resolveShellExe：release 缺失时回退 wails build 产物', () => {
  const build = resolveBuildOutputPath(ROOT)
  assert.strictEqual(resolveShellExe(ROOT, (p) => p === build), build)
})

test('resolveShellExe：都不存在返回 null', () => {
  assert.strictEqual(resolveShellExe(ROOT, () => false), null)
})

test('WebView2 用户数据目录与 DevToolsActivePort 路径', () => {
  const dir = resolveWebViewDataDir('C:\\Users\\x\\AppData\\Local')
  assert.strictEqual(dir, path.join('C:\\Users\\x\\AppData\\Local', SHELL_EXE_NAME, 'EBWebView'))
  assert.strictEqual(resolveDevToolsActivePortPath(dir), path.join(dir, 'DevToolsActivePort'))
})

test('parseDevToolsActivePort：首行端口 + 次行 ws 路径', () => {
  assert.strictEqual(parseDevToolsActivePort('9333\n/devtools/browser/abc\r\n'), 9333)
  assert.strictEqual(parseDevToolsActivePort('9222'), 9222)
  assert.strictEqual(parseDevToolsActivePort('not-a-port\n/x'), null)
  assert.strictEqual(parseDevToolsActivePort(''), null)
  assert.strictEqual(parseDevToolsActivePort(undefined), null)
  assert.strictEqual(parseDevToolsActivePort('99999\n/x'), null)
})

test('buildShellEnv：注入远程调试开关与数据根', () => {
  const env = buildShellEnv({ PATH: 'x' }, {
    cdpPort: 9222,
    appDataRoot: 'E:\\iso\\appdata',
    localAppDataRoot: 'E:\\iso\\localappdata',
  })
  assert.strictEqual(env.WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS, '--remote-debugging-port=9222')
  assert.strictEqual(env.APPDATA, 'E:\\iso\\appdata')
  assert.strictEqual(env.LOCALAPPDATA, 'E:\\iso\\localappdata')
  assert.strictEqual(env.PATH, 'x')
  assert.strictEqual(env.ELECTRON_RUN_AS_NODE, undefined)
})

test('buildShellEnv：断网模拟附加死代理开关', () => {
  const env = buildShellEnv({}, { cdpPort: 9223, extraBrowserArgs: ['--proxy-server=http://127.0.0.1:9', '--proxy-bypass-list=127.0.0.1;localhost'] })
  assert.match(env.WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS, /--remote-debugging-port=9223/)
  assert.match(env.WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS, /--proxy-server=http:\/\/127\.0\.0\.1:9/)
})

test('cdpListUrl', () => {
  assert.strictEqual(cdpListUrl(9222), 'http://127.0.0.1:9222/json/list')
})

test('pickPageTarget：跳过非 page 目标，优先本应用页面', () => {
  const targets = [
    { type: 'browser', webSocketDebuggerUrl: 'ws://x/b' },
    { type: 'page', url: 'about:blank', webSocketDebuggerUrl: 'ws://x/blank' },
    { type: 'page', url: 'http://127.0.0.1:17860/', webSocketDebuggerUrl: 'ws://x/app' },
    { type: 'service_worker', url: 'http://127.0.0.1:17860/sw', webSocketDebuggerUrl: 'ws://x/sw' },
  ]
  assert.strictEqual(pickPageTarget(targets, 17860).webSocketDebuggerUrl, 'ws://x/app')
})

test('pickPageTarget：多页面时取最后创建的主窗口', () => {
  const targets = [
    { type: 'page', url: 'http://127.0.0.1:17860/a', webSocketDebuggerUrl: 'ws://x/1' },
    { type: 'page', url: 'http://127.0.0.1:17860/b', webSocketDebuggerUrl: 'ws://x/2' },
  ]
  assert.strictEqual(pickPageTarget(targets, 17860).webSocketDebuggerUrl, 'ws://x/2')
})

test('pickPageTarget：无 page 目标返回 null', () => {
  assert.strictEqual(pickPageTarget([{ type: 'browser' }], 17860), null)
  assert.strictEqual(pickPageTarget(null, 17860), null)
  assert.strictEqual(pickPageTarget([], 17860), null)
})

test('waitForPageTarget：轮询到页面目标即返回（含端口）', async () => {
  let calls = 0
  const fetchImpl = async (url) => {
    calls++
    assert.strictEqual(url, cdpListUrl(9222))
    if (calls < 3) throw new Error('ECONNREFUSED')
    return { json: async () => [{ type: 'page', url: 'http://127.0.0.1:17860/', webSocketDebuggerUrl: 'ws://x/app' }] }
  }
  const got = await waitForPageTarget({ port: 9222, timeoutMs: 500, intervalMs: 1, fetchImpl })
  assert.strictEqual(got.port, 9222)
  assert.strictEqual(got.target.webSocketDebuggerUrl, 'ws://x/app')
  assert.strictEqual(calls, 3)
})

test('waitForPageTarget：超时抛错并带上探测信息', async () => {
  await assert.rejects(
    () => waitForPageTarget({ port: 9222, timeoutMs: 15, intervalMs: 1, fetchImpl: async () => ({ json: async () => [] }) }),
    /等待壳窗口页面目标超时/,
  )
})

test('ensureWebViewDataDir：创建目录并返回同一路径', () => {
  // 用工作区内路径（受限环境下不可写盘外目录）；跑完即删，保持仓库干净
  const dir = path.join(process.cwd(), '.tmp-test-webview-userdata', SHELL_EXE_NAME, 'EBWebView')
  try {
    assert.strictEqual(ensureWebViewDataDir(dir), dir)
    assert.strictEqual(existsSync(dir), true)
  } finally {
    rmSync(path.join(process.cwd(), '.tmp-test-webview-userdata'), { recursive: true, force: true })
  }
})
