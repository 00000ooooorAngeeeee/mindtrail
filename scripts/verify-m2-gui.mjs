// M2 总验收 GUI 实机验证（docs/07 §5 验收清单）：
// 拉起真实 Electron 应用（dev 态经 TRAILMIND_DEV_URL 加载本脚本内建静态服务器上的前端产物，
// Electron 主进程自动拉起后端 jar），经 Chrome DevTools Protocol（CDP，Node 24 内建 WebSocket）
// 在真实页面内注入合成事件驱动交互（节点拖拽/连线/框选/双击编辑/快捷键），
// 逐项验证 M2 验收清单，截图存档 scripts/out/m2-gui/（.gitignore 已忽略 out/）。
//
// 事件注入要点（本会话实机调试得出，勿改回 CDP Input）：
// - CDP Input.dispatchKeyEvent/MouseEvent 在 Electron 窗口失焦时不达页面；故全部走页面内合成事件
// - d3-drag（XYFlow 节点拖拽）监听 mousedown 且依赖 event.view 注册 move 监听：合成 MouseEvent 必须带 view: window
// - 连线手柄是 React onPointerDown（PointerEvent）+ document 级 mousemove/mouseup；move/up 从 body 冒泡同时覆盖 document 与 window 两层
// - 键盘走 window 上的合成 KeyboardEvent（应用监听 window keydown）
//
// 前置：MySQL 已启动；frontend/dist 与 backend/target/trailmind-backend-0.0.1.jar 已构建（node scripts/build.mjs）。
// 用法：node scripts/verify-m2-gui.mjs
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { spawn, execFile } from 'node:child_process'

// 本地 DB 凭据不提交；Electron 主进程会自行从仓库根 .env 加载，本脚本也读一份供 API 冒烟兜底。
try { process.loadEnvFile(new URL('../.env', import.meta.url)) } catch { /* 无 .env 时回落 shell 环境变量 */ }

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const STATIC_PORT = 5177
const CDP_PORT = 9222
const BACKEND_PORT = 17860
const BACKEND_BASE = `http://127.0.0.1:${BACKEND_PORT}`
const FRONTEND_URL = `http://127.0.0.1:${STATIC_PORT}`
const OUT_DIR = path.join(ROOT, 'scripts', 'out', 'm2-gui')

// 纯函数：生成 N 个业务节点 + 1 根的画布网格内容（10 列网格布局，全部挂在根下，严格树）。单测覆盖。
export function gridContent(count = 100) {
  const nodes = {
    n1: {
      id: 'n1', text: '百节点根', note: '', style: { color: 'default', bold: false, shape: 'rounded' },
      tags: [], parentId: null, layout: { x: -240, y: 405 }, collapsed: false, sticky: false,
    },
  }
  const cols = 10
  for (let i = 1; i <= count; i++) {
    const id = `n${i + 1}`
    nodes[id] = {
      id, text: `节点${i}`, note: '', style: { color: 'default', bold: false, shape: 'rounded' },
      tags: [], parentId: 'n1',
      layout: { x: ((i - 1) % cols) * 220, y: Math.floor((i - 1) / cols) * 90 },
      collapsed: false, sticky: false,
    }
  }
  return { version: 1, rootNodeId: 'n1', nodes, edges: [] }
}

// ---------- 内建静态服务器：serve frontend/dist + /api 代理到后端（开发期 Vite 的同构替代，避免依赖 esbuild 子进程） ----------
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

// ---------- CDP 客户端（Node 24 内建 WebSocket，零第三方依赖） ----------
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
      // 页面运行时异常/控制台错误原样打印，便于定位白屏类缺陷
      if (msg.method === 'Runtime.exceptionThrown') {
        const d = msg.params.exceptionDetails
        console.log(`[page-error] ${d.text} ${d.exception?.description ?? ''}`)
      }
      if (msg.method === 'Log.entryAdded' && ['error', 'warning'].includes(msg.params.entry.level)) {
        console.log(`[page-log] ${msg.params.entry.text}`)
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
      }, 15000)
    })
  }
  close() { try { this.ws.close() } catch { /* 忽略 */ } }
}

async function findPageTarget() {
  const res = await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)
  const targets = await res.json()
  return targets.find((t) => t.type === 'page' && t.url.startsWith(FRONTEND_URL))
}

