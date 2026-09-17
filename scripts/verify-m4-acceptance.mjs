// M4 收尾验收 · 「已完成的会话在 7 天后仍能方便地找到并复盘（搜索+标签路径）」（docs/07 §7，02 §6.5）。
//
// ① 夹具数据（幂等）：「七日复盘·夹具会话」——标题/条目含特征关键词「七日复盘」，
//    「复盘路径」「验收夹具」标签挂 seq5/seq6 条目；时间戳经 mysql CLI 回填 10 天前
//    （MYSQL_PWD 环境变量，模式同 verify.mjs）。已存在且 ≥7 天前则复用，否则重建。
// ② API 级断言：全局搜索命中（会话+条目）、标签过滤（工作区级+会话内）、会话详情回填时间、
//    Markdown/JSON 导出（06 §4/§4A 协议要素）。
// ③ GUI 实机验证（Electron + CDP，dev 态静态服务器同 verify-m2-gui.mjs）：
//    工作区 → 会话列表「已完成」徽标 → Ctrl+K 搜索「七日复盘」→ 点击结果跳转会话 →
//    条目渲染（含 review）→ 工作区标签面板「复盘路径」过滤命中。
//
// 断网实测（另一项未勾验收）由 verify-m2-gui.mjs 的 OFFLINE_MODE=1 覆盖（死代理 + 连接审计）。
// 前置：MySQL 已启动；frontend/dist 与 backend/target/trailmind-backend-0.0.1.jar 已构建
// （node scripts/build.mjs）。用法：node scripts/verify-m4-acceptance.mjs
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { execFile } from 'node:child_process'
import {
  buildShellEnv,
  ensureWebViewDataDir,
  resolveShellExe,
  resolveWebViewDataDir,
  spawnShell,
  waitForPageTarget as waitForShellPageTarget,
} from './lib/shell-launcher.mjs'

// 本地 DB 凭据不提交；供 mysql CLI 回填夹具时间戳使用。
try { process.loadEnvFile(new URL('../.env', import.meta.url)) } catch { /* 无 .env 时回落 shell 环境变量 */ }

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const CDP_PORT = 9223
const BACKEND_PORT = 17860
const BACKEND_BASE = `http://127.0.0.1:${BACKEND_PORT}`
const APP_URL = BACKEND_BASE
const OUT_DIR = path.join(ROOT, 'scripts', 'out', 'm4-acceptance')

// ---------- 夹具定义与纯函数（单测覆盖） ----------

export const FIXTURE = {
  workspaceName: 'TrailMind 开发',
  keyword: '七日复盘',
  title: '七日复盘·夹具会话（M4 收尾验收）',
  tag: '复盘路径',
  tag2: '验收夹具',
  entryCount: 9, // 8 条人工条目 + 完成时后端写入的 summary review 条目
  entries: [
    { type: 'goal', contentMd: '目标：记录 M3 里程碑过程并验证「七日复盘」路径——7 天后通过全局搜索与标签仍能找回本会话并完整回顾。', tags: [] },
    { type: 'context', contentMd: '背景：M3 起过程记录迁移到产品本身（06 §9），本会话为 dogfooding 会话之一。', tags: [] },
    { type: 'action', contentMd: '执行 M3 总验收：10 条条目写入计时、Git 提交感知与绑定、1000 条目滚动。', tags: [] },
    { type: 'decision', contentMd: '决策：选择 JGit 而非命令行 git，因为纯 Java 零外部依赖，可内嵌于 Spring Boot；放弃 shell 调用因为窗口/编码处理脆弱。', tags: [] },
    { type: 'test', contentMd: '验证：verify.mjs 冒烟 14 段 ALL PASS；「七日复盘」搜索可命中本会话与条目，标签「复盘路径」过滤即时生效。', tags: ['复盘路径'] },
    { type: 'review', contentMd: '复盘：七日后再来回顾本会话——搜索关键词「七日复盘」与标签「复盘路径」都能快速定位，证明找回旧会话的主路径有效。', tags: ['复盘路径', '验收夹具'] },
    { type: 'next', contentMd: '下一步：\n- [x] 断网状态全功能可用实测\n- [ ] 7 天后用真实会话复测复盘路径', tags: [] },
    { type: 'note', contentMd: '备注：本会话为 M4 收尾验收的回填夹具（时间戳回填至 10 天前），标题含「夹具」标记。', tags: [] },
  ],
}

