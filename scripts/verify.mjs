// M0 验收冒烟（docs/10 §10/§12）：/health → schema 表齐全 → workspace 创建/列表/清理 → 输出 ALL PASS。
// 仅依赖 Node 内建（http/child_process），无第三方依赖。前置：后端已在 127.0.0.1:17860 运行、MySQL 可连（DB_PASS/MYSQL_PWD）。
import http from 'node:http'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { execFile } from 'node:child_process'

export const BASE = 'http://127.0.0.1:17860'
export const EXPECTED_TABLES = [
  'workspace', 'mindmap', 'session', 'entry', 'tag', 'entry_tag', 'entry_commit', 'setting',
]

// 纯函数：比较实际表集与期望表集，返回缺失的表名（单测覆盖）。
export function missingTables(actualTables, expectedTables = EXPECTED_TABLES) {
  const actual = new Set(actualTables)
  return expectedTables.filter((t) => !actual.has(t))
}

// 纯函数：汇总各检查结果，返回 { pass, message }（单测覆盖）。
export function summarize(results) {
  const failed = results.filter((r) => !r.ok)
  const lines = results.map((r) => `  ${r.ok ? '✓' : '✗'} ${r.name}${r.ok ? '' : ' — ' + r.error}`)
  const message = (failed.length === 0 ? 'M0 SMOKE: ALL PASS' : 'M0 SMOKE: FAILED') + '\n' + lines.join('\n')
  return { pass: failed.length === 0, message }
}

// HTTP 请求（内建 http），返回 { status, json }
function request(url, { method = 'GET', body } = {}) {
  return new Promise((resolve, reject) => {
    const headers = body !== undefined ? { 'Content-Type': 'application/json' } : undefined
    const req = http.request(url, { method, headers }, (res) => {
      let data = ''
      res.setEncoding('utf8')
      res.on('data', (c) => (data += c))
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, json: JSON.parse(data) })
        } catch (e) {
          reject(new Error(`非法 JSON 响应：${data.slice(0, 200)}`))
        }
      })
    })
    req.on('error', reject)
    req.setTimeout(5000, () => req.destroy(new Error('请求超时')))
    if (body !== undefined) req.write(JSON.stringify(body))
    req.end()
  })
}

// 经 mysql CLI 执行一条 SQL（密码走 MYSQL_PWD 环境变量，避免命令行泄漏）。
function mysql(sql, deps) {
  return new Promise((resolve, reject) => {
    execFile(
      'mysql',
      ['-h127.0.0.1', '-uroot', '-N', '-e', sql],
      { env: { ...process.env, MYSQL_PWD: deps.dbPass || process.env.DB_PASS || '' }, windowsHide: true },
      (err, stdout) => (err ? reject(new Error(`MySQL 失败：${err.message}`)) : resolve((stdout || '').trim())),
    )
  })
}

export async function runChecks(deps = {}) {
  const results = []

  // 1. /health code=0
  try {
    const { json } = await request(`${BASE}/api/v1/health`)
    if (json?.code === 0) results.push({ ok: true, name: `GET /api/v1/health code=0（version=${json?.data?.version}）` })
    else results.push({ ok: false, name: 'GET /api/v1/health', error: `code=${json?.code}` })
  } catch (e) {
    results.push({ ok: false, name: 'GET /api/v1/health', error: e.message })
  }

  // 2. schema 表齐全（information_schema）
  try {
    const out = await mysql("SELECT table_name FROM information_schema.tables WHERE table_schema='trailmind'", deps)
    const tables = out.split(/\r?\n/).map((s) => s.trim()).filter(Boolean)
    const missing = missingTables(tables)
    if (missing.length === 0) results.push({ ok: true, name: `schema 表齐全（${tables.length}/8）` })
    else results.push({ ok: false, name: 'schema 表齐全', error: `缺失：${missing.join(', ')}` })
  } catch (e) {
    results.push({ ok: false, name: 'schema 表齐全', error: e.message })
  }

  // 3. workspace 创建 → 列表可见 → 清理
  const name = `verify-${process.pid}-${Date.now()}`
  try {
    const created = await request(`${BASE}/api/v1/workspaces`, { method: 'POST', body: { name } })
    const id = created?.json?.data?.id
    if (created?.json?.code !== 0 || !id) throw new Error(`创建失败：${JSON.stringify(created?.json)}`)
    const listed = await request(`${BASE}/api/v1/workspaces`)
    const visible = (listed?.json?.data || []).some((w) => w.name === name)
    // M1 起后端有 DELETE 接口，改回 API 清理（顺带验证级联删除不报错）
    const deleted = await request(`${BASE}/api/v1/workspaces/${id}`, { method: 'DELETE' })
    if (deleted?.json?.code !== 0) throw new Error(`删除失败：${JSON.stringify(deleted?.json)}`)
    if (visible) results.push({ ok: true, name: 'workspace 创建→列表→删除往返' })
    else results.push({ ok: false, name: 'workspace 往返', error: '创建成功但列表不可见' })
  } catch (e) {
    results.push({ ok: false, name: 'workspace 往返', error: e.message })
  }

  return results
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
if (isMain) {
  runChecks()
    .then((results) => {
      const { pass, message } = summarize(results)
      console.log(message)
      process.exit(pass ? 0 : 1)
    })
    .catch((e) => {
      console.error('M0 SMOKE: ERROR — ' + e.message)
      process.exit(1)
    })
}