async function waitForPageTarget(timeoutMs = 45000) {
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

// ---------- 工具函数 ----------
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

const results = []
const check = (name, ok, error) => results.push({ name, ok: !!ok, ...(error ? { error } : {}) })

/**
 * 页面驱动会话封装：evaluate/waitFor/合成事件/截图，绑定一个 CDP 连接。
 * 输入全部为页面内合成事件（view: window），驱动真实 DOM 事件流水线与应用逻辑。
 */
function makeDriver(cdp) {
  const evaluate = async (expression) => {
    const r = await cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
    if (r.exceptionDetails) throw new Error(`页面执行异常：${r.exceptionDetails.text} ${r.exceptionDetails.exception?.description ?? ''}`)
    return r.result?.value
  }
  const waitFor = async (expression, desc, timeoutMs = 10000) => {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      try { if (await evaluate(expression)) return } catch { /* 页面导航中，重试 */ }
      await sleep(250)
    }
    let dump = ''
    try { dump = (await evaluate(`document.body.innerText.slice(0, 600)`)) ?? '' } catch { /* 忽略 */ }
    let shot = ''
    try { shot = await screenshot(`fail-${Date.now()}`) } catch { /* 忽略 */ }
    throw new Error(`等待超时：${desc}\n页面文本：${dump}\n截图：${shot}`)
  }
  const waitSaved = () => waitFor(
    `[...document.querySelectorAll('.mm-toolbar-actions button')].some(b => b.textContent.includes('已保存'))`,
    '导图保存完成', 8000,
  )
  const screenshot = async (name) => {
    const r = await cdp.send('Page.captureScreenshot', { format: 'png' })
    const file = path.join(OUT_DIR, `${name}.png`)
    fs.writeFileSync(file, Buffer.from(r.data, 'base64'))
    return file
  }
  // 在指定元素上 dispatch 鼠标事件（view: window 必带，d3-drag 依赖它）；move/up 从 body 冒泡覆盖 document+window 两层监听
  const mouseOn = async (selector, type, x, y, init = {}) =>
    evaluate(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return false
      el.dispatchEvent(new MouseEvent(${JSON.stringify(type)}, { bubbles: true, cancelable: true, view: window, clientX: ${x}, clientY: ${y}, ...${JSON.stringify(init)} })); return true })()`)
  const mouseOnBody = (type, x, y, init = {}) =>
    evaluate(`document.body.dispatchEvent(new MouseEvent(${JSON.stringify(type)}, { bubbles: true, cancelable: true, view: window, clientX: ${x}, clientY: ${y}, ...${JSON.stringify(init)} }))`)
  /** 鼠标拖拽：mousedown 落在 selector 元素上（节点=d3-drag；空白=框选/平移），move/up 走 body。 */
  const dragMouse = async (selector, x1, y1, x2, y2, { steps = 16, totalMs = 300 } = {}) => {
    await mouseOn(selector, 'mousedown', x1, y1, { buttons: 1 })
    for (let i = 1; i <= steps; i++) {
      await mouseOnBody('mousemove', x1 + ((x2 - x1) * i) / steps, y1 + ((y2 - y1) * i) / steps, { buttons: 1 })
      await sleep(totalMs / steps)
    }
    await mouseOnBody('mouseup', x2, y2, { buttons: 0 })
  }
  /** 连线拖拽：手柄绑定 React onMouseDown（类名含 nodrag，不会误触发节点拖拽），连接过程监听 document 级 mousemove/mouseup。 */
  const dragConnect = async (selector, x1, y1, x2, y2, { steps = 12, totalMs = 400 } = {}) => {
    await evaluate(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return false
      el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window, clientX: ${x1}, clientY: ${y1}, buttons: 1 })); return true })()`)
    for (let i = 1; i <= steps; i++) {
      await mouseOnBody('mousemove', x1 + ((x2 - x1) * i) / steps, y1 + ((y2 - y1) * i) / steps, { buttons: 1 })
      await sleep(totalMs / steps)
    }
    await mouseOnBody('mouseup', x2, y2, { buttons: 0 })
  }
  /** 单击/双击（detail=2 走应用 onPaneClick/onDoubleClick 判定）。 */
  const clickMouse = async (selector, x, y, { detail = 1 } = {}) =>
    evaluate(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return false
      el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window, clientX: ${x}, clientY: ${y}, detail: ${detail} })); return true })()`)
  /** 完整点击序列（mousedown+mouseup+click）：真实用户点击的等价注入。React 边选中等交互依赖完整序列（实测仅发 click 不选中边）。 */
  const clickMouseFull = async (selector, x, y, { detail = 1 } = {}) =>
    evaluate(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return false
      el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window, clientX: ${x}, clientY: ${y}, buttons: 1, detail: ${detail} }))
      el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: window, clientX: ${x}, clientY: ${y}, buttons: 0, detail: ${detail} }))
      el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window, clientX: ${x}, clientY: ${y}, buttons: 0, detail: ${detail} }))
      return true })()`)
  /**
   * 画布模式 pane 双击（selectionOnDrag=true 时 pane 的 click 走 pointerup 路径）：
   * 真实双击序列 pointerdown/up ×2（第二对 detail=2），并覆写 setPointerCapture（合成指针无活动 pointerId，否则抛 NotFoundError）。
   */
  const paneDoubleClick = async (selector, x, y) => evaluate(`(() => {
      const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return false
      el.setPointerCapture = () => {}
      el.releasePointerCapture = () => {}
      const fire = (type, cc, extra) => el.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, view: window, clientX: ${x}, clientY: ${y}, pointerId: 21, pointerType: 'mouse', isPrimary: true, detail: cc, ...extra }))
      fire('pointerdown', 1, { button: 0, buttons: 1 })
      fire('pointerup', 1, { button: 0, buttons: 0 })
      fire('pointerdown', 2, { button: 0, buttons: 1 })
      fire('pointerup', 2, { button: 0, buttons: 0 })
      return true })()`)
  /** 画布模式框选：pointer 事件在 pane 上按下-移动-释放（selectionOnDrag 走 XYFlow UserSelection 链路）。 */
  const dragSelect = async (selector, x1, y1, x2, y2, { steps = 10, totalMs = 300 } = {}) => {
    await evaluate(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return false
      el.setPointerCapture = () => {}
      el.releasePointerCapture = () => {}
      el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, view: window, clientX: ${x1}, clientY: ${y1}, pointerId: 22, pointerType: 'mouse', isPrimary: true, button: 0, buttons: 1, detail: 1 }))
      return true })()`)
    for (let i = 1; i <= steps; i++) {
      await evaluate(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return false
        el.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, cancelable: true, view: window, clientX: ${x1 + ((x2 - x1) * i) / steps}, clientY: ${y1 + ((y2 - y1) * i) / steps}, pointerId: 22, pointerType: 'mouse', isPrimary: true, button: -1, buttons: 1, detail: 0 }))
        return true })()`)
      await sleep(totalMs / steps)
    }
    await evaluate(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return false
      el.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true, view: window, clientX: ${x2}, clientY: ${y2}, pointerId: 22, pointerType: 'mouse', isPrimary: true, button: 0, buttons: 0, detail: 1 }))
      return true })()`)
  }
  const dblclickMouse = async (selector, x, y) =>
    evaluate(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return false
      el.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true, view: window, clientX: ${x}, clientY: ${y}, detail: 2 })); return true })()`)
  /** 快捷键：从 document.body 分发合成 KeyboardEvent（冒泡同时覆盖 document 与 window 两层监听：应用在 window、XYFlow useKeyPress 在 document）。 */
  const key = async (keyName, { ctrl = false, shift = false } = {}) => {
    await evaluate(`document.body.dispatchEvent(new KeyboardEvent('keydown', { key: ${JSON.stringify(keyName)}, code: ${JSON.stringify(keyName)}, ctrlKey: ${ctrl}, shiftKey: ${shift}, bubbles: true, cancelable: true }))`)
    await evaluate(`document.body.dispatchEvent(new KeyboardEvent('keyup', { key: ${JSON.stringify(keyName)}, code: ${JSON.stringify(keyName)}, ctrlKey: ${ctrl}, shiftKey: ${shift}, bubbles: true, cancelable: true }))`)
  }
  /** 在 textarea 上输入文本（React 受控组件走原生 setter + input 事件）后回车提交。 */
  const typeInto = async (selector, text) => {
    await evaluate(`(() => { const ta = document.querySelector(${JSON.stringify(selector)}); if (!ta) return false
      const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set
      setter.call(ta, ${JSON.stringify(text)})
      ta.dispatchEvent(new Event('input', { bubbles: true })); return true })()`)
    await evaluate(`document.querySelector(${JSON.stringify(selector)}).dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true, cancelable: true }))`)
  }
  const clickText = (selector, text) => evaluate(
    `(() => { const b = [...document.querySelectorAll(${JSON.stringify(selector)})].find(x => x.textContent.includes(${JSON.stringify(text)})); if (!b) return false; b.click(); return true })()`,
  )
  const nodeFlowPositions = () => evaluate(
    `(() => [...document.querySelectorAll('.react-flow__node')].map(el => {
      const m = (el.style.transform || '').match(/translate\\((-?[\\d.]+)px, (-?[\\d.]+)px\\)/)
      return { id: el.getAttribute('data-id'), x: m ? parseFloat(m[1]) : NaN, y: m ? parseFloat(m[2]) : NaN }
    }))()`,
  )
  const viewportTransform = () => evaluate(
    `(() => { const t = (document.querySelector('.react-flow__viewport')?.style.transform) || ''
      const m = t.match(/translate\\((-?[\\d.]+)px, (-?[\\d.]+)px\\) scale\\(([\\d.]+)\\)/)
      return m ? { px: parseFloat(m[1]), py: parseFloat(m[2]), zoom: parseFloat(m[3]) } : { px: 0, py: 0, zoom: 1 } })()`,
  )
  const nodeRect = (id) => evaluate(
    `(() => { const el = [...document.querySelectorAll('.react-flow__node')].find(n => n.getAttribute('data-id') === ${JSON.stringify(id)})
      if (!el) return null
      const r = el.getBoundingClientRect()
      return { left: r.x, top: r.y, right: r.x + r.width, bottom: r.y + r.height, cx: r.x + r.width / 2, cy: r.y + r.height / 2, text: el.querySelector('.mm-node-text')?.textContent ?? '' } })()`,
  )
  const handleCenter = (id, kind) => evaluate(
    `(() => { const el = [...document.querySelectorAll('.react-flow__node')].find(n => n.getAttribute('data-id') === ${JSON.stringify(id)})
      const h = el?.querySelector('.react-flow__handle.' + ${JSON.stringify(kind)})
      if (!h) return null
      const r = h.getBoundingClientRect()
      return { cx: r.x + r.width / 2, cy: r.y + r.height / 2 } })()`,
  )
  const freeEdgeCount = () => evaluate(
    `[...document.querySelectorAll('.react-flow__edge')].filter(e => /^e\\d+$/.test(e.getAttribute('data-id') || '')).length`,
  )
  const statusbarText = () => evaluate(`document.querySelector('.mm-statusbar')?.textContent ?? ''`)
  const nodeCountText = () => evaluate(
    `(document.querySelector('.mm-statusbar')?.textContent ?? '').match(/(\\d+) 节点/)?.[1]`,
  )
  return { evaluate, waitFor, waitSaved, screenshot, dragMouse, dragConnect, clickMouse, clickMouseFull, paneDoubleClick, dragSelect, dblclickMouse, key, typeInto, clickText, nodeFlowPositions, viewportTransform, nodeRect, handleCenter, freeEdgeCount, statusbarText, nodeCountText }
}