// 时间戳距今是否 ≥ days 天（夹具回填校验；允许 1 分钟容差）
export function isOldEnough(iso, days = 7, nowMs = Date.now()) {
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return false
  return nowMs - t >= days * 86400_000 - 60_000
}

// 本地时区 'YYYY-MM-DD HH:mm:ss'（与库内 datetime 形态一致）
function fmtLocal(d) {
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

// 夹具时间计划：10 天前 09:00–11:30，条目按 seq 分布（含完成总结 seq9）
export function planFixtureTimes(nowMs = Date.now()) {
  const day = new Date(nowMs - 10 * 86400_000)
  const at = (h, m, s = 0) => {
    const d = new Date(day)
    d.setHours(h, m, s, 0)
    return fmtLocal(d)
  }
  return {
    sessionStart: at(9, 0),
    sessionEnd: at(11, 30),
    entries: [at(9, 2), at(9, 5), at(9, 10), at(9, 20), at(9, 35), at(11, 20), at(11, 25), at(11, 26), at(11, 29)],
  }
}

// 回填 SQL：session 起止/创建时间 + 各条目 created_at（按 seq 定位；ELSE created_at 防止 CASE 落 NULL）
export function backdateSql(sessionId, t) {
  const whens = t.entries.map((v, i) => `WHEN ${i + 1} THEN '${v}'`).join(' ')
  return (
    `UPDATE session SET started_at='${t.sessionStart}', ended_at='${t.sessionEnd}', ` +
    `created_at='${t.sessionStart}', updated_at='${t.sessionEnd}' WHERE id=${sessionId}; ` +
    `UPDATE entry SET created_at=CASE seq ${whens} ELSE created_at END, updated_at=created_at WHERE session_id=${sessionId};`
  )
}

// ---------- 基础设施（同 verify-m2-gui.mjs：静态服务器 + CDP 客户端，零第三方依赖） ----------


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

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)) }

