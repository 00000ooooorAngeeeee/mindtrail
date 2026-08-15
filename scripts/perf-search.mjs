// N3 性能验证（M4 任务一，07 §7 验收「1 万条目规模搜索 ≤1s」，04 §8 性能预算）：
// 建临时工作区/会话 → mysql CLI 批量灌 10000 条条目（每 50 条含唯一关键词，共 200 命中）→
// 计时 GET /api/v1/search（首查无缓存）断言 ≤1000ms → 复测缓存命中 → 清理（工作区级联删除）→ 输出 ALL PASS。
// 仅依赖 Node 内建（http/child_process）+ 系统 mysql 命令。前置：后端已在 127.0.0.1:17860 运行、MySQL 可连。
import http from 'node:http'
import { execFile } from 'node:child_process'
import { BASE } from './verify.mjs'

// 本地敏感配置（DB 凭据）从根目录 .env 读入（gitignore 已忽略）。
try {
  process.loadEnvFile(new URL('../.env', import.meta.url))
} catch {
  /* 无 .env 时回落到 shell 环境变量 */
}

const ENTRY_TOTAL = 10000
const HIT_EVERY = 50
const BUDGET_MS = 1000

function request(url) {
  return new Promise((resolve, reject) => {
    const req = http.request(url, (res) => {
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
    req.setTimeout(15000, () => req.destroy(new Error('请求超时')))
    req.end()
  })
}

function post(url, body) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      url,
      { method: 'POST', headers: { 'Content-Type': 'application/json' } },
      (res) => {
        let data = ''
        res.setEncoding('utf8')
        res.on('data', (c) => (data += c))
        res.on('end', () => resolve({ status: res.statusCode, json: JSON.parse(data) }))
      },
    )
    req.on('error', reject)
    req.setTimeout(15000, () => req.destroy(new Error('请求超时')))
    req.write(JSON.stringify(body))
    req.end()
  })
}

function del(url) {
  return new Promise((resolve, reject) => {
    const req = http.request(url, { method: 'DELETE' }, (res) => {
      let data = ''
      res.setEncoding('utf8')
      res.on('data', (c) => (data += c))
      res.on('end', () => resolve({ status: res.statusCode, json: JSON.parse(data) }))
    })
    req.on('error', reject)
    req.setTimeout(15000, () => req.destroy(new Error('请求超时')))
    req.end()
  })
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

async function main() {
  const results = []
  let workspaceId = null

  try {
    const kw = `性搜${Date.now()}`
    const name = `perf-search-${Date.now()}`

    // 1. 建工作区与会话
    const ws = await post(`${BASE}/api/v1/workspaces`, { name })
    workspaceId = ws?.json?.data?.id
    if (ws?.json?.code !== 0 || !workspaceId) throw new Error(`工作区创建失败：${JSON.stringify(ws?.json)}`)
    const sess = await post(`${BASE}/api/v1/workspaces/${workspaceId}/sessions`, { title: '性能搜索会话' })
    const sid = sess?.json?.data?.id
    if (sess?.json?.code !== 0 || !sid) throw new Error(`会话创建失败：${JSON.stringify(sess?.json)}`)

    // 2. 批量灌 10000 条（每 50 条 1 条含关键词，共 200 命中；1000 行/批）
    const t0 = Date.now()
    for (let batch = 0; batch < ENTRY_TOTAL / 1000; batch++) {
      const rows = []
      for (let i = 0; i < 1000; i++) {
        const seq = batch * 1000 + i + 1
        const content = seq % HIT_EVERY === 0 ? `性能搜索标记 ${kw} 第${seq}条` : `普通条目 第${seq}条`
        rows.push(`(${sid},${seq},'note','${content}')`)
      }
      await mysql(`INSERT INTO trailmind.entry (session_id, seq, type, content_md) VALUES ${rows.join(',')}`)
    }
    const seedMs = Date.now() - t0
    results.push({ ok: true, name: `灌入 ${ENTRY_TOTAL} 条条目耗时 ${seedMs}ms` })

    // 3. 首查计时（缓存未命中，N3 判定依据）
    const t1 = Date.now()
    const first = await request(`${BASE}/api/v1/search?q=${encodeURIComponent(kw)}`)
    const firstMs = Date.now() - t1
    if (first?.json?.code !== 0) throw new Error(`搜索失败：${JSON.stringify(first?.json)}`)
    if ((first?.json?.data?.entries?.length ?? 0) !== 50) {
      throw new Error(`首查应命中 50 条（LIMIT），实际 ${first?.json?.data?.entries?.length}`)
    }
    if (!(first?.json?.data?.entries?.[0]?.snippet || '').includes(kw)) throw new Error('首查片段未含关键词')
    results.push({
      ok: firstMs <= BUDGET_MS,
      name: `1 万条目规模首查 ${firstMs}ms（预算 ≤${BUDGET_MS}ms，N3）`,
      ...(firstMs > BUDGET_MS ? { error: `超预算 ${firstMs - BUDGET_MS}ms` } : {}),
    })

    // 4. 缓存复测（04 §8 同词 30s 缓存）
    const t2 = Date.now()
    const second = await request(`${BASE}/api/v1/search?q=${encodeURIComponent(kw)}`)
    const secondMs = Date.now() - t2
    if ((second?.json?.data?.entries?.length ?? 0) !== 50) throw new Error('缓存复测结果错误')
    results.push({ ok: true, name: `同词 30s 缓存复测 ${secondMs}ms` })

    // 5. 落库命中数核对（200 命中；API 结果截断到 50）
    const hitCount = await mysql(
      `SELECT COUNT(*) FROM trailmind.entry WHERE content_md LIKE '%${kw}%'`,
    )
    if (hitCount !== String(ENTRY_TOTAL / HIT_EVERY)) throw new Error(`落库命中 ${hitCount} ≠ ${ENTRY_TOTAL / HIT_EVERY}`)
    results.push({ ok: true, name: `落库命中数核对 ${hitCount}/${ENTRY_TOTAL / HIT_EVERY}` })
  } catch (e) {
    results.push({ ok: false, name: 'N3 搜索性能验证', error: e.message })
  } finally {
    if (workspaceId != null) {
      await del(`${BASE}/api/v1/workspaces/${workspaceId}`).catch(() => {})
    }
  }

  const failed = results.filter((r) => !r.ok)
  console.log(results.map((r) => `  ${r.ok ? '✓' : '✗'} ${r.name}${r.ok ? '' : ' — ' + r.error}`).join('\n'))
  console.log(failed.length === 0 ? 'PERF-SEARCH: ALL PASS' : 'PERF-SEARCH: FAILED')
  process.exit(failed.length === 0 ? 0 : 1)
}

main().catch((e) => {
  console.error('PERF-SEARCH: ERROR — ' + e.message)
  process.exit(1)
})
