// M4 任务七 性能回归（04 §8 全部预算复测，07 §7 任务七）：
// 在真实 Electron 应用中复测 N1（画布 500 节点：缩放/平移 ≥45fps + 增删改响应 ≤100ms）与
// N2（时间线 1000 条：首屏 ≤500ms + 分页耗时），N3（搜索 1 万条 ≤1s）复用 scripts/perf-search.mjs，
// N4（启动 ≤3s）为打包安装环境待办，本脚本附带测量「后端 jar 拉起 → 页面可交互」耗时作参考。
//
// 驱动方式与 verify-m2-gui.mjs 一致（CDP + 页面内合成事件，全部走真实 DOM 事件流水线）：
// - 缩放 = d3-zoom wheel 通道：合成 WheelEvent（bubbles）到 .react-flow__pane
// - 平移 = d3-zoom mousedown 通道（画布模式 panOnDrag=[1,2] 右键）：合成 mousedown(button:2) + mousemove + mouseup
// - 帧率 = rAF 计数器（与 verify-m2-gui.mjs S6 同款）
// - 交互响应 = 页面内 performance.now() 打点 + 轮询状态变化（避免 CDP 往返噪声污染计时）
// 前置：MySQL 已启动；frontend/dist 与 backend/target/trailmind-backend-0.0.1.jar 已构建（node scripts/build.mjs）。
// 用法：node scripts/perf-regression.mjs
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { spawn, execFile } from 'node:child_process'
import { gridContent } from './verify-m2-gui.mjs'

// 本地 DB 凭据不提交；Electron 主进程会自行从仓库根 .env 加载，本脚本也读一份供 mysql CLI 灌数据。
try { process.loadEnvFile(new URL('../.env', import.meta.url)) } catch { /* 无 .env 时回落 shell 环境变量 */ }

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const STATIC_PORT = 5178
const CDP_PORT = 9223
const BACKEND_PORT = 17860
const BACKEND_BASE = `http://127.0.0.1:${BACKEND_PORT}`
const FRONTEND_URL = `http://127.0.0.1:${STATIC_PORT}`
const OUT_DIR = path.join(ROOT, 'scripts', 'out', 'perf-regression')

// 预算（04 §8 / 02 §NFR）
export const BUDGET = {
  canvasZoomFps: 45, // N1：500 节点缩放/平移 ≥45fps
  editResponseMs: 100, // N1：节点增删改响应 ≤100ms
  timelineFirstScreenMs: 500, // N2：1000 条目首屏 ≤500ms
}

// 纯函数：由 rAF 计数样本计算帧率（单测覆盖）。
export function fpsOf({ frames, dtMs }) {
  if (!dtMs || dtMs <= 0) return 0
  return (frames / dtMs) * 1000
}

// 纯函数：汇总性能回归结果（单测覆盖）。
export function summarizePerf(results) {
  const failed = results.filter((r) => !r.ok)
  const lines = results.map((r) => `  ${r.ok ? '✓' : '✗'} ${r.name}${r.ok ? '' : ' — ' + r.error}`)
  return { pass: failed.length === 0, message: (failed.length === 0 ? 'PERF-REGRESSION: ALL PASS' : 'PERF-REGRESSION: FAILED') + '\n' + lines.join('\n') }
}

// ---------- 内建静态服务器（frontend/dist + /api 代理到后端，与 verify-m2-gui.mjs 同构） ----------
function startStaticServer() {
  const dist = path.join(ROOT, 'frontend', 'dist')
  const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff2': 'font/woff2' }
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, FRONTEND_URL)
    if (url.pathname.startsWith('/api/')) {
      const proxied = http.request({ host: '127.0.0.1', port: BACKEND_PORT, path: url.pathname + url.search, method: req.method, headers: { ...req.headers, host: `127.0.0.1:${BACKEND_PORT}` } }, (pr) => {
        res.writeHead(pr.statusCode, pr.headers)
        pr.pipe(res)
      })
      proxied.on('error', () => { res.writeHead(502); res.end('backend unavailable') })
      req.pipe(proxied)
      return
    }
    let filePath = path.join(dist, url.pathname === '/' ? 'index.html' : url.pathname)
    if (!filePath.startsWith(dist)) { res.writeHead(403); res.end(); return }
    if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) filePath = path.join(dist, 'index.html')
    res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath).toLowerCase()] ?? 'application/octet-stream' })
    fs.createReadStream(filePath).pipe(res)
  })
  return new Promise((resolve) => server.listen(STATIC_PORT, '127.0.0.1', () => resolve(server)))
}