async function rest(method, pathname, body) {
  const res = await fetch(`${BACKEND_BASE}/api/v1${pathname}`, {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  return res.json()
}

async function killTree(pid) {
  if (!pid) return
  await new Promise((resolve) => execFile('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true }, () => resolve()))
}

// 经 mysql CLI 执行一条 SQL（密码走 MYSQL_PWD 环境变量，避免命令行泄漏；utf8mb4 防中文乱码）
function mysql(sql) {
  return new Promise((resolve, reject) => {
    execFile('mysql', ['-h127.0.0.1', '-uroot', '--default-character-set=utf8mb4', '-N', '-e', sql], { env: { ...process.env, MYSQL_PWD: process.env.DB_PASS || '' }, windowsHide: true }, (err, stdout) =>
      err ? reject(new Error(`MySQL 失败：${err.message}`)) : resolve((stdout || '').trim()),
    )
  })
}

/** 拉起 Wails 壳（自拉便携 MySQL + 后端 app-image + WebView2 窗口）。 */
function launchShell() {
  const exe = resolveShellExe(ROOT)
  if (!exe) throw new Error('未找到壳产物：请先 npm run package（完整自包含打包）或 cd desktop/wails && wails build')
  ensureWebViewDataDir(resolveWebViewDataDir(path.join(OUT_DIR, 'webview-data')))
  const env = buildShellEnv(process.env, { cdpPort: CDP_PORT })
  delete env.ELECTRON_RUN_AS_NODE
  const child = spawnShell(exe, env, { cwd: path.dirname(exe) })
  child.on('exit', () => {})
  return child
}

/** 等壳的页面目标出现（壳完成 初始化库 → 起后端 → 开窗 之后）。 */
async function waitForPageTarget(timeoutMs = 180000) {
  const { target } = await waitForShellPageTarget({ port: CDP_PORT, backendPort: BACKEND_PORT, timeoutMs })
  return target
}

// ---------- 页面驱动（同 verify-m2-gui.mjs 的 makeDriver 精简版） ----------

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
  const screenshot = async (name) => {
    const r = await cdp.send('Page.captureScreenshot', { format: 'png' })
    const file = path.join(OUT_DIR, `${name}.png`)
    fs.writeFileSync(file, Buffer.from(r.data, 'base64'))
    return file
  }
  const key = async (keyName, { ctrl = false, shift = false } = {}) => {
    await evaluate(`document.body.dispatchEvent(new KeyboardEvent('keydown', { key: ${JSON.stringify(keyName)}, code: ${JSON.stringify(keyName)}, ctrlKey: ${ctrl}, shiftKey: ${shift}, bubbles: true, cancelable: true }))`)
    await evaluate(`document.body.dispatchEvent(new KeyboardEvent('keyup', { key: ${JSON.stringify(keyName)}, code: ${JSON.stringify(keyName)}, ctrlKey: ${ctrl}, shiftKey: ${shift}, bubbles: true, cancelable: true }))`)
  }
  const clickText = (selector, text) => evaluate(
    `(() => { const b = [...document.querySelectorAll(${JSON.stringify(selector)})].find(x => x.textContent.includes(${JSON.stringify(text)})); if (!b) return false; b.click(); return true })()`,
  )
  // React 受控 input 输入（原生 setter + input 事件）
  const typeIntoInput = (selector, text) => evaluate(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return false
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
    setter.call(el, ${JSON.stringify(text)})
    el.dispatchEvent(new Event('input', { bubbles: true })); return true })()`)
  return { evaluate, waitFor, screenshot, key, clickText, typeIntoInput }
}

// ---------- 夹具准备（幂等） ----------

// 等待后端就绪（页面目标出现只代表 splash 已加载，后端仍在健康等待，需显式轮询 /health）
async function waitBackend(timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const r = await rest('GET', '/health')
      if (r?.code === 0) return
    } catch { /* 后端尚未就绪 */ }
    await sleep(500)
  }
  throw new Error('等待后端就绪超时')
}

// 搜索关键词命中既有夹具（startedAt ≥7 天前）则复用，否则新建并回填
async function prepareFixture() {
  const r = await rest('GET', `/search?q=${encodeURIComponent(FIXTURE.keyword)}`)
  const hit = r.data?.sessions?.find((s) => s.title.includes('夹具'))
  if (hit) {
    const det = (await rest('GET', `/sessions/${hit.id}?page=1&size=1`)).data
    if (isOldEnough(det.startedAt, 7)) {
      return { sessionId: hit.id, workspaceId: hit.workspaceId, created: false }
    }
  }
  const wsList = (await rest('GET', '/workspaces')).data
  let ws = wsList.find((w) => w.name === FIXTURE.workspaceName)
  if (!ws) ws = (await rest('POST', '/workspaces', { name: FIXTURE.workspaceName })).data
  const sess = (await rest('POST', `/workspaces/${ws.id}/sessions`, { title: FIXTURE.title })).data
  for (const e of FIXTURE.entries) {
    const created = (await rest('POST', `/sessions/${sess.id}/entries`, { type: e.type, contentMd: e.contentMd })).data
    if (e.tags.length) await rest('PUT', `/entries/${created.id}`, { tags: e.tags })
  }
  await rest('PATCH', `/sessions/${sess.id}`, {
    status: 'completed',
    summary: '夹具会话：验证「七日复盘」路径——搜索+标签可找回 7 天前会话并完整复盘。',
  })
  const t = planFixtureTimes()
  await mysql(backdateSql(sess.id, t))
  return { sessionId: sess.id, workspaceId: ws.id, created: true }
}

// ---------- 主流程 ----------

const results = []
const check = (name, ok, error) => results.push({ name, ok: !!ok, ...(error ? { error } : {}) })

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true })
  let shell = null
  let cdp = null

  try {
    // ---------- GUI 环境先行：拉起 Wails 壳（壳自拉便携 MySQL + 后端 app-image），其后 API 与 GUI 验证共用该后端 ----------
    console.log('[m4-acceptance] 拉起 Wails 壳（自拉便携 MySQL + 后端 app-image + WebView2 窗口，CDP 端口 9223）…')
    shell = launchShell()

    const target = await waitForPageTarget()
    cdp = new Cdp(target.webSocketDebuggerUrl)
    await cdp.open()
    await cdp.send('Runtime.enable')
    await cdp.send('Page.enable')
    await cdp.send('Log.enable')
    const d = makeDriver(cdp)
    await waitBackend()

    // ---------- 数据准备：夹具（幂等） + API 级断言 ----------
    const fix = await prepareFixture()
    check(`夹具就绪：会话 ${fix.sessionId}${fix.created ? '（新建+回填）' : '（复用既有）'}`, true)

    const plan = planFixtureTimes()
    const datePrefix = plan.sessionStart.slice(0, 10)

    const search = (await rest('GET', `/search?q=${encodeURIComponent(FIXTURE.keyword)}`)).data
    const sessHits = search.sessions.filter((s) => s.id === fix.sessionId)
    const entryHits = search.entries.filter((e) => e.sessionId === fix.sessionId)
    check(
      'A1 全局搜索「七日复盘」命中 7 天前会话与其条目',
      sessHits.length === 1 && entryHits.length >= 4,
      `会话命中 ${sessHits.length}、条目命中 ${entryHits.length}`,
    )

    const tags = (await rest('GET', `/tags?workspaceId=${fix.workspaceId}`)).data
    const tag = tags.find((t) => t.name === FIXTURE.tag)
    const filtered = tag ? (await rest('GET', `/entries?tagId=${tag.id}&sessionId=${fix.sessionId}`)).data : []
    check(
      'A2 标签「复盘路径」过滤命中夹具条目（test/review）',
      tag != null && filtered.length === 2 && filtered.some((e) => e.seq === 5) && filtered.some((e) => e.seq === 6),
      `tag=${tag?.id ?? '缺失'} 命中 ${filtered.map((e) => e.seq).join(',')}`,
    )

    const det = (await rest('GET', `/sessions/${fix.sessionId}?page=1&size=50`)).data
    check(
      'A3 会话详情：已完成 + 时间回填 10 天前 + 9 条条目',
      det.status === 'completed' && det.startedAt.startsWith(datePrefix) && isOldEnough(det.startedAt, 7) && det.entryTotal === FIXTURE.entryCount,
      `status=${det.status} startedAt=${det.startedAt} entryTotal=${det.entryTotal}`,
    )

    const jsonExp = (await rest('GET', `/sessions/${fix.sessionId}/export/json`)).data
    const mdExp = (await rest('GET', `/sessions/${fix.sessionId}/export/markdown`)).data
    check(
      'A4 导出（复盘数据不锁定）：JSON v1 协议 + 回填时间',
      jsonExp.format === 'trailmind-session-json' && jsonExp.version === 1 && jsonExp.session.startedAt.startsWith(datePrefix) && jsonExp.entryCount === FIXTURE.entryCount,
      `format=${jsonExp.format} version=${jsonExp.version}`,
    )
    check(
      'A5 导出 Markdown：06 §4 frontmatter + review 条目段',
      typeof mdExp === 'string' && mdExp.startsWith('---') && mdExp.includes('format: trailmind-session') && mdExp.includes('[review]'),
      `长度 ${typeof mdExp === 'string' ? mdExp.length : 0}`,
    )

    // ---------- GUI 实机验证（环境已在开头就绪） ----------
    // G1：工作区 → 会话列表（夹具会话 + 「已完成」徽标）
    await d.waitFor(`[...document.querySelectorAll('.workspace-item .item-name')].some(b => b.textContent.includes(${JSON.stringify(FIXTURE.workspaceName)}))`, '工作区列表出现「TrailMind 开发」', 20000)
    await d.clickText('.workspace-item .item-name', FIXTURE.workspaceName)
    await d.waitFor(`!!document.querySelector('.session-section')`, '进入工作区首页（会话区渲染）')
    // 会话列表异步加载：先等夹具会话条目出现再断言，避免加载竞态
    await d.waitFor(`[...document.querySelectorAll('.session-section .item-name')].some(b => b.textContent.includes(${JSON.stringify(FIXTURE.title)}))`, '会话列表加载出夹具会话', 12000)
    const g1 = await d.evaluate(`(() => {
      const items = [...document.querySelectorAll('.session-section .item-name')]
      const found = items.find(b => b.textContent.includes(${JSON.stringify(FIXTURE.title)}))
      return { found: !!found, completedBadge: !!document.querySelector('.session-section .status-badge.status-completed') }
    })()`)
    check('G1 工作区会话列表：7 天前会话可见且带「已完成」徽标', g1.found === true && g1.completedBadge === true, JSON.stringify(g1))
    await d.screenshot('00-workspace-sessions')

    // G2：Ctrl+K 搜索「七日复盘」→ 点击会话结果 → 跳转会话视图 → 条目渲染（含 review）
    await d.key('k', { ctrl: true })
    await d.waitFor(`!!document.querySelector('.search-panel input[aria-label="搜索关键词"]')`, '搜索浮层打开')
    await d.typeIntoInput('.search-panel input', FIXTURE.keyword)
    await d.waitFor(`[...document.querySelectorAll('.search-hit')].length > 0`, '搜索结果出现', 12000)
    const g2 = await d.evaluate(`(() => {
      const hits = [...document.querySelectorAll('.search-hit')]
      const sessionHit = hits.find(b => b.getAttribute('aria-label') === ${JSON.stringify(FIXTURE.title)})
      const entryHit = hits.find(b => (b.getAttribute('aria-label') || '').includes('#6'))
      return { sessionHit: !!sessionHit, entryHit: !!entryHit, total: hits.length }
    })()`)
    check('G2a 搜索结果：会话命中（标题精确）+ 条目命中（#6 review）', g2.sessionHit === true && g2.entryHit === true, JSON.stringify(g2))
    await d.evaluate(`(() => { const b = [...document.querySelectorAll('.search-hit')].find(x => x.getAttribute('aria-label') === ${JSON.stringify(FIXTURE.title)}); if (!b) return false; b.click(); return true })()`)
    await d.waitFor(`!!document.querySelector('.session-view')`, '点击结果跳转到会话视图')
    await d.waitFor(`[...document.querySelectorAll('.session-view .entry-item')].length >= ${FIXTURE.entryCount}`, '会话条目渲染（9 条）', 12000)
    const g2b = await d.evaluate(`(() => ({
      reviews: [...document.querySelectorAll('.session-view .entry-item.entry-type-review')].length,
      hasExport: [...document.querySelectorAll('.session-header-actions button')].some(b => b.textContent.includes('导出')),
    }))()`)
    check('G2b 复盘要素：review 条目渲染 + 导出入口在位', g2b.reviews >= 2 && g2b.hasExport === true, JSON.stringify(g2b))
    await d.screenshot('01-search-jump')

    // G3：标签路径——返回工作区 → 标签面板「复盘路径」→ 过滤命中夹具条目
    await d.clickText('.session-view button', '← 返回')
    await d.waitFor(`!!document.querySelector('.tag-section')`, '返回工作区首页（标签面板渲染）')
    // 标签列表异步加载：先等「复盘路径」标签按钮出现再点击，避免加载竞态
    await d.waitFor(`[...document.querySelectorAll('.tag-name')].some(b => b.getAttribute('aria-label') === ${JSON.stringify(FIXTURE.tag)})`, '标签列表加载出「复盘路径」', 12000)
    await d.evaluate(`(() => { const b = [...document.querySelectorAll('.tag-name')].find(x => x.getAttribute('aria-label') === ${JSON.stringify(FIXTURE.tag)}); if (!b) return false; b.click(); return true })()`)
    await d.waitFor(`!!document.querySelector('[data-testid="tag-filter-panel"]')`, '标签过滤面板打开')
    await d.waitFor(`[...document.querySelectorAll('.tag-filter-hit')].length >= 2`, '过滤结果出现', 12000)
    const g3 = await d.evaluate(`(() => {
      const hits = [...document.querySelectorAll('.tag-filter-hit')]
      return { total: hits.length, hasFixture: hits.some(b => b.textContent.includes('夹具')), hasReview: hits.some(b => b.textContent.includes('#6')) }
    })()`)
    check('G3 标签「复盘路径」过滤：夹具条目可见（#5 test / #6 review）', g3.total >= 2 && g3.hasFixture === true && g3.hasReview === true, JSON.stringify(g3))
    await d.screenshot('02-tag-filter')

    await d.evaluate(`window.close()`).catch(() => {})
    await sleep(1200)
  } finally {
    if (shell && shell.exitCode === null) await killTree(shell.pid).catch(() => {})
    try { cdp?.close() } catch { /* 忽略 */ }
    // 静态服务器已随 Electron 退役（壳加载后端同源前端）
  }
}

async function mainEntry() {
  console.log('[m4-acceptance] M4 收尾验收 · 7 天复盘路径（搜索+标签）验证开始')
  try {
    await main()
  } catch (e) {
    results.push({ name: '流程异常', ok: false, error: e.message })
  }
  const failed = results.filter((r) => !r.ok)
  const lines = results.map((r) => `  ${r.ok ? '✓' : '✗'} ${r.name}${r.ok ? '' : ' — ' + r.error}`)
  console.log((failed.length === 0 ? 'M4 ACCEPTANCE: ALL PASS' : 'M4 ACCEPTANCE: FAILED') + `（${results.length - failed.length}/${results.length}）`)
  console.log(lines.join('\n'))
  console.log(`[m4-acceptance] 截图目录：${OUT_DIR}`)
  process.exit(failed.length === 0 ? 0 : 1)
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
if (isMain) await mainEntry()