const nodeSel = (id) => `.react-flow__node[data-id="${id}"]`
const nodeInnerSel = (id) => `.react-flow__node[data-id="${id}"] .mm-node`

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true })
  let electron = null
  let staticServer = null
  let cdp = null
  let cdp2 = null
  const ts = Date.now()
  const wsName = `M2验收-${ts}`
  let wid = null
  let mid1 = null

  try {
    console.log('[m2-gui] 启动静态服务器（frontend/dist + /api 代理）…')
    staticServer = await startStaticServer()

    console.log('[m2-gui] 拉起 Electron（自动拉起后端 jar，CDP 端口 9222）…')
    const electronBin = path.join(ROOT, 'desktop', 'node_modules', 'electron', 'dist', 'electron.exe')
    const env = { ...process.env, TRAILMIND_DEV_URL: FRONTEND_URL }
    delete env.ELECTRON_RUN_AS_NODE
    const launchElectron = () => {
      // 反后台化开关：agent 环境的 Electron 窗口常处于遮挡/后台状态，Chromium 会暂停 rAF 与节流定时器，
      // 导致依赖 rAF 的测量链路（XYFlow ResizeObserver 回调、fitView、useUpdateNodeInternals）冻结。
      // 这些开关让窗口无论可见性如何都保持渲染循环（真实用户前台使用不受影响）。
      const child = spawn(electronBin, [
        `--remote-debugging-port=${CDP_PORT}`,
        '--disable-renderer-backgrounding',
        '--disable-background-timer-throttling',
        '--disable-features=CalculateNativeWinOcclusion',
        '.',
      ], {
        cwd: path.join(ROOT, 'desktop'), env, stdio: 'ignore', windowsHide: true,
      })
      child.on('exit', () => {})
      return child
    }
    electron = launchElectron()

    // 页面目标出现意味着 Electron 已完成后端健康等待并加载前端 → 后端此时可用
    const target = await waitForPageTarget()

    cdp = new Cdp(target.webSocketDebuggerUrl)
    await cdp.open()
    await cdp.send('Runtime.enable')
    await cdp.send('Page.enable')
    await cdp.send('Log.enable')
    const d = makeDriver(cdp)

    // 数据准备（页面首屏已加载完工作区列表，创建后强制刷新一次让列表带出新工作区）
    console.log('[m2-gui] 数据准备：验收工作区 + 主图 + 百节点导图')
    wid = (await rest('POST', '/workspaces', { name: wsName })).data.id
    mid1 = (await rest('POST', `/workspaces/${wid}/mindmaps`, { name: 'M2验收主图' })).data.id
    const mid2 = (await rest('POST', `/workspaces/${wid}/mindmaps`, { name: 'M2验收百节点' })).data.id
    const big = await rest('GET', `/mindmaps/${mid2}`)
    await rest('PUT', `/mindmaps/${mid2}`, { contentJson: JSON.stringify(gridContent(100)), updatedAt: big.data.updatedAt })
    await d.evaluate(`location.reload()`).catch(() => {})

    // ---------- S0：启动 → 工作区 → 打开导图 ----------
    await d.waitFor(`[...document.querySelectorAll('.workspace-item .item-name')].some(b => b.textContent.includes(${JSON.stringify(wsName)}))`, '工作区列表出现验收工作区', 20000)
    // ---------- S0c：工作区创建表单端到端（人工验收反馈：无法输入名称/无法创建） ----------
    const formName = `验收表单-${ts}`
    const formInfo = await d.evaluate(`(() => { const inp = document.querySelector('.create-form input')
      if (!inp) return { found: false }
      // 列表较长时表单在视口下方，先滚动到可见（与真实用户操作一致）再做命中检测
      inp.scrollIntoView({ block: 'center' })
      return { found: true, disabled: inp.disabled } })()`)
    await sleep(300)
    const formHit = await d.evaluate(`(() => { const inp = document.querySelector('.create-form input')
      const r = inp.getBoundingClientRect()
      const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)
      return { hitIsInput: hit === inp, cx: r.x + r.width / 2, cy: r.y + r.height / 2 } })()`)
    check('S0c0 工作区名称输入框可点中且未禁用', formInfo?.found === true && formHit?.hitIsInput === true && formInfo?.disabled === false, JSON.stringify({ ...formInfo, ...formHit }))
    await d.clickMouseFull('.create-form input', formHit.cx, formHit.cy)
    await sleep(200)
    await d.evaluate(`(() => { const inp = document.querySelector('.create-form input')
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
      setter.call(inp, ${JSON.stringify(formName)})
      inp.dispatchEvent(new Event('input', { bubbles: true }))
      return true })()`)
    await sleep(200)
    const btnEnabled = await d.evaluate(`!document.querySelector('.create-form button').disabled`)
    check('S0c1 输入名称后创建按钮启用', btnEnabled === true, `按钮启用=${btnEnabled}`)
    await d.clickText('.create-form button', '创建工作区')
    await d.waitFor(`[...document.querySelectorAll('.workspace-item .item-name')].some(b => b.textContent.includes(${JSON.stringify(formName)}))`, '表单创建的工作区出现在列表', 10000)
    const inputUsable = await d.evaluate(`!document.querySelector('.create-form input').disabled`)
    check('S0c2 创建成功后输入框仍可用（creating 状态复位）', inputUsable === true, `输入框可用=${inputUsable}`)
    await d.clickText('.workspace-item .item-name', wsName)
    await d.waitFor(`[...document.querySelectorAll('.workspace-item')].some(li => li.textContent.includes('M2验收主图'))`, '导图列表出现主图')
    await d.evaluate(`(() => { const li = [...document.querySelectorAll('.workspace-item')].find(li => li.textContent.includes('M2验收主图'))
      const b = [...li.querySelectorAll('button')].find(x => x.textContent.trim() === '打开'); b.click(); return true })()`)
    await d.waitFor(`!!document.querySelector('.mm-canvas') && (document.querySelector('.mm-statusbar')?.textContent ?? '').includes('1 节点')`, '编辑器加载出单根节点')
    check('S0 启动→工作区→打开导图（GUI 可达，编辑器渲染）', true)
    await sleep(600) // 等显式测量（useUpdateNodeInternals 经 setTimeout + rAF）生效
    const nodeVisible = await d.evaluate(`(() => {
      const el = document.querySelector('.react-flow__node')
      if (!el) return { visible: false, reason: '无节点 DOM' }
      const cs = window.getComputedStyle(el)
      const r = el.getBoundingClientRect()
      const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)
      return { visible: cs.visibility === 'visible', hit: hit === el || el.contains(hit) }
    })()`)
    check('S0b 节点已测量且可见（visibility=visible + 命中检测命中节点）', nodeVisible?.visible === true && nodeVisible?.hit === true, JSON.stringify(nodeVisible))
    await d.screenshot('00-editor')

    // ---------- S1：树→画布位置合理 + 自由拖动任意节点 + 坐标持久化 ----------
    await d.key('n', { ctrl: true }) // Ctrl+N ×2 挂根加两个子节点（树状模式）
    await d.key('n', { ctrl: true })
    await d.waitFor(`(document.querySelector('.mm-statusbar')?.textContent ?? '').includes('3 节点')`, 'Ctrl+N 添加 2 个子节点')
    await d.clickText('.mm-mode-switch button', '画布')
    await d.waitFor(`(document.querySelector('.mm-statusbar')?.textContent ?? '').includes('画布模式')`, '切到画布模式')
    await sleep(900) // 等 fitView 动画结束

    const overlapInfo = await d.evaluate(`(() => {
      const rects = [...document.querySelectorAll('.react-flow__node')].map(el => { const r = el.getBoundingClientRect(); return { id: el.getAttribute('data-id'), x: r.x, y: r.y, w: r.width, h: r.height } })
      const overlaps = []
      for (let i = 0; i < rects.length; i++) for (let j = i + 1; j < rects.length; j++) {
        const a = rects[i], b = rects[j]
        const ox = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)
        const oy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y)
        if (ox > 1 && oy > 1) overlaps.push(a.id + '/' + b.id)
      }
      return { count: rects.length, overlaps } })()`)
    check('S1a 树→画布切换后位置合理（平铺无重叠）', overlapInfo.count === 3 && overlapInfo.overlaps.length === 0, `节点 ${overlapInfo.count}、重叠 ${overlapInfo.overlaps.join(' ')}`)

    // 拖第一个空文本子节点（+180,+120 屏幕位移），断言画布坐标按 zoom 等比变化并持久化
    const childId = await d.evaluate(`(() => { const el = [...document.querySelectorAll('.react-flow__node')].find(n => (n.querySelector('.mm-node-text')?.textContent ?? '') === ''); return el?.getAttribute('data-id') ?? null })()`)
    const before = await d.nodeRect(childId)
    const beforeFlow = (await d.nodeFlowPositions()).find((p) => p.id === childId)
    const zoom = (await d.viewportTransform()).zoom
    await d.dragMouse(nodeSel(childId), before.cx, before.cy, before.cx + 180, before.cy + 120)
    await sleep(400)
    const afterFlow = (await d.nodeFlowPositions()).find((p) => p.id === childId)
    const dx = afterFlow.x - beforeFlow.x
    const dy = afterFlow.y - beforeFlow.y
    const expX = 180 / zoom
    const expY = 120 / zoom
    // nodeDragThreshold=1 会消耗首个移动步进（约 1/16 位移），断言按比例落在 [0.88, 1.02] 且方向一致
    const rx = dx / expX
    const ry = dy / expY
    check('S1b 自由拖动节点（画布坐标随拖拽等比变化）', rx > 0.88 && rx < 1.02 && ry > 0.88 && ry < 1.02, `dx=${dx.toFixed(1)}(期望 ${expX.toFixed(1)}) dy=${dy.toFixed(1)}(期望 ${expY.toFixed(1)})`)
    await d.waitSaved()
    const apiAfter = await rest('GET', `/mindmaps/${mid1}`)
    const apiNode = apiAfter?.data?.contentJson ? JSON.parse(apiAfter.data.contentJson).nodes[childId] : null
    check('S1c 拖拽坐标经防抖保存落库（layout 持久化）', apiNode?.layout && Math.abs(apiNode.layout.x - afterFlow.x) <= 1 && Math.abs(apiNode.layout.y - afterFlow.y) <= 1, `layout=${JSON.stringify(apiNode?.layout)}`)
    await d.screenshot('01-canvas-drag')

    // ---------- S2：自由连线 + 切回树状三选一（保持/忽略/仅重排三分支） ----------
    const otherChildId = await d.evaluate(`(() => { const ids = [...document.querySelectorAll('.react-flow__node')].map(n => n.getAttribute('data-id')); return ids.find(id => id !== ${JSON.stringify(childId)} && (document.querySelector('.react-flow__node[data-id="' + id + '"] .mm-node-text')?.textContent ?? '') === '') ?? null })()`)
    const src = await d.handleCenter(childId, 'source')
    const dst = await d.handleCenter(otherChildId, 'target')
    await d.dragConnect(`${nodeSel(childId)} .react-flow__handle.source`, src.cx, src.cy, dst.cx, dst.cy)
    await d.waitFor(`(() => [...document.querySelectorAll('.react-flow__edge')].filter(e => /^e\\d+$/.test(e.getAttribute('data-id') || '')).length === 1)()`, '画布上拖出 1 条自由连线')
    await d.waitSaved()
    const apiEdge = await rest('GET', `/mindmaps/${mid1}`)
    const edgeSaved = JSON.parse(apiEdge.data.contentJson).edges[0]
    check('S2a 自由连线创建并持久化（type=free）', edgeSaved?.type === 'free' && edgeSaved.source === childId && edgeSaved.target === otherChildId, JSON.stringify(edgeSaved))

    await d.clickText('.mm-mode-switch button', '树状')
    await d.waitFor(`!!document.querySelector('.mm-dialog')`, '切回树状弹出非树边三选一')
    check('S2b 非树边切回树状被正确提示（三选一对话框）', true)
    await d.screenshot('02-dialog')
    await d.clickText('.mm-dialog-actions button', '保持画布')
    await d.waitFor(`!document.querySelector('.mm-dialog')`, '保持画布：对话框关闭')
    const stillCanvas = (await d.statusbarText()).includes('画布模式')
    const edgeStill = (await d.freeEdgeCount()) === 1
    check('S2c 三选一「保持画布」：留在画布、边保留', stillCanvas && edgeStill, `模式=${stillCanvas ? '画布' : '树状'} 边数=${await d.freeEdgeCount()}`)

    await d.clickText('.mm-mode-switch button', '树状')
    await d.waitFor(`!!document.querySelector('.mm-dialog')`, '再次弹出三选一')
    await d.clickText('.mm-dialog-actions button', '忽略非树边')
    await d.waitFor(`(document.querySelector('.mm-statusbar')?.textContent ?? '').includes('树状模式')`, '忽略非树边后切回树状')
    await d.waitSaved()
    const apiEdges0 = JSON.parse((await rest('GET', `/mindmaps/${mid1}`)).data.contentJson).edges
    check('S2d 三选一「忽略非树边」：切回树状且自由边删除', apiEdges0.length === 0, `edges=${apiEdges0.length}`)

    await d.clickText('.mm-mode-switch button', '画布')
    await d.waitFor(`(document.querySelector('.mm-statusbar')?.textContent ?? '').includes('画布模式')`, '再切回画布')
    await sleep(600)
    const src2 = await d.handleCenter(childId, 'source')
    const dst2 = await d.handleCenter(otherChildId, 'target')
    await d.dragConnect(`${nodeSel(childId)} .react-flow__handle.source`, src2.cx, src2.cy, dst2.cx, dst2.cy)
    await d.waitFor(`(() => [...document.querySelectorAll('.react-flow__edge')].filter(e => /^e\\d+$/.test(e.getAttribute('data-id') || '')).length === 1)()`, '重建自由连线')
    await d.waitSaved()
    await d.clickText('.mm-mode-switch button', '树状')
    await d.waitFor(`!!document.querySelector('.mm-dialog')`, '第三次弹出三选一')
    await d.clickText('.mm-dialog-actions button', '仅重排树形部分')
    await d.waitFor(`(document.querySelector('.mm-statusbar')?.textContent ?? '').includes('树状模式')`, '仅重排树形部分后切回树状')
    await d.waitSaved()
    const apiEdges1 = JSON.parse((await rest('GET', `/mindmaps/${mid1}`)).data.contentJson).edges
    const freeNotRendered = (await d.freeEdgeCount()) === 0
    check('S2e 三选一「仅重排树形部分」：切回树状且自由边保留（树视图不渲染）', apiEdges1.length === 1 && freeNotRendered, `edges=${apiEdges1.length} 树视图渲染自由边=${await d.freeEdgeCount()}`)

    // ---------- S2f：自由连线删除（人工验收反馈「无法断开连线」回归：选中边 + Delete） ----------
    await d.clickText('.mm-mode-switch button', '画布')
    await d.waitFor(`(document.querySelector('.mm-statusbar')?.textContent ?? '').includes('画布模式')`, 'S2f 切回画布')
    await sleep(600)
    const edgeEl = await d.evaluate(`(() => {
      const el = [...document.querySelectorAll('.react-flow__edge')].find(e => /^e\\d+$/.test(e.getAttribute('data-id') || ''))
      if (!el) return null
      const p = el.querySelector('.react-flow__edge-interaction') ?? el.querySelector('path')
      const r = p.getBoundingClientRect()
      return { id: el.getAttribute('data-id'), cx: r.x + r.width / 2, cy: r.y + r.height / 2 } })()`)
    // 真实命中检测断言：线中点四周 6px 的 elementFromPoint 应命中交互路径（20px 命中带，真实点击等价证据）
    const hitInfo = await d.evaluate(`(() => {
      const pts = [[${edgeEl.cx} + 6, ${edgeEl.cy}], [${edgeEl.cx} - 6, ${edgeEl.cy}], [${edgeEl.cx}, ${edgeEl.cy} + 6], [${edgeEl.cx}, ${edgeEl.cy} - 6]]
      return pts.map(([x, y]) => { const el = document.elementFromPoint(x, y); return !!(el?.closest?.('.react-flow__edge')) }) })()`)
    check('S2f0 自由连线 20px 命中带可点中（elementFromPoint 命中）', hitInfo.some(Boolean) === true, JSON.stringify(hitInfo))
    const strokeBefore = await d.evaluate(`getComputedStyle(document.querySelector('.react-flow__edge.mm-free-edge .react-flow__edge-path')).stroke`)
    await d.clickMouseFull(`.react-flow__edge[data-id="${edgeEl.id}"]`, edgeEl.cx, edgeEl.cy)
    await sleep(300)
    const edgeSelected = await d.evaluate(`(() => { const el = [...document.querySelectorAll('.react-flow__edge')].find(e => /^e\\d+$/.test(e.getAttribute('data-id') || '')); return el ? [...el.classList].includes('selected') : false })()`)
    const strokeAfter = await d.evaluate(`getComputedStyle(document.querySelector('.react-flow__edge.mm-free-edge .react-flow__edge-path')).stroke`)
    check('S2f1 选中边有可见高亮（描边变色）', edgeSelected === true && strokeAfter !== strokeBefore, `${strokeBefore} → ${strokeAfter} 选中=${edgeSelected}`)
    await d.key('Delete')
    await d.waitFor(`(() => [...document.querySelectorAll('.react-flow__edge')].filter(e => /^e\\d+$/.test(e.getAttribute('data-id') || '')).length === 0)()`, 'S2f Delete 断开连线')
    await d.waitSaved()
    const apiEdges2 = JSON.parse((await rest('GET', `/mindmaps/${mid1}`)).data.contentJson).edges
    check('S2f 选中自由边按 Delete 断开连线（edges 清空并落库）', apiEdges2.length === 0, `边点击选中=${edgeSelected} 落库 edges=${apiEdges2.length}`)

    // ---------- S3：两模式间增删改互相同步（B3.4） ----------
    await d.clickText('.mm-mode-switch button', '画布')
    await d.waitFor(`(document.querySelector('.mm-statusbar')?.textContent ?? '').includes('画布模式')`, '切画布')
    await sleep(600)
    const beforeCount = await d.nodeCountText()
    await d.paneDoubleClick('.react-flow__pane', 60, 520) // 双击空白落点加节点（画布模式 pane 双击走 pointer 路径）
    await d.waitFor(`(document.querySelector('.mm-statusbar')?.textContent ?? '').includes(${JSON.stringify(String(Number(beforeCount) + 1) + ' 节点')})`, '双击空白加节点')
    await d.clickText('.mm-mode-switch button', '树状')
    await d.waitFor(`(document.querySelector('.mm-statusbar')?.textContent ?? '').includes('树状模式') || !!document.querySelector('.mm-dialog')`, '切回树状（S2e 保留的自由边会再弹三选一）')
    if (await d.evaluate(`!!document.querySelector('.mm-dialog')`)) {
      await d.clickText('.mm-dialog-actions button', '仅重排树形部分')
    }
    await d.waitFor(`(document.querySelector('.mm-statusbar')?.textContent ?? '').includes('树状模式') && [...document.querySelectorAll('.react-flow__node')].length === ${Number(beforeCount) + 1}`, '树状视图同步看到画布新增节点')
    check('S3a 画布新增节点 → 树状视图同步可见', true)
    // 在树状编辑该节点文本（找唯一空文本节点）
    const newId = await d.evaluate(`(() => { const el = [...document.querySelectorAll('.react-flow__node')].find(n => (n.querySelector('.mm-node-text')?.textContent ?? '') === ''); return el?.getAttribute('data-id') ?? null })()`)
    const newCenter = await d.nodeRect(newId)
    await d.dblclickMouse(nodeInnerSel(newId), newCenter.cx, newCenter.cy)
    await d.waitFor(`!!document.querySelector('.mm-node-input')`, '节点进入编辑态')
    await d.typeInto('.mm-node-input', '跨模式同步节点')
    await d.waitFor(`[...document.querySelectorAll('.mm-node-text')].some(t => t.textContent === '跨模式同步节点')`, '文本提交')
    await d.waitSaved()
    await d.clickText('.mm-mode-switch button', '画布')
    await d.waitFor(`(document.querySelector('.mm-statusbar')?.textContent ?? '').includes('画布模式') && [...document.querySelectorAll('.mm-node-text')].some(t => t.textContent === '跨模式同步节点')`, '画布视图同步看到树状编辑的文本')
    check('S3b 树状编辑文本 → 画布视图同步可见（增删改互相同步）', true)

    // ---------- S7：编辑态交互回归（人工验收反馈修复） ----------
    // 编辑态 textarea 加 nodrag/nopan 后：内部拖拽不再被节点拖拽/画布平移劫持，文本可正常框选与输入
    const editId = await d.evaluate(`(() => { const el = [...document.querySelectorAll('.react-flow__node')].find(n => n.querySelector('.mm-node-text')?.textContent === '跨模式同步节点'); return el?.getAttribute('data-id') ?? null })()`)
    const editCenter = await d.nodeRect(editId)
    await d.dblclickMouse(nodeInnerSel(editId), editCenter.cx, editCenter.cy)
    await d.waitFor(`!!document.querySelector('.mm-node-input')`, 'S7 节点进入编辑态')
    const taRect = await d.evaluate(`(() => { const r = document.querySelector('.mm-node-input').getBoundingClientRect(); return { cx: r.x + r.width / 2, cy: r.y + r.height / 2 } })()`)
    const posBeforeEditDrag = (await d.nodeFlowPositions()).find((p) => p.id === editId)
    await d.dragMouse('.mm-node-input', taRect.cx, taRect.cy, taRect.cx + 60, taRect.cy + 40)
    await sleep(300)
    const posAfterEditDrag = (await d.nodeFlowPositions()).find((p) => p.id === editId)
    const notMoved = Math.abs(posAfterEditDrag.x - posBeforeEditDrag.x) < 0.5 && Math.abs(posAfterEditDrag.y - posBeforeEditDrag.y) < 0.5
    const stillEditing = await d.evaluate(`!!document.querySelector('.mm-node-input')`)
    check('S7a 编辑态内拖拽不拖动节点（文本框选不被劫持）', notMoved && stillEditing === true, `位移=(${posAfterEditDrag.x - posBeforeEditDrag.x}, ${posAfterEditDrag.y - posBeforeEditDrag.y}) 编辑框存活=${stillEditing}`)
    await d.typeInto('.mm-node-input', '编辑态输入回归')
    await d.waitFor(`[...document.querySelectorAll('.mm-node-text')].some(t => t.textContent === '编辑态输入回归')`, 'S7 编辑态输入提交生效')
    check('S7b 编辑态文本可正常输入并提交', true)
    await d.waitSaved()

    // ---------- S4：形状/颜色/加粗 + 便签 + 框选批量 ----------
    await sleep(600)
    const rootId = await d.evaluate(`[...document.querySelectorAll('.react-flow__node')].map(n => n.getAttribute('data-id')).find(id => document.querySelector('.react-flow__node[data-id="' + id + '"] .mm-node-text')?.textContent === '中心主题')`)
    const rootCenter = await d.nodeRect(rootId)
    await d.clickMouse(nodeSel(rootId), rootCenter.cx, rootCenter.cy)
    await d.waitFor(`!!document.querySelector('.mm-style-panel')`, '选中节点出现样式面板')
    await d.evaluate(`document.querySelector('.mm-style-panel button[title="菱形"]')?.click()`)
    await d.evaluate(`document.querySelector('.mm-style-panel .mm-color-swatch[title="靛蓝"]')?.click()`)
    await d.evaluate(`document.querySelector('.mm-style-panel button[title="加粗"]')?.click()`)
    await d.waitFor(`document.querySelector(${JSON.stringify(nodeInnerSel(rootId))})?.className.includes('shape-diamond')`, '根节点变菱形')
    const rootStyleOk = await d.evaluate(`(() => { const el = document.querySelector(${JSON.stringify(nodeInnerSel(rootId))})
      return el.className.includes('shape-diamond') && el.className.includes('bold') && el.style.getPropertyValue('--node-bg') === '#eef1ff' })()`)
    check('S4a 形状（菱形）+ 颜色（靛蓝）+ 加粗即时生效', rootStyleOk === true)
    // 选中一个非根节点后加便签 → 便签应成为该节点的子节点（人工验收反馈）
    const stickyParentId = await d.evaluate(`(() => { const el = [...document.querySelectorAll('.react-flow__node')].find(n => (n.querySelector('.mm-node-text')?.textContent ?? '') === '编辑态输入回归'); return el?.getAttribute('data-id') ?? null })()`)
    const spCenter = await d.nodeRect(stickyParentId)
    await d.clickMouse(nodeSel(stickyParentId), spCenter.cx, spCenter.cy)
    await d.waitFor(`!!document.querySelector('.mm-style-panel')`, 'S4b 选中目标节点')
    await d.clickText('.mm-toolbar-actions button', '便签')
    await d.waitFor(`!!document.querySelector('.mm-node.sticky')`, '＋便签出现无文本便签节点')
    check('S4b 自由便签（无文本纯形状）可添加', true)
    // 把便签拖到左上角（远离后续框选区域，避免框选批量删除把便签卷入；同时验证便签可自由拖动）
    const stickyId = await d.evaluate(`(() => { const el = [...document.querySelectorAll('.react-flow__node')].find(n => n.querySelector('.mm-node.sticky')); return el?.getAttribute('data-id') ?? null })()`)
    const stickyRect = await d.nodeRect(stickyId)
    await d.dragMouse(nodeSel(stickyId), stickyRect.cx, stickyRect.cy, 200, 140)
    await sleep(300)
    await d.waitSaved()
    await d.screenshot('03-style-sticky')
    const apiSaved = JSON.parse((await rest('GET', `/mindmaps/${mid1}`)).data.contentJson)
    const rootSaved = apiSaved.nodes[rootId]
    const stickySaved = Object.values(apiSaved.nodes).find((n) => n.sticky)
    check('S4c 形状/颜色/加粗/便签落库持久化 + 便签挂到选中节点', rootSaved?.style?.shape === 'diamond' && rootSaved?.style?.color === 'indigo' && rootSaved?.style?.bold === true && stickySaved?.text === '' && stickySaved?.parentId === stickyParentId, `样式=${JSON.stringify(rootSaved?.style)} 便签父=${stickySaved?.parentId}(期望 ${stickyParentId})`)

    // 框选两个子节点 → 批量移动 → 批量删除（PRD B2.6）
    const boxNodes = await d.evaluate(`(() => { const els = [...document.querySelectorAll('.react-flow__node')]
      return els.filter(el => (el.querySelector('.mm-node-text')?.textContent ?? '') === '' && !el.querySelector('.mm-node.sticky')).map(el => el.getAttribute('data-id')).slice(0, 2) })()`)
    const r1 = await d.nodeRect(boxNodes[0])
    const r2 = await d.nodeRect(boxNodes[1])
    await d.dragSelect('.react-flow__pane', Math.min(r1.left, r2.left) - 12, Math.min(r1.top, r2.top) - 12, Math.max(r1.right, r2.right) + 12, Math.max(r1.bottom, r2.bottom) + 12, { steps: 10, totalMs: 300 })
    await sleep(300)
    const selectedIds = await d.evaluate(`[...document.querySelectorAll('.react-flow__node .mm-node.selected')].map(n => n.closest('.react-flow__node').getAttribute('data-id'))`)
    check('S4d 框选多选（拖框选中 ≥2 节点）', selectedIds.length >= 2, `选中 ${selectedIds.length} 个：${selectedIds.join(',')}`)
    const selBefore = (await d.nodeFlowPositions()).filter((p) => selectedIds.includes(p.id))
    // 批量移动：拖其中一个选中节点，全体同位移
    const moveId = selBefore[0].id
    const moveCenter = await d.nodeRect(moveId)
    await d.dragMouse(nodeSel(moveId), moveCenter.cx, moveCenter.cy, moveCenter.cx + 60, moveCenter.cy + 40)
    await sleep(400)
    const selAfter = (await d.nodeFlowPositions()).filter((p) => selectedIds.includes(p.id))
    const deltas = selAfter.map((p) => {
      const b = selBefore.find((q) => q.id === p.id)
      return { id: p.id, dx: p.x - b.x, dy: p.y - b.y }
    })
    const sameDelta = deltas.length === selBefore.length && deltas.every((dd) => Math.abs(dd.dx - deltas[0].dx) < 3 && Math.abs(dd.dy - deltas[0].dy) < 3)
    check('S4e 批量移动（拖动一个带动全部选中）', sameDelta, JSON.stringify(deltas))
    // 批量删除（带确认，override confirm）：应用按 PRD 级联删除选中节点及其子树，
    // 期望剩余 = 快照节点数 - 选中节点子树的并集大小（子树按 parentId 链计算）。
    const beforeDelete = await d.nodeCountText()
    const selBeforeDelete = await d.evaluate(`[...document.querySelectorAll('.react-flow__node .mm-node.selected')].map(n => n.closest('.react-flow__node').getAttribute('data-id'))`)
    const inSubtree = (n, sid) => {
      if (n.id === sid) return true
      const p = apiSaved.nodes[n.parentId]
      return p ? inSubtree(p, sid) : false
    }
    const remaining = Object.values(apiSaved.nodes).filter((n) => !selBeforeDelete.some((sid) => inSubtree(n, sid))).length
    await d.evaluate(`window.__origConfirm = window.confirm; window.confirm = () => true`)
    await d.key('Delete')
    await d.waitFor(`(document.querySelector('.mm-statusbar')?.textContent ?? '').includes(${JSON.stringify(String(remaining) + ' 节点')})`, '批量删除生效（含子树级联）')
    await d.evaluate(`window.confirm = window.__origConfirm`)
    check('S4f 批量删除（Delete + 确认，级联移除选中节点及子树）', true)
    await d.waitSaved()

    // ---------- S5：重启应用（Electron + 后端），坐标/形状/颜色/便签完整恢复 ----------
    const snapshot = JSON.parse((await rest('GET', `/mindmaps/${mid1}`)).data.contentJson)
    const snapshotRootLayout = snapshot.nodes[rootId].layout
    await d.screenshot('04-before-restart')
    await d.evaluate(`window.close()`).catch(() => {})
    await sleep(1500)
    const deadline = Date.now() + 15000
    while (await portListening(BACKEND_PORT) && Date.now() < deadline) await sleep(500)
    check('S5a 关闭应用后端优雅退出（端口释放）', !(await portListening(BACKEND_PORT)))
    if (electron && electron.exitCode === null) await killTree(electron.pid).catch(() => {})

    console.log('[m2-gui] 重启 Electron（模拟应用重启，数据应完整恢复）…')
    electron = launchElectron()
    const target2 = await waitForPageTarget()
    cdp2 = new Cdp(target2.webSocketDebuggerUrl)
    await cdp2.open()
    await cdp2.send('Runtime.enable')
    await cdp2.send('Page.enable')
    await cdp2.send('Log.enable')
    const d2 = makeDriver(cdp2)

    await d2.waitFor(`[...document.querySelectorAll('.workspace-item .item-name')].some(b => b.textContent.includes(${JSON.stringify(wsName)}))`, '重启后工作区列表恢复', 20000)
    await d2.clickText('.workspace-item .item-name', wsName)
    await d2.waitFor(`[...document.querySelectorAll('.workspace-item')].some(li => li.textContent.includes('M2验收主图'))`, '重启后导图列表')
    await d2.evaluate(`(() => { const li = [...document.querySelectorAll('.workspace-item')].find(li => li.textContent.includes('M2验收主图'))
      const b = [...li.querySelectorAll('button')].find(x => x.textContent.trim() === '打开'); b.click(); return true })()`)
    await d2.waitFor(`!!document.querySelector('.mm-canvas')`, '重启后编辑器加载')
    await d2.clickText('.mm-mode-switch button', '画布')
    await d2.waitFor(`(document.querySelector('.mm-statusbar')?.textContent ?? '').includes('画布模式')`, '重启后切画布')
    await sleep(900)
    const restored = await d2.evaluate(`(() => {
      const nodes = [...document.querySelectorAll('.react-flow__node')].map(el => {
        // 节点 transform 即 flow 坐标（viewport 的 scale 在父层生效，无需换算）
        const t = (el.style.transform || '').match(/translate\\((-?[\\d.]+)px, (-?[\\d.]+)px\\)/)
        return { id: el.getAttribute('data-id'), fx: parseFloat(t[1]), fy: parseFloat(t[2]),
          cls: el.querySelector('.mm-node')?.className ?? '', bg: el.querySelector('.mm-node')?.style.getPropertyValue('--node-bg') ?? '' }
      })
      return nodes })()`)
    const rootRestored = restored.find((n) => n.id === rootId)
    const layoutOk = rootRestored && snapshotRootLayout && Math.abs(rootRestored.fx - snapshotRootLayout.x) <= 3 && Math.abs(rootRestored.fy - snapshotRootLayout.y) <= 3
    const styleOk = rootRestored?.cls.includes('shape-diamond') && rootRestored?.cls.includes('bold') && rootRestored?.bg === '#eef1ff'
    const stickyOk = restored.some((n) => n.cls.includes('sticky'))
    check('S5b 重启后坐标恢复（画布 layout 不丢）', layoutOk === true, `恢复 fx=${rootRestored?.fx?.toFixed(0)},fy=${rootRestored?.fy?.toFixed(0)} 快照=${JSON.stringify(snapshotRootLayout)}`)
    check('S5c 重启后形状/颜色/加粗/便签恢复', styleOk === true && stickyOk === true, `style=${styleOk} sticky=${stickyOk}`)
    await d2.screenshot('05-after-restart')

    // ---------- S6：100 节点自由画布拖拽流畅 ----------
    await d2.clickText('.mm-toolbar button', '返回')
    await d2.waitFor(`[...document.querySelectorAll('.workspace-item')].some(li => li.textContent.includes('M2验收主图'))`, '返回导图列表')
    await d2.clickText('button', '← 返回')
    await d2.waitFor(`[...document.querySelectorAll('.workspace-item .item-name')].some(b => b.textContent.includes(${JSON.stringify(wsName)}))`, '返回工作区列表')
    await d2.clickText('.workspace-item .item-name', wsName)
    await d2.waitFor(`[...document.querySelectorAll('.workspace-item')].some(li => li.textContent.includes('M2验收百节点'))`, '百节点导图列表')
    await d2.evaluate(`(() => { const li = [...document.querySelectorAll('.workspace-item')].find(li => li.textContent.includes('M2验收百节点'))
      const b = [...li.querySelectorAll('button')].find(x => x.textContent.trim() === '打开'); b.click(); return true })()`)
    await d2.waitFor(`[...document.querySelectorAll('.react-flow__node')].length === 101`, '100 节点+根全部渲染', 20000)
    await d2.clickText('.mm-mode-switch button', '画布')
    await d2.waitFor(`(document.querySelector('.mm-statusbar')?.textContent ?? '').includes('画布模式')`, '百节点切画布')
    await sleep(1000)
    check('S6a 100 节点画布渲染（101 个 DOM 节点含根）', true)

    // rAF 帧率统计 + 约 1.5s 连续拖拽
    await d2.evaluate(`window.__fps = { n: 0, t0: 0, running: false }
      window.__fpsTick = (t) => { if (!window.__fps.running) return; window.__fps.n++; if (t - window.__fps.t0 < 4500) requestAnimationFrame(window.__fpsTick) }
      window.__fpsStart = () => { window.__fps.running = true; window.__fps.t0 = performance.now(); requestAnimationFrame(window.__fpsTick) }
      window.__fpsStop = () => { window.__fps.running = false; return { frames: window.__fps.n, dt: performance.now() - window.__fps.t0 } }
      true`)
    await d2.evaluate(`window.__fpsStart()`)
    const dragNode = await d2.evaluate(`(() => { const el = [...document.querySelectorAll('.react-flow__node')].find(n => n.querySelector('.mm-node-text')?.textContent === '节点50'); const r = el.getBoundingClientRect(); return { id: el.getAttribute('data-id'), cx: r.x + r.width / 2, cy: r.y + r.height / 2 } })()`)
    await d2.evaluate(`(() => { const el = document.querySelector(${JSON.stringify(nodeSel(dragNode.id))})
      el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window, clientX: ${dragNode.cx}, clientY: ${dragNode.cy}, buttons: 1 })); return true })()`)
    const segs = [
      [dragNode.cx + 200, dragNode.cy], [dragNode.cx + 200, dragNode.cy + 160], [dragNode.cx, dragNode.cy + 160], [dragNode.cx, dragNode.cy],
    ]
    for (const [tx, ty] of segs) {
      for (let i = 1; i <= 15; i++) {
        await d2.evaluate(`document.body.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, cancelable: true, view: window, clientX: ${dragNode.cx + ((tx - dragNode.cx) * i) / 15}, clientY: ${dragNode.cy + ((ty - dragNode.cy) * i) / 15}, buttons: 1 }))`)
        await sleep(25)
      }
    }
    await d2.evaluate(`document.body.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: window, clientX: ${dragNode.cx}, clientY: ${dragNode.cy}, buttons: 0 }))`)
    const fpsInfo = await d2.evaluate(`window.__fpsStop()`)
    const fps = fpsInfo.frames / (fpsInfo.dt / 1000)
    check('S6b 100 节点拖拽流畅（拖拽期帧率 ≥ 30fps）', fps >= 30, `实测 ${fps.toFixed(1)}fps（${fpsInfo.frames} 帧 / ${(fpsInfo.dt / 1000).toFixed(2)}s）`)
    await d2.screenshot('06-100nodes')

    // ---------- 清理：删除验收工作区（级联）→ 关闭应用 ----------
    await rest('DELETE', `/workspaces/${wid}`)
    const formWs = (await rest('GET', '/workspaces')).data.find((w) => w.name === `验收表单-${ts}`)
    if (formWs) await rest('DELETE', `/workspaces/${formWs.id}`)
    await d2.evaluate(`window.close()`).catch(() => {})
    await sleep(1200)
  } finally {
    if (electron && electron.exitCode === null) await killTree(electron.pid).catch(() => {})
    try { cdp?.close() } catch { /* 忽略 */ }
    try { cdp2?.close() } catch { /* 忽略 */ }
    try { staticServer?.close() } catch { /* 忽略 */ }
  }
}

async function mainEntry() {
  console.log('[m2-gui] M2 总验收 GUI 实机验证开始')
  try {
    await main()
  } catch (e) {
    results.push({ name: '流程异常', ok: false, error: e.message })
  }
  const failed = results.filter((r) => !r.ok)
  const lines = results.map((r) => `  ${r.ok ? '✓' : '✗'} ${r.name}${r.ok ? '' : ' — ' + r.error}`)
  console.log((failed.length === 0 ? 'M2 GUI: ALL PASS' : 'M2 GUI: FAILED') + `（${results.length - failed.length}/${results.length}）`)
  console.log(lines.join('\n'))
  console.log(`[m2-gui] 截图目录：${OUT_DIR}`)
  process.exit(failed.length === 0 ? 0 : 1)
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
if (isMain) await mainEntry()