// ---------- CDP 客户端（Node 内建 WebSocket，零第三方依赖） ----------
class Cdp {
  constructor(wsUrl) {
    this.ws = new WebSocket(wsUrl)
    this.nextId = 1
    this.pending = new Map()
  }
  async open() {
    await new Promise((resolve, reject) => {
      this.ws.onopen = resolve
      this.ws.onerror = () => reject(new Error('CDP WebSocket 连接失败'))
    })
    this.ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data)
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id)
        this.pending.delete(msg.id)
        msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result)
      }
      if (msg.method === 'Runtime.exceptionThrown') {
        const d = msg.params.exceptionDetails
        console.log(`[page-error] ${d.text} ${d.exception?.description ?? ''}`)
      }
    }
  }
  send(method, params = {}) {
    const id = this.nextId++
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.ws.send(JSON.stringify({ id, method, params }))
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id)
          reject(new Error(`CDP 超时：${method}`))
        }
      }, 20000)
    })
  }
  close() { try { this.ws.close() } catch { /* 忽略 */ } }
}

async function findPageTarget() {
  const res = await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)
  const targets = await res.json()
  return targets.find((t) => t.type === 'page' && t.url.startsWith(FRONTEND_URL))
}

async function waitForPageTarget(timeoutMs = 60000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const target = await findPageTarget()
      if (target) return target
    } catch { /* CDP 尚未就绪 */ }
    await sleep(500)
  }
  throw new Error('等待 Electron 页面目标超时（CDP 未就绪）')
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function rest(method, pathname, body) {
  const res = await fetch(`${BACKEND_BASE}/api/v1${pathname}`, {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  return res.json()
}

function portListening(port) {
  return new Promise((resolve) => {
    const s = http.get(`http://127.0.0.1:${port}/api/v1/health`, (r) => { r.resume(); s.destroy(); resolve(true) })
    s.on('error', () => { s.destroy(); resolve(false) })
    s.setTimeout(800, () => { s.destroy(); resolve(false) })
  })
}

async function killTree(pid) {
  if (!pid) return
  await new Promise((resolve) => execFile('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true }, () => resolve()))
}

function mysql(sql) {
  return new Promise((resolve, reject) => {
    execFile(
      'mysql',
      ['-h127.0.0.1', '-uroot', '--default-character-set=utf8mb4', '-N', '-e', sql],
      { env: { ...process.env, MYSQL_PWD: process.env.DB_PASS || '' }, windowsHide: true },
      (err, stdout) => (err ? reject(new Error(`MySQL 失败：${err.message}`)) : resolve((stdout || '').trim())),
    )
  })
}

const results = []
// 注意参数顺序：(ok, name, error)——与 verify-m2-gui.mjs 的 check 一致
const check = (ok, name, error) => results.push({ name, ok: !!ok, ...(error ? { error } : {}) })

/** 页面驱动子集：evaluate/waitFor/合成事件/截图/帧率注入（与 verify-m2-gui.mjs 同款实现）。 */
function makeDriver(cdp) {
  const evaluate = async (expression) => {
    const r = await cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
    if (r.exceptionDetails) throw new Error(`页面执行异常：${r.exceptionDetails.text} ${r.exceptionDetails.exception?.description ?? ''}`)
    return r.result?.value
  }
  const waitFor = async (expression, desc, timeoutMs = 15000) => {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      try { if (await evaluate(expression)) return } catch { /* 页面导航中，重试 */ }
      await sleep(250)
    }
    throw new Error(`等待超时：${desc}`)
  }
  const screenshot = async (name) => {
    const r = await cdp.send('Page.captureScreenshot', { format: 'png' })
    const file = path.join(OUT_DIR, `${name}.png`)
    fs.writeFileSync(file, Buffer.from(r.data, 'base64'))
    return file
  }
  const mouseOn = async (selector, type, x, y, init = {}) =>
    evaluate(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return false
      el.dispatchEvent(new MouseEvent(${JSON.stringify(type)}, { bubbles: true, cancelable: true, view: window, clientX: ${x}, clientY: ${y}, ...${JSON.stringify(init)} })); return true })()`)
  const mouseOnBody = (type, x, y, init = {}) =>
    evaluate(`document.body.dispatchEvent(new MouseEvent(${JSON.stringify(type)}, { bubbles: true, cancelable: true, view: window, clientX: ${x}, clientY: ${y}, ...${JSON.stringify(init)} }))`)
  const key = async (keyName, { ctrl = false } = {}) => {
    await evaluate(`document.body.dispatchEvent(new KeyboardEvent('keydown', { key: ${JSON.stringify(keyName)}, code: ${JSON.stringify(keyName)}, ctrlKey: ${ctrl}, bubbles: true, cancelable: true }))`)
    await evaluate(`document.body.dispatchEvent(new KeyboardEvent('keyup', { key: ${JSON.stringify(keyName)}, code: ${JSON.stringify(keyName)}, ctrlKey: ${ctrl}, bubbles: true, cancelable: true }))`)
  }
  const clickText = (selector, text) => evaluate(
    `(() => { const b = [...document.querySelectorAll(${JSON.stringify(selector)})].find(x => x.textContent.includes(${JSON.stringify(text)})); if (!b) return false; b.click(); return true })()`,
  )
  const statusbarText = () => evaluate(`document.querySelector('.mm-statusbar')?.textContent ?? ''`)
  const nodeCountText = () => evaluate(
    `(document.querySelector('.mm-statusbar')?.textContent ?? '').match(/(\\d+) 节点/)?.[1]`,
  )
  const viewportTransform = () => evaluate(
    `(() => { const t = (document.querySelector('.react-flow__viewport')?.style.transform) || ''
      const m = t.match(/translate\\((-?[\\d.]+)px, (-?[\\d.]+)px\\) scale\\(([\\d.]+)\\)/)
      return m ? { px: parseFloat(m[1]), py: parseFloat(m[2]), zoom: parseFloat(m[3]) } : { px: 0, py: 0, zoom: 1 } })()`,
  )
  /**
   * 帧率采样：启动 rAF 计数器；stop 后返回 { frames, dtMs }。
   * 反后台化：脚本已带 --disable-renderer-backgrounding，agent 环境窗口遮挡下 rAF 仍运行。
   */
  const fpsStart = () => evaluate(`window.__fps = { n: 0, t0: 0, running: false }
    window.__fpsTick = (t) => { if (!window.__fps.running) return; window.__fps.n++; if (t - window.__fps.t0 < 4000) requestAnimationFrame(window.__fpsTick) }
    window.__fpsStart = () => { window.__fps.running = true; window.__fps.t0 = performance.now(); requestAnimationFrame(window.__fpsTick) }
    window.__fpsStop = () => { window.__fps.running = false; return { frames: window.__fps.n, dtMs: performance.now() - window.__fps.t0 } }`)
  const fpsStop = () => evaluate(`window.__fpsStop()`)
  /**
   * 缩放采样：持续注入 wheel 事件（d3-zoom wheel 通道）约 durMs，返回帧率样本。
   * 恒定放大方向（deltaY 恒 -120）：fitView 后 zoom 常停在 minZoom=0.2 下界，若正负交替注入，
   * 结束时 zoom 恰好回落到初始值（0.20→0.20）会被误判「注入未生效」；单方向放大必然越过边界。
   */
  const sampleZoomFps = async (durMs = 2500) => {
    await fpsStart() // 先注入 rAF 计数器定义
    await evaluate(`(() => {
      const pane = document.querySelector('.react-flow__pane')
      const r = pane.getBoundingClientRect()
      window.__fpsStart()
      const iv = setInterval(() => {
        pane.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: -120, clientX: r.x + r.width / 2, clientY: r.y + r.height / 2 }))
      }, 16)
      setTimeout(() => { clearInterval(iv); window.__fpsStop() }, ${durMs})
      return true })()`)
    await sleep(durMs + 400)
    return await fpsStop()
  }
  /** 平移采样：持续右键拖拽（d3-zoom mousedown 通道，panOnDrag=[1,2]）约 durMs，返回帧率样本。 */
  const samplePanFps = async (durMs = 2500) => {
    await fpsStart() // 先注入 rAF 计数器定义
    await evaluate(`(() => {
      const pane = document.querySelector('.react-flow__pane')
      const r = pane.getBoundingClientRect()
      const cx = r.x + r.width / 2, cy = r.y + r.height / 2
      pane.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window, clientX: cx, clientY: cy, button: 2, buttons: 2 }))
      window.__fpsStart()
      let step = 0
      const iv = setInterval(() => {
        step++
        document.body.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, cancelable: true, view: window, clientX: cx + step * 4, clientY: cy + step * 2, button: 2, buttons: 2 }))
      }, 16)
      setTimeout(() => {
        clearInterval(iv)
        document.body.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: window, clientX: cx + step * 4, clientY: cy + step * 2, button: 2, buttons: 0 }))
        window.__fpsStop()
      }, ${durMs})
      return true })()`)
    await sleep(durMs + 400)
    return await fpsStop()
  }
  return { evaluate, waitFor, screenshot, key, clickText, viewportTransform, sampleZoomFps, samplePanFps }
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true })
  let electron = null
  let staticServer = null
  let cdp = null
  const ts = Date.now()
  const wsName = `性能回归-${ts}`
  let wid = null
  let mid = null
  let sid = null

  try {
    console.log('[perf-regression] 启动静态服务器（frontend/dist + /api 代理）…')
    staticServer = await startStaticServer()

    console.log('[perf-regression] 拉起 Electron（自动拉起后端 jar，CDP 端口 9223）…')
    const electronBin = path.join(ROOT, 'desktop', 'node_modules', 'electron', 'dist', 'electron.exe')
    const env = { ...process.env, TRAILMIND_DEV_URL: FRONTEND_URL }
    delete env.ELECTRON_RUN_AS_NODE
    // userData 指到工作区内：agent 沙箱环境对 %APPDATA% 只读，Electron 写单实例锁/DevToolsActivePort
    // 会失败崩溃（实测 FATAL: platform_channel）。独立 user-data-dir 同时避免与真实用户实例互斥。
    const userDataDir = path.join(OUT_DIR, 'userdata')
    const tLaunch = Date.now()
    electron = spawn(electronBin, [
      `--remote-debugging-port=${CDP_PORT}`,
      `--user-data-dir=${userDataDir}`,
      '--disable-renderer-backgrounding',
      '--disable-background-timer-throttling',
      '--disable-features=CalculateNativeWinOcclusion',
      '.',
    ], {
      cwd: path.join(ROOT, 'desktop'), env, stdio: 'ignore', windowsHide: true,
    })
    electron.on('exit', () => {})

    const target = await waitForPageTarget()
    // 页面目标出现 = Electron 已完成后端健康等待并加载前端 → 后端已就绪。
    // N4 参考数据（正式 N4 验收仍为打包安装环境待办，见 docs/10 §10）
    const backendUpMs = Date.now() - tLaunch

    cdp = new Cdp(target.webSocketDebuggerUrl)
    await cdp.open()
    await cdp.send('Runtime.enable')
    await cdp.send('Page.enable')
    const d = makeDriver(cdp)

    // ---------- 数据准备 ----------
    console.log('[perf-regression] 数据准备：工作区 + 500 节点导图 + 1000 条目会话')
    wid = (await rest('POST', '/workspaces', { name: wsName })).data.id
    mid = (await rest('POST', `/workspaces/${wid}/mindmaps`, { name: '性能500节点' })).data.id
    const big = await rest('GET', `/mindmaps/${mid}`)
    const tSave = Date.now()
    await rest('PUT', `/mindmaps/${mid}`, { contentJson: JSON.stringify(gridContent(500)), updatedAt: big.data.updatedAt })
    const saveMs = Date.now() - tSave
    check(saveMs <= 2000, `500 节点整图保存 ${saveMs}ms（参考，防抖落库）`)

    const sess = await rest('POST', `/workspaces/${wid}/sessions`, { title: '性能时间线' })
    sid = sess?.data?.id
    if (!sid) throw new Error(`会话创建失败：${JSON.stringify(sess)}`)
    const tSeed = Date.now()
    for (let batch = 0; batch < 10; batch++) {
      const rows = []
      for (let i = 0; i < 100; i++) {
        const seq = batch * 100 + i + 1
        rows.push(`(${sid},${seq},'note','性能条目 第${seq}条：${'内容'.repeat(20)}')`)
      }
      await mysql(`INSERT INTO trailmind.entry (session_id, seq, type, content_md) VALUES ${rows.join(',')}`)
    }
    const seedMs = Date.now() - tSeed
    check(true, `灌入 1000 条条目耗时 ${seedMs}ms`)

    await d.evaluate(`location.reload()`).catch(() => {})
    await d.waitFor(`[...document.querySelectorAll('.workspace-item .item-name')].some(b => b.textContent.includes(${JSON.stringify(wsName)}))`, '工作区列表出现验收工作区', 20000)

    // ---------- N1：画布 500 节点缩放/平移帧率 + 增删改响应 ----------
    await d.clickText('.workspace-item .item-name', wsName)
    await d.waitFor(`[...document.querySelectorAll('.workspace-item')].some(li => li.textContent.includes('性能500节点'))`, '导图列表出现 500 节点导图')
    await d.evaluate(`(() => { const li = [...document.querySelectorAll('.workspace-item')].find(li => li.textContent.includes('性能500节点'))
      const b = [...li.querySelectorAll('button')].find(x => x.textContent.trim() === '打开'); b.click(); return true })()`)
    await d.waitFor(`!!document.querySelector('.mm-canvas') && (document.querySelector('.mm-statusbar')?.textContent ?? '').includes('501 节点')`, '500 节点导图加载（501 节点）', 20000)

    // 树状模式打开：验证 501 节点 DOM 渲染（树布局 O(n) 未卡死）
    const treeNodeCount = await d.evaluate(`document.querySelectorAll('.react-flow__node').length`)
    check(treeNodeCount === 501, `树状模式 501 节点 DOM 渲染（N1 前置）`, `DOM ${treeNodeCount}`)

    // 切画布模式 → 500 节点自由画布
    await d.clickText('.mm-mode-switch button', '画布')
    await d.waitFor(`(document.querySelector('.mm-statusbar')?.textContent ?? '').includes('画布模式')`, '切到画布模式')
    await sleep(1200) // 等 fitView 与节点测量
    const canvasCount = await d.evaluate(`document.querySelectorAll('.react-flow__node').length`)
    check(canvasCount === 501, `画布模式 501 节点渲染（N1 前置）`, `DOM ${canvasCount}`)

    // N1a：缩放帧率 ≥45fps（wheel 注入 ~2.5s）
    const zoomBefore = (await d.viewportTransform()).zoom
    const zoomSample = await d.sampleZoomFps(2500)
    const zoomFps = fpsOf(zoomSample)
    const zoomAfter = (await d.viewportTransform()).zoom
    check(
      zoomFps >= BUDGET.canvasZoomFps && zoomAfter !== zoomBefore,
      `N1 缩放帧率 ${zoomFps.toFixed(1)}fps ≥ ${BUDGET.canvasZoomFps}fps（zoom ${zoomBefore.toFixed(2)}→${zoomAfter.toFixed(2)}）`,
      zoomAfter === zoomBefore ? '视口 zoom 未变化（wheel 注入未生效）' : undefined,
    )

    // N1b：平移帧率 ≥45fps（右键拖拽 ~2.5s）
    const panBefore = await d.viewportTransform()
    const panSample = await d.samplePanFps(2500)
    const panFps = fpsOf(panSample)
    const panAfter = await d.viewportTransform()
    const panned = Math.abs(panAfter.px - panBefore.px) > 5 || Math.abs(panAfter.py - panBefore.py) > 5
    check(
      panFps >= BUDGET.canvasZoomFps && panned,
      `N1 平移帧率 ${panFps.toFixed(1)}fps ≥ ${BUDGET.canvasZoomFps}fps（位移 ${(panAfter.px - panBefore.px).toFixed(0)},${(panAfter.py - panBefore.py).toFixed(0)}px）`,
      !panned ? '视口未平移（mousedown 注入未生效）' : undefined,
    )
    await d.screenshot('01-canvas-500')

    // N1c：节点增删改响应 ≤100ms（页面内打点，避免 CDP 往返污染）
    const addMs = await d.evaluate(`new Promise((resolve) => {
      const before = (document.querySelector('.mm-statusbar')?.textContent ?? '').match(/(\\d+) 节点/)?.[1]
      const t0 = performance.now()
      document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'n', code: 'n', ctrlKey: true, bubbles: true, cancelable: true }))
      const iv = setInterval(() => {
        const now = (document.querySelector('.mm-statusbar')?.textContent ?? '').match(/(\\d+) 节点/)?.[1]
        if (now && now !== before) { clearInterval(iv); resolve(Math.round(performance.now() - t0)) }
      }, 8)
      setTimeout(() => { clearInterval(iv); resolve(-1) }, 3000)
    })`)
    check(addMs >= 0 && addMs <= BUDGET.editResponseMs, `N1 添加节点响应 ${addMs}ms ≤ ${BUDGET.editResponseMs}ms`)

    const delMs = await d.evaluate(`new Promise((resolve) => {
      window.__origConfirm = window.confirm; window.confirm = () => true
      // 先点选一个非根节点（根节点 n1 不可删）
      const node = [...document.querySelectorAll('.react-flow__node')].find(n => n.getAttribute('data-id') !== 'n1')
      if (!node) { resolve(-3); return }
      const r = node.getBoundingClientRect()
      node.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window, clientX: r.x + r.width / 2, clientY: r.y + r.height / 2, buttons: 1 }))
      node.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: window, clientX: r.x + r.width / 2, clientY: r.y + r.height / 2, buttons: 0 }))
      node.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window, clientX: r.x + r.width / 2, clientY: r.y + r.height / 2, buttons: 0, detail: 1 }))
      const before = (document.querySelector('.mm-statusbar')?.textContent ?? '').match(/(\\d+) 节点/)?.[1]
      // 等 React 选中态生效（selected 类出现）再按 Delete，避免选中未提交时 Delete 无目标
      const t0 = performance.now()
      const iv = setInterval(() => {
        const selected = !!node.querySelector('.mm-node.selected')
        if (selected) {
          clearInterval(iv)
          const t1 = performance.now()
          document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', code: 'Delete', bubbles: true, cancelable: true }))
          const iv2 = setInterval(() => {
            const now = (document.querySelector('.mm-statusbar')?.textContent ?? '').match(/(\\d+) 节点/)?.[1]
            if (now && now !== before) { clearInterval(iv2); window.confirm = window.__origConfirm; resolve(Math.round(performance.now() - t1)) }
          }, 8)
          setTimeout(() => { clearInterval(iv2); window.confirm = window.__origConfirm; resolve(-1) }, 3000)
          return
        }
        if (performance.now() - t0 > 3000) { clearInterval(iv); window.confirm = window.__origConfirm; resolve(-2) }
      }, 8)
    })`)
    check(delMs >= 0 && delMs <= BUDGET.editResponseMs, `N1 删除节点响应 ${delMs}ms ≤ ${BUDGET.editResponseMs}ms`)

    // 编辑响应：双击任意节点进入编辑态（500 节点画布上的 DOM 命中）
    const editMs = await d.evaluate(`new Promise((resolve) => {
      const node = document.querySelector('.react-flow__node')
      if (!node) { resolve(-2); return }
      const el = node.querySelector('.mm-node') ?? node
      const r = el.getBoundingClientRect()
      const t0 = performance.now()
      el.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true, view: window, clientX: r.x + r.width / 2, clientY: r.y + r.height / 2, detail: 2 }))
      const iv = setInterval(() => {
        if (document.querySelector('.mm-node-input')) { clearInterval(iv); resolve(Math.round(performance.now() - t0)) }
      }, 8)
      setTimeout(() => { clearInterval(iv); resolve(-1) }, 3000)
    })`)
    check(editMs >= 0 && editMs <= BUDGET.editResponseMs, `N1 编辑响应（双击进编辑态）${editMs}ms ≤ ${BUDGET.editResponseMs}ms`)
    // Enter 提交退出编辑态（与应用真实交互一致；Escape 无退出处理）
    await d.evaluate(`(() => { const ta = document.querySelector('.mm-node-input'); if (!ta) return false
      const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set
      setter.call(ta, '性能编辑提交'); ta.dispatchEvent(new Event('input', { bubbles: true })); return true })()`)
    await d.evaluate(`document.querySelector('.mm-node-input').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true, cancelable: true }))`)
    await d.waitFor(`!document.querySelector('.mm-node-input')`, '编辑提交退出编辑态', 8000)

    // 回工作区（导图编辑器返回按钮在 .mm-toolbar）→ 打开 1000 条目会话
    await d.evaluate(`(() => { const b = document.querySelector('.mm-toolbar button'); b?.click(); return true })()`)
    await d.waitFor(`[...document.querySelectorAll('.workspace-item')].some(li => li.textContent.includes('性能时间线'))`, '会话列表出现性能会话', 10000)

    // ---------- N2：时间线 1000 条首屏 ≤500ms（页面内打点：点击会话 → 首屏条目渲染完成） ----------
    const firstScreenMs = await d.evaluate(`new Promise((resolve) => {
      const li = [...document.querySelectorAll('.workspace-item')].find(li => li.textContent.includes('性能时间线'))
      if (!li) { resolve(-2); return }
      const btn = li.querySelector('.item-name')
      if (!btn) { resolve(-3); return }
      const t0 = performance.now()
      btn.click()
      const iv = setInterval(() => {
        const cards = document.querySelectorAll('.entry-list .entry-card').length
        if (cards >= 50) { clearInterval(iv); resolve(Math.round(performance.now() - t0)) }
      }, 8)
      setTimeout(() => { clearInterval(iv); resolve(-1) }, 5000)
    })`)
    check(
      firstScreenMs >= 0 && firstScreenMs <= BUDGET.timelineFirstScreenMs,
      `N2 时间线 1000 条首屏 ${firstScreenMs}ms ≤ ${BUDGET.timelineFirstScreenMs}ms（50 条渲染完成）`,
    )
    await d.waitFor(`document.querySelectorAll('.entry-list .entry-card').length === 50`, '首屏 50 条')
    await d.screenshot('02-timeline')

    // N2 附：第 20 页分页 API 耗时（无限滚动翻页，04 §8「分页/无限滚动」）
    const tPage = Date.now()
    const page20 = await rest('GET', `/sessions/${sid}?page=20&size=50`)
    const pageMs = Date.now() - tPage
    check(page20?.code === 0 && page20?.data?.entries?.length > 0, `N2 第 20 页分页 ${pageMs}ms（翻页流畅参考）`)

    // N4 参考：后端 jar 拉起 → 页面可交互（正式验收为打包安装环境待办，07 §3）
    check(true, `N4 参考：Electron 拉起后端 jar → 页面可交互 ${backendUpMs}ms（含健康等待；正式 N4 验收仍为打包安装环境待办）`)

    // 清理
    await rest('DELETE', `/workspaces/${wid}`)
    wid = null
    await d.evaluate(`window.close()`).catch(() => {})
    await sleep(1200)
  } catch (e) {
    results.push({ name: '流程异常', ok: false, error: e.message })
  } finally {
    if (wid != null) await rest('DELETE', `/workspaces/${wid}`).catch(() => {})
    if (electron && electron.exitCode === null) await killTree(electron.pid).catch(() => {})
    try { cdp?.close() } catch { /* 忽略 */ }
    try { staticServer?.close() } catch { /* 忽略 */ }
  }
}

async function mainEntry() {
  console.log('[perf-regression] M4 任务七 性能回归（04 §8 全预算复测）开始')
  try {
    await main()
  } catch (e) {
    results.push({ name: '流程异常', ok: false, error: e.message })
  }
  const { pass, message } = summarizePerf(results)
  console.log(message)
  console.log(`[perf-regression] 截图目录：${OUT_DIR}`)
  process.exit(pass ? 0 : 1)
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
if (isMain) await mainEntry()
