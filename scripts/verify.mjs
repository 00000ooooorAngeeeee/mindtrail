// 验收冒烟（docs/10 §10/§12 起）：/health → schema 表齐全 → workspace 往返 → mindmap 往返（M2 总验收补充）
// → session/entry 往返（M3 任务一：start_head、seq 1/2/3、标签、分页、编辑、结束写 review、追加限制、级联删除）
// → git 服务往返（M3 任务三：仓库校验、提交历史、since=start_head 新提交感知、绑定/解绑、详情回填、级联清理）→ 输出 ALL PASS。
// 仅依赖 Node 内建（http/child_process/fs）+ 系统 git 命令，无第三方依赖。前置：后端已在 127.0.0.1:17860 运行、MySQL 可连（DB_PASS/MYSQL_PWD）。
import http from 'node:http'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import zlib from 'node:zlib'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { execFile } from 'node:child_process'
import { parseSessionMarkdown } from './session-export.mjs'
import { parseOpmlOutlines, pngInfoFromBase64 } from './mindmap-export.mjs'

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
  const message = (failed.length === 0 ? 'SMOKE: ALL PASS' : 'SMOKE: FAILED') + '\n' + lines.join('\n')
  return { pass: failed.length === 0, message }
}

// 纯函数：校验保存后读回的 content_json 与期望结构一致（画布坐标/样式/自由边持久化，M2 验收）。
// expected: { nodeCount, nodes: { [id]: { layout: {x,y}, style: {color,bold,shape}, sticky?, parentId? } }, edges: [{type,source,target,label}] }
// 返回 { ok, error? }（单测覆盖）。
export function checkSavedContent(contentJson, expected) {
  let c
  try {
    c = typeof contentJson === 'string' ? JSON.parse(contentJson) : contentJson
  } catch {
    return { ok: false, error: 'contentJson 不是合法 JSON' }
  }
  const nodes = c?.nodes
  if (!nodes || Object.keys(nodes).length !== expected.nodeCount) {
    return { ok: false, error: `节点数 ${Object.keys(nodes ?? {}).length} ≠ ${expected.nodeCount}` }
  }
  for (const [id, want] of Object.entries(expected.nodes)) {
    const n = nodes[id]
    if (!n) return { ok: false, error: `缺失节点 ${id}` }
    if (want.layout && (n.layout?.x !== want.layout.x || n.layout?.y !== want.layout.y)) {
      return { ok: false, error: `节点 ${id} layout=${JSON.stringify(n.layout)} ≠ 期望` }
    }
    if (want.style) {
      const s = n.style ?? {}
      for (const [k, v] of Object.entries(want.style)) {
        if (s[k] !== v) return { ok: false, error: `节点 ${id} style.${k}=${JSON.stringify(s[k])} ≠ ${JSON.stringify(v)}` }
      }
    }
    if (want.sticky !== undefined && n.sticky !== want.sticky) {
      return { ok: false, error: `节点 ${id} sticky=${n.sticky} ≠ ${want.sticky}` }
    }
  }
  const edges = Array.isArray(c?.edges) ? c.edges : []
  if (edges.length !== expected.edges.length) {
    return { ok: false, error: `自由边数 ${edges.length} ≠ ${expected.edges.length}` }
  }
  for (const want of expected.edges) {
    const e = edges.find((x) => x.id === want.id)
    if (!e) return { ok: false, error: `缺失边 ${want.id}` }
    if (e.type !== want.type || e.source !== want.source || e.target !== want.target) {
      return { ok: false, error: `边 ${want.id} ${JSON.stringify(e)} ≠ 期望` }
    }
  }
  return { ok: true }
}

/**
 * 从备份 zip 字节中解出 trailmind-backup.json 并解析为对象（纯函数，单测覆盖）。
 * 仅支持单条目 zip（后端 ZipOutputStream 只写一个 JSON），deflate 解压走 Node 内建 zlib。
 * 参考 ZIP 规范：EOCD（0x06054b50）→ 中央目录（0x02014b50，取文件名/压缩方式/本地头偏移）→
 * 本地文件头（0x04034b50，跳过文件名+扩展长度取数据）→ 按方法 0（stored）/8（deflate）解压。
 * @param {Buffer} buf zip 字节
 * @returns {object} 备份 JSON（含 format/version/tables）
 */
export function unzipBackupJson(buf) {
  // 1. 定位 EOCD：文件尾 22 字节起向前扫（最大注释长度 65535）
  const eocdStart = Math.max(0, buf.length - 22 - 0xffff)
  let eocd = -1
  for (let i = buf.length - 22; i >= eocdStart; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i
      break
    }
  }
  if (eocd < 0) throw new Error('备份 zip 缺少 EOCD 记录')
  const entryCount = buf.readUInt16LE(eocd + 10)
  let cdOffset = buf.readUInt32LE(eocd + 16)

  // 2. 遍历中央目录找 trailmind-backup.json
  let found = null
  for (let n = 0; n < entryCount; n++) {
    if (buf.readUInt32LE(cdOffset) !== 0x02014b50) throw new Error('备份 zip 中央目录签名错误')
    const method = buf.readUInt16LE(cdOffset + 10)
    const compressedSize = buf.readUInt32LE(cdOffset + 20)
    const nameLen = buf.readUInt16LE(cdOffset + 28)
    const extraLen = buf.readUInt16LE(cdOffset + 30)
    const commentLen = buf.readUInt16LE(cdOffset + 32)
    const localOffset = buf.readUInt32LE(cdOffset + 42)
    const name = buf.toString('utf8', cdOffset + 46, cdOffset + 46 + nameLen)
    if (name === 'trailmind-backup.json') {
      found = { method, compressedSize, localOffset }
      break
    }
    cdOffset += 46 + nameLen + extraLen + commentLen
  }
  if (!found) throw new Error('备份 zip 中未找到 trailmind-backup.json')

  // 3. 读本地文件头，取数据区
  const { method, compressedSize, localOffset } = found
  if (buf.readUInt32LE(localOffset) !== 0x04034b50) throw new Error('备份 zip 本地文件头签名错误')
  const lNameLen = buf.readUInt16LE(localOffset + 26)
  const lExtraLen = buf.readUInt16LE(localOffset + 28)
  const dataStart = localOffset + 30 + lNameLen + lExtraLen
  const data = buf.subarray(dataStart, dataStart + compressedSize)
  const raw = method === 0 ? data : zlib.inflateRawSync(data)
  return JSON.parse(raw.toString('utf8'))
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
// --default-character-set=utf8mb4：Windows 下 CLI 默认 GBK 客户端字符集，中文列值会乱码（会话 9 记录）。
function mysql(sql, deps) {
  return new Promise((resolve, reject) => {
    execFile(
      'mysql',
      ['-h127.0.0.1', '-uroot', '--default-character-set=utf8mb4', '-N', '-e', sql],
      { env: { ...process.env, MYSQL_PWD: deps.dbPass || process.env.DB_PASS || '' }, windowsHide: true },
      (err, stdout) => (err ? reject(new Error(`MySQL 失败：${err.message}`)) : resolve((stdout || '').trim())),
    )
  })
}

// 执行任意命令并取 stdout（M3 任务三 Git 往返用 git CLI 建临时仓库）。
function execOut(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { ...opts, windowsHide: true }, (err, stdout) =>
      err ? reject(new Error(`${cmd} 失败：${err.message}`)) : resolve((stdout || '').trim()),
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

  // 3. workspace 创建 → 列表可见 →（第 4 步导图往返后）级联删除
  const name = `verify-${process.pid}-${Date.now()}`
  let workspaceId = null
  try {
    const created = await request(`${BASE}/api/v1/workspaces`, { method: 'POST', body: { name } })
    workspaceId = created?.json?.data?.id
    if (created?.json?.code !== 0 || !workspaceId) throw new Error(`创建失败：${JSON.stringify(created?.json)}`)
    const listed = await request(`${BASE}/api/v1/workspaces`)
    const visible = (listed?.json?.data || []).some((w) => w.name === name)
    if (visible) results.push({ ok: true, name: 'workspace 创建→列表可见' })
    else results.push({ ok: false, name: 'workspace 往返', error: '创建成功但列表不可见' })
  } catch (e) {
    results.push({ ok: false, name: 'workspace 往返', error: e.message })
  }

  // 4. mindmap 往返：创建 → 整图保存（画布坐标/样式/自由边）→ 读回比对 → search_text/node_count → 幂等再存 → 级联删除
  try {
    if (!workspaceId) throw new Error('依赖第 3 步的 workspace id')
    const created = await request(`${BASE}/api/v1/workspaces/${workspaceId}/mindmaps`, { method: 'POST', body: { name: '验收导图' } })
    const mid = created?.json?.data?.id
    if (created?.json?.code !== 0 || !mid) throw new Error(`导图创建失败：${JSON.stringify(created?.json)}`)

    // 期望内容：2 节点（画布坐标 + 菱形/靛蓝/加粗样式 + 便签）+ 1 条自由边（M2 持久化断言）
    const expected = {
      nodeCount: 3,
      nodes: {
        n1: { layout: { x: 120, y: 80 }, style: { color: 'indigo', bold: true, shape: 'diamond' }, sticky: false },
        n2: { layout: { x: 520, y: 160 }, style: { color: 'green', bold: false, shape: 'ellipse' }, sticky: false },
        n3: { layout: { x: 900, y: 60 }, sticky: true },
      },
      edges: [{ id: 'e1', type: 'free', source: 'n1', target: 'n2', label: '自由连线' }],
    }
    const content = JSON.stringify({
      version: 1,
      rootNodeId: 'n1',
      nodes: {
        n1: {
          id: 'n1',
          text: '验收根节点',
          note: '',
          style: { color: 'indigo', bold: true, shape: 'diamond' },
          tags: ['验收'],
          parentId: null,
          layout: { x: 120, y: 80 },
          collapsed: false,
          sticky: false,
        },
        n2: {
          id: 'n2',
          text: '画布坐标子节点',
          note: '',
          style: { color: 'green', bold: false, shape: 'ellipse' },
          tags: [],
          parentId: 'n1',
          layout: { x: 520, y: 160 },
          collapsed: false,
          sticky: false,
        },
        n3: {
          id: 'n3',
          text: '',
          note: '',
          style: { color: 'amber', bold: false, shape: 'rounded' },
          tags: [],
          parentId: 'n1',
          layout: { x: 900, y: 60 },
          collapsed: false,
          sticky: true,
        },
      },
      edges: [{ id: 'e1', source: 'n1', target: 'n2', type: 'free', label: '自由连线' }],
    })

    const fetched0 = await request(`${BASE}/api/v1/mindmaps/${mid}`)
    const saved = await request(`${BASE}/api/v1/mindmaps/${mid}`, {
      method: 'PUT',
      body: { contentJson: content, updatedAt: fetched0?.json?.data?.updatedAt },
    })
    if (saved?.json?.code !== 0 || saved?.json?.data?.nodeCount !== 3) {
      throw new Error(`整图保存失败：${JSON.stringify(saved?.json)}`)
    }
    const readBack = await request(`${BASE}/api/v1/mindmaps/${mid}`)
    const check = checkSavedContent(readBack?.json?.data?.contentJson, expected)
    if (!check.ok) throw new Error(check.error)

    const row = await mysql(
      `SELECT CONCAT(search_text, '|', node_count) FROM trailmind.mindmap WHERE id=${mid}`,
      deps,
    )
    const [searchText, nodeCount] = row.split('|')
    if (nodeCount !== '3') throw new Error(`node_count=${nodeCount} ≠ 3`)
    for (const kw of ['验收导图', '验收根节点', '画布坐标子节点', '验收', '自由连线']) {
      if (!searchText.includes(kw)) throw new Error(`search_text 缺失关键词：${kw}`)
    }

    // ngram 全文检索命中（07 §4 验收「搜索可命中导图节点文本」，M4 搜索依赖提前验证）
    const matched = await mysql(
      `SELECT COUNT(*) FROM trailmind.mindmap WHERE id=${mid} AND MATCH(search_text) AGAINST('画布坐标子节点' IN NATURAL LANGUAGE MODE) > 0`,
      deps,
    )
    if (matched !== '1') throw new Error(`ngram MATCH 未命中导图节点文本（命中 ${matched} 行）`)

    // 幂等：用最新 updatedAt 再存一次同内容，乐观锁不冲突（M2 持久化写路径稳定）
    const saved2 = await request(`${BASE}/api/v1/mindmaps/${mid}`, {
      method: 'PUT',
      body: { contentJson: content, updatedAt: saved?.json?.data?.updatedAt },
    })
    if (saved2?.json?.code !== 0) throw new Error(`二次保存失败：${JSON.stringify(saved2?.json)}`)

    results.push({ ok: true, name: 'mindmap 创建→整图保存→读回坐标/样式/自由边一致 + search_text/node_count' })
  } catch (e) {
    results.push({ ok: false, name: 'mindmap 往返', error: e.message })
  }

  // 5. session/entry 往返（M3 任务一）：开始（start_head）→ 条目追加（seq 1/2/3 + 标签）→ 详情分页 → 编辑 →
  //    非法类型 400 → 结束（review 条目 + summary）→ 结束后追加限制 → 删除条目（关联清理）→ 删除会话（级联）
  let sessionId = null
  try {
    if (!workspaceId) throw new Error('依赖第 3 步的 workspace id')
    const created = await request(`${BASE}/api/v1/workspaces/${workspaceId}/sessions`, {
      method: 'POST',
      body: { title: '验收会话' },
    })
    sessionId = created?.json?.data?.id
    if (created?.json?.code !== 0 || !sessionId) throw new Error(`会话创建失败：${JSON.stringify(created?.json)}`)
    if (created?.json?.data?.status !== 'active') throw new Error('新会话状态应为 active')
    if (created?.json?.data?.startHead != null) throw new Error('无仓库会话 start_head 应为 null')

    const add1 = await request(`${BASE}/api/v1/sessions/${sessionId}/entries`, {
      method: 'POST',
      body: { type: 'goal', contentMd: '目标', tags: ['验收标签'] },
    })
    const add2 = await request(`${BASE}/api/v1/sessions/${sessionId}/entries`, {
      method: 'POST',
      body: { type: 'action', contentMd: '动作' },
    })
    const add3 = await request(`${BASE}/api/v1/sessions/${sessionId}/entries`, {
      method: 'POST',
      body: { type: 'test', contentMd: '验证' },
    })
    const seqs = [add1?.json?.data?.seq, add2?.json?.data?.seq, add3?.json?.data?.seq]
    if (seqs.join(',') !== '1,2,3') throw new Error(`seq 应为 1/2/3，实际 ${seqs.join(',')}`)
    if (add1?.json?.data?.tags?.[0] !== '验收标签') throw new Error('条目标签未回填')

    const page1 = await request(`${BASE}/api/v1/sessions/${sessionId}?page=1&size=2`)
    const page2 = await request(`${BASE}/api/v1/sessions/${sessionId}?page=2&size=2`)
    if (page1?.json?.data?.entries?.length !== 2 || page1?.json?.data?.entryTotal !== 3) {
      throw new Error(`第一页分页错误：${JSON.stringify(page1?.json?.data)}`)
    }
    if (page2?.json?.data?.entries?.[0]?.seq !== 3) throw new Error('第二页应为 seq=3')

    const edited = await request(`${BASE}/api/v1/entries/${add2?.json?.data?.id}`, {
      method: 'PUT',
      body: { contentMd: '改后' },
    })
    if (edited?.json?.data?.contentMd !== '改后') throw new Error('条目编辑未生效')

    const bad = await request(`${BASE}/api/v1/sessions/${sessionId}/entries`, {
      method: 'POST',
      body: { type: 'todo', contentMd: 'x' },
    })
    if (bad?.json?.code !== 400) throw new Error('非法条目类型应返回 400')

    const done = await request(`${BASE}/api/v1/sessions/${sessionId}`, {
      method: 'PATCH',
      body: { status: 'completed', summary: '验收总结' },
    })
    if (done?.json?.code !== 0 || done?.json?.data?.status !== 'completed' || !done?.json?.data?.endedAt) {
      throw new Error(`结束会话失败：${JSON.stringify(done?.json)}`)
    }
    const detail = await request(`${BASE}/api/v1/sessions/${sessionId}`)
    const last = detail?.json?.data?.entries?.at(-1)
    if (last?.type !== 'review' || last?.contentMd !== '验收总结') throw new Error('结束总结未写入 review 条目')

    const blocked = await request(`${BASE}/api/v1/sessions/${sessionId}/entries`, {
      method: 'POST',
      body: { type: 'action', contentMd: 'x' },
    })
    if (blocked?.json?.code !== 400) throw new Error('已结束会话追加 action 应被拒绝')
    const note = await request(`${BASE}/api/v1/sessions/${sessionId}/entries`, {
      method: 'POST',
      body: { type: 'note', contentMd: '备注' },
    })
    if (note?.json?.code !== 0) throw new Error('已结束会话追加 note 应允许')

    const delEntry = await request(`${BASE}/api/v1/entries/${add1?.json?.data?.id}`, { method: 'DELETE' })
    if (delEntry?.json?.code !== 0) throw new Error('删除条目失败')
    const tagLeft = await mysql(
      `SELECT COUNT(*) FROM trailmind.entry_tag WHERE entry_id=${add1?.json?.data?.id}`,
      deps,
    )
    if (tagLeft !== '0') throw new Error(`删除条目后 entry_tag 残留 ${tagLeft}`)

    const delSession = await request(`${BASE}/api/v1/sessions/${sessionId}`, { method: 'DELETE' })
    if (delSession?.json?.code !== 0) throw new Error('删除会话失败')
    const entryLeft = await mysql(
      `SELECT COUNT(*) FROM trailmind.entry WHERE session_id=${sessionId}`,
      deps,
    )
    if (entryLeft !== '0') throw new Error(`删除会话后条目残留 ${entryLeft}`)
    sessionId = null

    results.push({
      ok: true,
      name: 'session 往返（start_head/seq 1-3/标签/分页/编辑/结束写 review/追加限制/级联删除）',
    })
  } catch (e) {
    results.push({ ok: false, name: 'session 往返', error: e.message })
  }

  // 6. git 服务往返（M3 任务三）：临时真实仓库 3 次提交 → /git/repo/status 与 git rev-parse 一致 →
  //    提交历史与 git log 一致（含变更文件）→ 带仓库会话 start_head → 新提交感知（since=start_head 命中 c3）→
  //    追加条目携带 commitHashes 绑定 → 会话绑定列表 + 详情回填 → 防造假 400 → 解绑 → 删除会话级联 entry_commit → 清理
  let gitWorkspaceId = null
  let gitRepoDir = null
  try {
    if (!workspaceId) throw new Error('依赖第 3 步的 workspace id')
    gitRepoDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'trailmind-verify-git-'))
    const runGit = (args) => execOut('git', args, { cwd: gitRepoDir })
    await runGit(['init', '-q'])
    await runGit(['config', 'user.name', 'TrailMind Verify'])
    await runGit(['config', 'user.email', 'verify@trailmind.local'])
    const write = (file, text) => fs.promises.writeFile(path.join(gitRepoDir, file), text)
    await write('a.txt', 'one')
    await runGit(['add', '.'])
    await runGit(['commit', '-q', '-m', 'c1 初始化'])
    const c1 = await runGit(['rev-parse', 'HEAD'])
    await write('b.txt', 'two')
    await runGit(['add', '.'])
    await runGit(['commit', '-q', '-m', 'c2 加文件'])
    const c2 = await runGit(['rev-parse', 'HEAD'])

    // 仓库校验 + 提交历史（新→旧、含变更文件）
    const st = await request(`${BASE}/api/v1/git/repo/status?path=${encodeURIComponent(gitRepoDir)}`)
    if (st?.json?.code !== 0 || st?.json?.data?.head !== c2) {
      throw new Error(`仓库校验失败：${JSON.stringify(st?.json)}`)
    }
    const hist = await request(`${BASE}/api/v1/git/repo/commits?path=${encodeURIComponent(gitRepoDir)}`)
    const hashes = (hist?.json?.data || []).map((c) => c.hash)
    if (hashes[0] !== c2 || !hashes.includes(c1)) throw new Error(`提交历史与 git log 不一致：${hashes.join(',')}`)
    if (hist?.json?.data?.[0]?.files?.[0] !== 'b.txt') throw new Error('提交变更文件列表错误')
    const since = await request(
      `${BASE}/api/v1/git/repo/commits?path=${encodeURIComponent(gitRepoDir)}&since=${c1}`,
    )
    if (since?.json?.data?.length !== 1 || since?.json?.data?.[0]?.hash !== c2) {
      throw new Error('since 过滤错误（应仅剩 c2）')
    }

    // 带仓库会话：start_head = 当前 HEAD
    const gws = await request(`${BASE}/api/v1/workspaces`, {
      method: 'POST',
      body: { name: `verify-git-${Date.now()}` },
    })
    gitWorkspaceId = gws?.json?.data?.id
    if (gws?.json?.code !== 0 || !gitWorkspaceId) throw new Error(`git 工作区创建失败：${JSON.stringify(gws?.json)}`)
    const gsess = await request(`${BASE}/api/v1/workspaces/${gitWorkspaceId}/sessions`, {
      method: 'POST',
      body: { title: '验收 Git 会话', repoPath: gitRepoDir },
    })
    const gsid = gsess?.json?.data?.id
    if (gsess?.json?.code !== 0 || gsess?.json?.data?.startHead !== c2) {
      throw new Error(`start_head 应等于当前 HEAD：${JSON.stringify(gsess?.json)}`)
    }

    // 新提交感知：会话开始后再提交 c3，since=start_head 应只返回 c3（07 §6 验收「≤10s 出现」）
    await write('c.txt', 'three')
    await runGit(['add', '.'])
    await runGit(['commit', '-q', '-m', 'c3 新提交'])
    const c3 = await runGit(['rev-parse', 'HEAD'])
    const news = await request(
      `${BASE}/api/v1/git/repo/commits?path=${encodeURIComponent(gitRepoDir)}&since=${gsess?.json?.data?.startHead}`,
    )
    if (news?.json?.data?.length !== 1 || news?.json?.data?.[0]?.hash !== c3) {
      throw new Error(`新提交感知失败（since=start_head 应只返回 c3）：${JSON.stringify(news?.json)}`)
    }

    // 追加条目携带 commitHashes 绑定 → 会话绑定列表 → 详情回填
    const gent = await request(`${BASE}/api/v1/sessions/${gsid}/entries`, {
      method: 'POST',
      body: { type: 'artifact', contentMd: 'c3 产出', commitHashes: [c3] },
    })
    if (gent?.json?.code !== 0 || gent?.json?.data?.commits?.[0] !== c3) {
      throw new Error(`创建时绑定失败：${JSON.stringify(gent?.json)}`)
    }
    const bound = await request(`${BASE}/api/v1/sessions/${gsid}/commits`)
    if (bound?.json?.data?.length !== 1 || bound?.json?.data?.[0]?.commitHash !== c3) {
      throw new Error('会话绑定列表错误')
    }
    const gdetail = await request(`${BASE}/api/v1/sessions/${gsid}`)
    if (gdetail?.json?.data?.entries?.[0]?.commits?.[0] !== c3) throw new Error('详情条目未回填 commits')

    // 防造假：仓库不存在的 hash 绑定 → 400
    const fake = await request(`${BASE}/api/v1/entries/${gent?.json?.data?.id}/commits`, {
      method: 'POST',
      body: { commitHashes: ['0'.repeat(40)] },
    })
    if (fake?.json?.code !== 400) throw new Error('不存在的提交应拒绝绑定（400）')

    // 导出往返（M3 总验收 / 06 §9）：git 会话导出含绑定提交行与 gitRange（start_head=c2、end_head=null）
    const gexp = await request(`${BASE}/api/v1/sessions/${gsid}/export/markdown`)
    const gparsed = parseSessionMarkdown(gexp?.json?.data)
    if (gparsed.entries?.[0]?.commits?.[0] !== c3) throw new Error('导出应还原绑定提交（> git 行）')
    if (gparsed.frontmatter.session.gitRange?.[0] !== c2 || gparsed.frontmatter.session.gitRange?.[1] !== null) {
      throw new Error(`导出 gitRange 错误：${JSON.stringify(gparsed.frontmatter.session.gitRange)}`)
    }

    // 解绑 → 绑定列表清空；删除会话级联清理 entry_commit；清理临时仓库与工作区
    const unbind = await request(`${BASE}/api/v1/entries/${gent?.json?.data?.id}/commits/${c3}`, {
      method: 'DELETE',
    })
    if (unbind?.json?.code !== 0) throw new Error('解绑失败')
    const bound2 = await request(`${BASE}/api/v1/sessions/${gsid}/commits`)
    if ((bound2?.json?.data || []).length !== 0) throw new Error('解绑后绑定列表应清空')
    const rebind = await request(`${BASE}/api/v1/entries/${gent?.json?.data?.id}/commits`, {
      method: 'POST',
      body: { commitHashes: [c3] },
    })
    if (rebind?.json?.code !== 0) throw new Error('重新绑定失败')
    const delGs = await request(`${BASE}/api/v1/sessions/${gsid}`, { method: 'DELETE' })
    if (delGs?.json?.code !== 0) throw new Error('删除 Git 会话失败')
    const ecLeft = await mysql(
      `SELECT COUNT(*) FROM trailmind.entry_commit WHERE entry_id=${gent?.json?.data?.id}`,
      deps,
    )
    if (ecLeft !== '0') throw new Error(`删除会话后 entry_commit 残留 ${ecLeft}`)
    await request(`${BASE}/api/v1/workspaces/${gitWorkspaceId}`, { method: 'DELETE' })
    gitWorkspaceId = null
    await fs.promises.rm(gitRepoDir, { recursive: true, force: true })
    gitRepoDir = null

    results.push({
      ok: true,
      name: 'git 服务往返（status/历史 since/start_head/新提交感知/绑定解绑/详情回填/防造假 400/级联清理）',
    })
  } catch (e) {
    results.push({ ok: false, name: 'git 服务往返', error: e.message })
    if (gitWorkspaceId != null) {
      await request(`${BASE}/api/v1/workspaces/${gitWorkspaceId}`, { method: 'DELETE' }).catch(() => {})
    }
    if (gitRepoDir != null) {
      await fs.promises.rm(gitRepoDir, { recursive: true, force: true }).catch(() => {})
    }
  }

  // 6.5 全局搜索往返（M4 任务一）：建含关键词的导图/会话/条目 → 全类型命中（FULLTEXT ngram + 标题 LIKE）→
  //     type/workspaceId 过滤 → 单字 LIKE 兜底 → 片段/节点定位回填 → 清理（额外建的空工作区一并删除）
  let searchOtherWid = null
  try {
    if (!workspaceId) throw new Error('依赖第 3 步的 workspace id')
    const kw = `搜验${process.pid}${Date.now()}`

    // 导图：n2 节点文本含关键词（search_text 含节点文本 → FULLTEXT 命中；nodeId 定位 n2）
    const smContent = JSON.stringify({
      version: 1,
      rootNodeId: 'n1',
      nodes: {
        n1: { id: 'n1', text: '根', note: '', style: {}, tags: [], parentId: null, layout: null, collapsed: false },
        n2: { id: 'n2', text: `节点 ${kw}`, note: '', style: {}, tags: [], parentId: 'n1', layout: null, collapsed: false },
      },
      edges: [],
    })
    const sm = await request(`${BASE}/api/v1/workspaces/${workspaceId}/mindmaps`, {
      method: 'POST',
      body: { name: '搜索导图', contentJson: smContent },
    })
    const smId = sm?.json?.data?.id
    if (sm?.json?.code !== 0 || !smId) throw new Error(`搜索导图创建失败：${JSON.stringify(sm?.json)}`)

    // 会话：标题含关键词（标题 LIKE 命中）
    const ss = await request(`${BASE}/api/v1/workspaces/${workspaceId}/sessions`, {
      method: 'POST',
      body: { title: `搜索会话 ${kw}` },
    })
    const ssId = ss?.json?.data?.id
    if (ss?.json?.code !== 0 || !ssId) throw new Error(`搜索会话创建失败：${JSON.stringify(ss?.json)}`)

    // 条目：正文含关键词（content_md FULLTEXT 命中）；另加罕见单字条目（单字 LIKE 兜底）
    const se = await request(`${BASE}/api/v1/sessions/${ssId}/entries`, {
      method: 'POST',
      body: { type: 'note', contentMd: `全局搜索条目 ${kw} 正文` },
    })
    if (se?.json?.code !== 0) throw new Error(`搜索条目创建失败：${JSON.stringify(se?.json)}`)
    const seId = se?.json?.data?.id
    const sc = await request(`${BASE}/api/v1/sessions/${ssId}/entries`, {
      method: 'POST',
      body: { type: 'note', contentMd: '罕见字 龘 条目' },
    })
    if (sc?.json?.code !== 0) throw new Error(`单字条目创建失败：${JSON.stringify(sc?.json)}`)

    // 全类型命中 + 片段 + 节点定位（workspaceId 圈定范围，结果确定）
    const all = await request(`${BASE}/api/v1/search?q=${encodeURIComponent(kw)}&workspaceId=${workspaceId}`)
    const data = all?.json?.data
    if (all?.json?.code !== 0) throw new Error(`搜索失败：${JSON.stringify(all?.json)}`)
    const mhit = data?.mindmaps?.find((m) => m.id === smId)
    if (!mhit) throw new Error('导图未命中搜索')
    if (mhit.nodeId !== 'n2') throw new Error(`导图命中 nodeId=${mhit.nodeId} ≠ n2`)
    if (!(mhit.snippet || '').includes(kw)) throw new Error('导图片段未包含关键词')
    const ehit = data?.entries?.find((e) => e.id === seId)
    if (!ehit) throw new Error('条目未命中搜索')
    if (ehit.sessionId !== ssId || ehit.seq !== 1) throw new Error('条目命中上下文（sessionId/seq）错误')
    if (!(ehit.snippet || '').includes(kw)) throw new Error('条目片段未包含关键词')
    if (!data?.sessions?.some((s) => s.id === ssId)) throw new Error('会话标题未命中搜索（LIKE）')

    // type 过滤：type=entry 只返回条目类
    const only = await request(`${BASE}/api/v1/search?q=${encodeURIComponent(kw)}&type=entry&workspaceId=${workspaceId}`)
    if ((only?.json?.data?.entries?.length ?? 0) !== 1) throw new Error('type=entry 应仅 1 条条目命中')
    if ((only?.json?.data?.mindmaps?.length ?? 0) !== 0 || (only?.json?.data?.sessions?.length ?? 0) !== 0) {
      throw new Error('type=entry 不应返回导图/会话')
    }

    // 单字 LIKE 兜底（ngram_token_size=2 无法索引单字；workspaceId 圈定断言确定）
    const single = await request(`${BASE}/api/v1/search?q=%E9%BE%98&workspaceId=${workspaceId}`)
    if ((single?.json?.data?.entries?.length ?? 0) !== 1) throw new Error('单字搜索应命中 1 条条目（LIKE 兜底）')

    // workspaceId 过滤负例：其它空工作区搜同词 → 全空
    const so = await request(`${BASE}/api/v1/workspaces`, { method: 'POST', body: { name: `搜索负例-${kw}` } })
    searchOtherWid = so?.json?.data?.id
    if (so?.json?.code !== 0 || !searchOtherWid) throw new Error('负例工作区创建失败')
    const neg = await request(`${BASE}/api/v1/search?q=${encodeURIComponent(kw)}&workspaceId=${searchOtherWid}`)
    if ((neg?.json?.data?.mindmaps?.length ?? 0) + (neg?.json?.data?.entries?.length ?? 0) + (neg?.json?.data?.sessions?.length ?? 0) !== 0) {
      throw new Error('其它工作区搜同词应无结果')
    }

    // 参数校验：空关键词 400、非法 type 400
    const blank = await request(`${BASE}/api/v1/search?q=%20%20`)
    if (blank?.json?.code !== 400) throw new Error('空关键词应返回 400')
    const badType = await request(`${BASE}/api/v1/search?q=${encodeURIComponent(kw)}&type=bogus`)
    if (badType?.json?.code !== 400) throw new Error('非法 type 应返回 400')

    // 清理：搜索会话/导图随第 8 步工作区级联删除；负例工作区在此删除
    await request(`${BASE}/api/v1/workspaces/${searchOtherWid}`, { method: 'DELETE' })
    searchOtherWid = null

    results.push({
      ok: true,
      name: '全局搜索往返（FULLTEXT 命中/标题 LIKE/type 过滤/单字 LIKE 兜底/片段与节点定位/400 校验）',
    })
  } catch (e) {
    results.push({ ok: false, name: '全局搜索往返', error: e.message })
    if (searchOtherWid != null) {
      await request(`${BASE}/api/v1/workspaces/${searchOtherWid}`, { method: 'DELETE' }).catch(() => {})
    }
  }

  // 6.6 标签往返（M4 任务二）：创建（重复 400）→ 条目打标签 → 列表计数 → 重命名（条目读回新名=全局生效）→
  //     按标签筛（含会话内过滤）→ 合并（条目重挂目标、源删除）→ 删除（entry_tag 级联清理）
  try {
    if (!workspaceId) throw new Error('依赖第 3 步的 workspace id')
    const tagKw = `标验${process.pid}${Date.now()}`
    const t1 = await request(`${BASE}/api/v1/tags`, {
      method: 'POST',
      body: { workspaceId, name: `${tagKw}甲` },
    })
    const t2 = await request(`${BASE}/api/v1/tags`, {
      method: 'POST',
      body: { workspaceId, name: `${tagKw}乙` },
    })
    const t1Id = t1?.json?.data?.id
    const t2Id = t2?.json?.data?.id
    if (t1?.json?.code !== 0 || t2?.json?.code !== 0 || !t1Id || !t2Id) {
      throw new Error(`标签创建失败：${JSON.stringify(t1?.json)} / ${JSON.stringify(t2?.json)}`)
    }
    const dup = await request(`${BASE}/api/v1/tags`, { method: 'POST', body: { workspaceId, name: `${tagKw}甲` } })
    if (dup?.json?.code !== 400) throw new Error('重复标签应返回 400')

    const tsess = await request(`${BASE}/api/v1/workspaces/${workspaceId}/sessions`, {
      method: 'POST',
      body: { title: '标签验收会话' },
    })
    const tsid = tsess?.json?.data?.id
    if (tsess?.json?.code !== 0 || !tsid) throw new Error('标签会话创建失败')
    const te = await request(`${BASE}/api/v1/sessions/${tsid}/entries`, {
      method: 'POST',
      body: { type: 'action', contentMd: '标签条目', tags: [`${tagKw}甲`, `${tagKw}乙`] },
    })
    if (te?.json?.code !== 0) throw new Error('打标签条目创建失败')

    const tagsList = await request(`${BASE}/api/v1/tags?workspaceId=${workspaceId}`)
    const t1row = tagsList?.json?.data?.find((t) => t.id === t1Id)
    if (!t1row || t1row.entryCount !== 1) throw new Error(`标签计数错误：${JSON.stringify(t1row)}`)

    // 重命名全局生效：条目读回新名
    const renamed = await request(`${BASE}/api/v1/tags/${t1Id}`, {
      method: 'PUT',
      body: { name: `${tagKw}甲改` },
    })
    if (renamed?.json?.code !== 0 || renamed?.json?.data?.name !== `${tagKw}甲改`) {
      throw new Error(`重命名失败：${JSON.stringify(renamed?.json)}`)
    }
    const tsessDetail = await request(`${BASE}/api/v1/sessions/${tsid}`)
    const entryTags = tsessDetail?.json?.data?.entries?.[0]?.tags ?? []
    if (!entryTags.includes(`${tagKw}甲改`)) throw new Error(`重命名未全局生效：${JSON.stringify(entryTags)}`)

    // 按标签筛（会话内过滤命中 1 条，tagId 不存在的 404）
    const filtered = await request(`${BASE}/api/v1/entries?tagId=${t1Id}&sessionId=${tsid}`)
    if (filtered?.json?.data?.length !== 1 || filtered?.json?.data?.[0]?.sessionTitle !== '标签验收会话') {
      throw new Error(`按标签筛错误：${JSON.stringify(filtered?.json)}`)
    }
    const missingTag = await request(`${BASE}/api/v1/entries?tagId=99999999`)
    if (missingTag?.json?.code !== 404) throw new Error('不存在的标签筛条目应 404')

    // 合并：乙合并进甲改 → 源删除、条目归目标
    const merged = await request(`${BASE}/api/v1/tags/${t2Id}/merge`, {
      method: 'POST',
      body: { targetId: t1Id },
    })
    if (merged?.json?.code !== 0 || merged?.json?.data?.id !== t1Id) {
      throw new Error(`合并失败：${JSON.stringify(merged?.json)}`)
    }
    const tagsAfter = await request(`${BASE}/api/v1/tags?workspaceId=${workspaceId}`)
    const tagNames = (tagsAfter?.json?.data ?? []).map((t) => t.name)
    if (tagNames.includes(`${tagKw}乙`)) throw new Error('合并后源标签应删除')
    if (!tagNames.includes(`${tagKw}甲改`)) throw new Error('合并后目标标签应保留')
    const afterFilter = await request(`${BASE}/api/v1/entries?tagId=${t1Id}`)
    if (afterFilter?.json?.data?.length !== 1 || afterFilter?.json?.data?.[0]?.tags?.length !== 1) {
      throw new Error(`合并后条目标签错误：${JSON.stringify(afterFilter?.json?.data)}`)
    }

    // 删除：entry_tag 级联清理
    const delTag = await request(`${BASE}/api/v1/tags/${t1Id}`, { method: 'DELETE' })
    if (delTag?.json?.code !== 0) throw new Error('删除标签失败')
    const tagLeft = await mysql(
      `SELECT COUNT(*) FROM trailmind.entry_tag WHERE tag_id=${t1Id}`,
      deps,
    )
    if (tagLeft !== '0') throw new Error(`删除标签后 entry_tag 残留 ${tagLeft}`)

    results.push({
      ok: true,
      name: '标签往返（创建/重复 400/计数/重命名全局生效/按标签筛/合并/删除级联）',
    })
  } catch (e) {
    results.push({ ok: false, name: '标签往返', error: e.message })
  }

  // 6.7 导出往返（M4 任务三，07 §7 验收「会话导出 100% 还原、导图 PNG 完整、OPML 可导入」）：
  //     会话 → JSON（trailmind-session-json v1，字段逐项比对）｜ 导图 → OPML（树状层级/备注/标签还原、自由边忽略）
  //     ｜ 导图 → PNG（Base64 → PNG 魔数 + IHDR 尺寸 > 0）｜ 非法导出类型 400
  try {
    if (!workspaceId) throw new Error('依赖第 3 步的 workspace id')

    // 导图：根 → 子 → 孙（含备注/标签）+ 1 条自由连线（OPML 应忽略、PNG 应整图）
    const expContent = JSON.stringify({
      version: 1,
      rootNodeId: 'n1',
      nodes: {
        n1: {
          id: 'n1', text: '导出根', note: '根备注', style: { color: 'indigo', bold: true, shape: 'rounded' },
          tags: ['导出标签'], parentId: null, layout: null, collapsed: false, sticky: false,
        },
        n2: {
          id: 'n2', text: '导出子', note: '子备注', style: { color: 'green', bold: false, shape: 'ellipse' },
          tags: [], parentId: 'n1', layout: null, collapsed: false, sticky: false,
        },
        n3: {
          id: 'n3', text: '导出孙', note: '', style: { color: 'default', bold: false, shape: 'rect' },
          tags: [], parentId: 'n2', layout: null, collapsed: false, sticky: false,
        },
      },
      edges: [{ id: 'e1', source: 'n1', target: 'n2', type: 'free', label: '自由连线应忽略' }],
    })
    const em = await request(`${BASE}/api/v1/workspaces/${workspaceId}/mindmaps`, {
      method: 'POST',
      body: { name: '导出导图', contentJson: expContent },
    })
    const emId = em?.json?.data?.id
    if (em?.json?.code !== 0 || !emId) throw new Error(`导出导图创建失败：${JSON.stringify(em?.json)}`)

    const opml = await request(`${BASE}/api/v1/mindmaps/${emId}/export?type=OPML`, { method: 'POST' })
    if (opml?.json?.code !== 0) throw new Error(`OPML 导出失败：${JSON.stringify(opml?.json)}`)
    if (opml.json.data.filename !== '导出导图.opml') throw new Error(`OPML 文件名错误：${opml.json.data.filename}`)
    const opmlRoots = parseOpmlOutlines(opml.json.data.content)
    if (opmlRoots.length !== 1) throw new Error(`OPML 根节点数 ${opmlRoots.length} ≠ 1`)
    const opmlRoot = opmlRoots[0]
    if (opmlRoot.text !== '导出根' || opmlRoot.note !== '根备注' || opmlRoot.category !== '导出标签') {
      throw new Error(`OPML 根节点属性错误：${JSON.stringify(opmlRoot)}`)
    }
    if (opmlRoot.children?.[0]?.text !== '导出子' || opmlRoot.children[0].note !== '子备注') {
      throw new Error(`OPML 子节点属性错误：${JSON.stringify(opmlRoot.children?.[0])}`)
    }
    if (opmlRoot.children[0]?.children?.[0]?.text !== '导出孙') throw new Error('OPML 孙节点层级未还原')
    if (opml.json.data.content.includes('自由连线应忽略')) throw new Error('OPML 不应包含自由连线（无法表达）')

    const png = await request(`${BASE}/api/v1/mindmaps/${emId}/export?type=PNG`, { method: 'POST' })
    if (png?.json?.code !== 0) throw new Error(`PNG 导出失败：${JSON.stringify(png?.json)}`)
    if (png.json.data.filename !== '导出导图.png' || png.json.data.contentType !== 'image/png') {
      throw new Error(`PNG 产物元数据错误：${JSON.stringify(png.json.data)}`)
    }
    const pngInfo = pngInfoFromBase64(png.json.data.content)
    if (pngInfo.width <= 0 || pngInfo.height <= 0) throw new Error(`PNG 尺寸非法：${JSON.stringify(pngInfo)}`)

    const badType = await request(`${BASE}/api/v1/mindmaps/${emId}/export?type=MD`, { method: 'POST' })
    if (badType?.json?.code !== 400) throw new Error('非法导图导出类型应返回 400')

    // 会话 → JSON：2 条不同类型条目 + 标签，字段逐项还原（PRD C5，机器可读协议）
    const es = await request(`${BASE}/api/v1/workspaces/${workspaceId}/sessions`, {
      method: 'POST',
      body: { title: '导出 JSON 会话' },
    })
    const esId = es?.json?.data?.id
    if (es?.json?.code !== 0 || !esId) throw new Error(`导出会话创建失败：${JSON.stringify(es?.json)}`)
    const e1 = await request(`${BASE}/api/v1/sessions/${esId}/entries`, {
      method: 'POST',
      body: { type: 'goal', contentMd: '导出目标', tags: ['导出标签'] },
    })
    const e2 = await request(`${BASE}/api/v1/sessions/${esId}/entries`, {
      method: 'POST',
      body: { type: 'note', contentMd: '导出备注' },
    })
    if (e1?.json?.code !== 0 || e2?.json?.code !== 0) throw new Error('导出会话条目创建失败')

    const sj = await request(`${BASE}/api/v1/sessions/${esId}/export/json`)
    const sjData = sj?.json?.data
    if (sj?.json?.code !== 0 || sjData?.format !== 'trailmind-session-json' || sjData?.version !== 1) {
      throw new Error(`会话 JSON 格式标识错误：${JSON.stringify(sj?.json)}`)
    }
    if (sjData.session?.title !== '导出 JSON 会话' || sjData.session?.status !== 'active') {
      throw new Error(`会话 JSON 会话字段错误：${JSON.stringify(sjData.session)}`)
    }
    if (sjData.entryCount !== 2 || sjData.entries?.length !== 2) {
      throw new Error(`会话 JSON 条目数错误：${JSON.stringify({ entryCount: sjData.entryCount, n: sjData.entries?.length })}`)
    }
    const sjGoal = sjData.entries[0]
    if (sjGoal.seq !== 1 || sjGoal.type !== 'goal' || sjGoal.contentMd !== '导出目标') {
      throw new Error(`会话 JSON 条目 1 未还原：${JSON.stringify(sjGoal)}`)
    }
    if (JSON.stringify(sjGoal.tags) !== JSON.stringify(['导出标签'])) throw new Error('会话 JSON 标签未还原')
    if (typeof sjGoal.createdAt !== 'string' || !sjGoal.createdAt.includes('T')) throw new Error('会话 JSON 时间应为 ISO-8601 字符串')
    if (sjData.entries[1].type !== 'note' || sjData.entries[1].contentMd !== '导出备注') throw new Error('会话 JSON 条目 2 未还原')

    const missingJson = await request(`${BASE}/api/v1/sessions/99999999/export/json`)
    if (missingJson?.json?.code !== 404) throw new Error('不存在的会话导出 JSON 应返回 404')

    results.push({
      ok: true,
      name: `导出往返（会话 JSON v1 字段还原 2/2 + 导图 OPML 层级/备注/标签还原 + PNG ${pngInfo.width}×${pngInfo.height} 有效 + 非法类型 400）`,
    })
  } catch (e) {
    results.push({ ok: false, name: '导出往返（JSON/OPML/PNG）', error: e.message })
  }

  // 6.8 设置往返（M4 任务四，07 §7「设置页：数据库连接信息展示、主题切换、仓库路径」）：
  //     GET 数据库连接信息 → 主题非法值 400 / dark 往返（结束后还原）→ 默认仓库路径非法 400 / 真实仓库往返 →
  //     会话回退链（无仓库工作区 + 无仓库会话 → 继承全局默认仓库路径）→ 清除路径并还原
  let settingsWsId = null
  let settingsSessId = null
  let settingsRepoDir = null
  try {
    const initSettings = await request(`${BASE}/api/v1/settings`)
    if (initSettings?.json?.code !== 0) throw new Error(`GET /settings 失败：${JSON.stringify(initSettings?.json)}`)
    const dbInfo = initSettings?.json?.data?.database
    if (dbInfo?.host !== '127.0.0.1' || dbInfo?.port !== 3306 || dbInfo?.database !== 'trailmind') {
      throw new Error(`数据库连接信息错误：${JSON.stringify(dbInfo)}`)
    }
    const initialTheme = initSettings.json.data.theme

    const badTheme = await request(`${BASE}/api/v1/settings`, { method: 'PUT', body: { theme: 'blue' } })
    if (badTheme?.json?.code !== 400) throw new Error('非法主题应返回 400')
    const dark = await request(`${BASE}/api/v1/settings`, { method: 'PUT', body: { theme: 'dark' } })
    if (dark?.json?.code !== 0 || dark?.json?.data?.theme !== 'dark') {
      throw new Error(`主题切换失败：${JSON.stringify(dark?.json)}`)
    }
    const readDark = await request(`${BASE}/api/v1/settings`)
    if (readDark?.json?.data?.theme !== 'dark') throw new Error('主题读回不等于 dark')

    const badRepo = await request(`${BASE}/api/v1/settings`, {
      method: 'PUT',
      body: { defaultRepoPath: 'C:/__trailmind_missing__' },
    })
    if (badRepo?.json?.code !== 400) throw new Error('无 .git 目录的仓库路径应返回 400')

    // 真实临时仓库 + 回退链：无仓库工作区 + 无仓库会话 → 继承全局默认仓库路径
    settingsRepoDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'trailmind-verify-settings-'))
    await execOut('git', ['init', '-q'], { cwd: settingsRepoDir })
    const setRepo = await request(`${BASE}/api/v1/settings`, {
      method: 'PUT',
      body: { defaultRepoPath: settingsRepoDir },
    })
    if (setRepo?.json?.code !== 0 || setRepo?.json?.data?.defaultRepoPath !== settingsRepoDir) {
      throw new Error(`默认仓库路径保存失败：${JSON.stringify(setRepo?.json)}`)
    }
    const sws = await request(`${BASE}/api/v1/workspaces`, {
      method: 'POST',
      body: { name: `verify-settings-${Date.now()}` },
    })
    settingsWsId = sws?.json?.data?.id
    if (sws?.json?.code !== 0 || !settingsWsId) throw new Error('设置验收工作区创建失败')
    const ssess = await request(`${BASE}/api/v1/workspaces/${settingsWsId}/sessions`, {
      method: 'POST',
      body: { title: '默认仓库会话' },
    })
    settingsSessId = ssess?.json?.data?.id
    if (ssess?.json?.code !== 0 || ssess?.json?.data?.repoPath !== settingsRepoDir) {
      throw new Error(`会话未继承默认仓库路径：${JSON.stringify(ssess?.json)}`)
    }

    // 清理：删会话/工作区；清除默认仓库路径；主题还原；删临时仓库
    await request(`${BASE}/api/v1/sessions/${settingsSessId}`, { method: 'DELETE' })
    settingsSessId = null
    await request(`${BASE}/api/v1/workspaces/${settingsWsId}`, { method: 'DELETE' })
    settingsWsId = null
    const cleared = await request(`${BASE}/api/v1/settings`, {
      method: 'PUT',
      body: { theme: initialTheme, defaultRepoPath: '' },
    })
    if (cleared?.json?.code !== 0 || cleared?.json?.data?.defaultRepoPath != null) {
      throw new Error(`默认仓库路径清除失败：${JSON.stringify(cleared?.json)}`)
    }
    await fs.promises.rm(settingsRepoDir, { recursive: true, force: true })
    settingsRepoDir = null

    results.push({
      ok: true,
      name: '设置往返（数据库连接信息/主题 dark 往返 + 非法 400/默认仓库路径会话回退链/清除还原）',
    })
  } catch (e) {
    results.push({ ok: false, name: '设置往返', error: e.message })
    if (settingsSessId != null) {
      await request(`${BASE}/api/v1/sessions/${settingsSessId}`, { method: 'DELETE' }).catch(() => {})
    }
    if (settingsWsId != null) {
      await request(`${BASE}/api/v1/workspaces/${settingsWsId}`, { method: 'DELETE' }).catch(() => {})
    }
    if (settingsRepoDir != null) {
      await fs.promises.rm(settingsRepoDir, { recursive: true, force: true }).catch(() => {})
    }
  }

  // 6.9 备份往返（M4 任务六，PRD E5 / 04 §5 POST /backup/export）：
  //     导出全量 zip → Base64 解码 → 解析 trailmind-backup.json → format/version/8 表齐全且含当前工作区数据
  try {
    const bk = await request(`${BASE}/api/v1/backup/export`, { method: 'POST' })
    if (bk?.json?.code !== 0) throw new Error(`备份导出失败：${JSON.stringify(bk?.json)}`)
    const file = bk?.json?.data
    if (!file?.filename?.endsWith('.zip') || file?.contentType !== 'application/zip') {
      throw new Error(`备份产物元信息错误：${JSON.stringify(file)}`)
    }
    const buf = Buffer.from(file.content, 'base64')
    const doc = unzipBackupJson(buf)
    if (doc?.format !== 'trailmind-backup' || doc?.version !== 1) {
      throw new Error(`备份格式标识错误：format=${doc?.format} version=${doc?.version}`)
    }
    const tables = doc?.tables || {}
    const expectedTables = EXPECTED_TABLES.filter((t) => t !== 'entry_tag' && t !== 'entry_commit')
      .concat(['entry_tag', 'entry_commit'])
    for (const t of expectedTables) {
      if (!Array.isArray(tables[t])) throw new Error(`备份缺少表 ${t}`)
    }
    // 当前工作区（本段之前各往返创建的数据）应包含在备份中
    const inBackup = (tables.workspace || []).some((w) => w.id === workspaceId)
    if (!inBackup) throw new Error(`备份中未找到工作区 ${workspaceId}`)
    results.push({ ok: true, name: `备份往返（zip ${file.filename} → trailmind-backup v1 → 8 表齐全 + 当前工作区在内）` })
  } catch (e) {
    results.push({ ok: false, name: '备份往返', error: e.message })
  }

  // 7. M3 总验收：10 条不同类型条目计时（单条 ≤10s，NFR）+ 会话 Markdown 导出往返（06 §4 解析 → 与库中数据逐一比对）
  let acceptSessionId = null
  try {
    if (!workspaceId) throw new Error('依赖第 3 步的 workspace id')
    const asess = await request(`${BASE}/api/v1/workspaces/${workspaceId}/sessions`, {
      method: 'POST',
      body: { title: '验收导出会话' },
    })
    acceptSessionId = asess?.json?.data?.id
    if (asess?.json?.code !== 0 || !acceptSessionId) throw new Error(`验收会话创建失败：${JSON.stringify(asess?.json)}`)

    const types = ['goal', 'context', 'prompt', 'action', 'artifact', 'decision', 'error', 'test', 'review', 'note']
    let worstMs = 0
    for (let i = 0; i < types.length; i++) {
      const t0 = Date.now()
      const r = await request(`${BASE}/api/v1/sessions/${acceptSessionId}/entries`, {
        method: 'POST',
        body: { type: types[i], contentMd: `第 ${i + 1} 条 · ${types[i]} 验收内容`, tags: i % 2 === 0 ? ['验收标签'] : [] },
      })
      const ms = Date.now() - t0
      if (r?.json?.code !== 0) throw new Error(`第 ${i + 1} 条写入失败：${JSON.stringify(r?.json)}`)
      if (ms > 10000) throw new Error(`第 ${i + 1} 条耗时 ${ms}ms 超过 10s（NFR）`)
      worstMs = Math.max(worstMs, ms)
    }

    const ex = await request(`${BASE}/api/v1/sessions/${acceptSessionId}/export/markdown`)
    const parsed = parseSessionMarkdown(ex?.json?.data)
    const detail = await request(`${BASE}/api/v1/sessions/${acceptSessionId}?page=1&size=50`)
    const apiEntries = detail?.json?.data?.entries || []
    if (parsed.entries.length !== 10 || apiEntries.length !== 10) {
      throw new Error(`导出/API 条目数不符：${parsed.entries.length}/${apiEntries.length}`)
    }
    if (parsed.frontmatter.session.title !== '验收导出会话') throw new Error('导出 frontmatter 标题错误')
    if (parsed.frontmatter.entries !== 10) throw new Error('导出 frontmatter entries 计数错误')
    parsed.entries.forEach((p, i) => {
      const d = apiEntries[i]
      if (p.type !== d.type) throw new Error(`第 ${i + 1} 条类型 ${p.type} ≠ ${d.type}`)
      if (p.time !== (d.createdAt || '').slice(11, 16)) throw new Error(`第 ${i + 1} 条时间 ${p.time} 未还原`)
      if (p.content !== d.contentMd) throw new Error(`第 ${i + 1} 条内容未还原`)
      if (JSON.stringify(p.tags) !== JSON.stringify(d.tags)) throw new Error(`第 ${i + 1} 条标签未还原`)
    })

    await request(`${BASE}/api/v1/sessions/${acceptSessionId}`, { method: 'DELETE' })
    acceptSessionId = null
    results.push({
      ok: true,
      name: `M3 总验收：10 条不同类型条目写入最慢 ${worstMs}ms/条（≤10s）+ 导出→解析→比对 10/10 还原`,
    })
  } catch (e) {
    results.push({ ok: false, name: 'M3 总验收（10 条目计时 + 导出往返）', error: e.message })
    if (acceptSessionId != null) {
      await request(`${BASE}/api/v1/sessions/${acceptSessionId}`, { method: 'DELETE' }).catch(() => {})
    }
  }

  // 8. workspace 级联删除（连同第 4 步创建的导图 + 本步补建的会话与标签）
  try {
    // 补建一个会话，验证工作区删除时会话/标签级联（条目级联见第 5 步）
    const s2 = await request(`${BASE}/api/v1/workspaces/${workspaceId}/sessions`, {
      method: 'POST',
      body: { title: '级联会话' },
    })
    if (s2?.json?.code !== 0) throw new Error(`补建会话失败：${JSON.stringify(s2?.json)}`)

    const deleted = await request(`${BASE}/api/v1/workspaces/${workspaceId}`, { method: 'DELETE' })
    if (deleted?.json?.code !== 0) throw new Error(`删除失败：${JSON.stringify(deleted?.json)}`)
    const leftovers = await mysql(
      `SELECT COUNT(*) FROM trailmind.mindmap WHERE workspace_id=${workspaceId}`,
      deps,
    )
    if (leftovers !== '0') throw new Error(`级联删除后残留 ${leftovers} 张导图`)
    const sessionLeft = await mysql(
      `SELECT COUNT(*) FROM trailmind.session WHERE workspace_id=${workspaceId}`,
      deps,
    )
    if (sessionLeft !== '0') throw new Error(`级联删除后残留 ${sessionLeft} 个会话`)
    const tagLeftover = await mysql(
      `SELECT COUNT(*) FROM trailmind.tag WHERE workspace_id=${workspaceId}`,
      deps,
    )
    if (tagLeftover !== '0') throw new Error(`级联删除后残留 ${tagLeftover} 个标签`)
    results.push({ ok: true, name: 'workspace 级联删除（导图/会话/标签随之清理）' })
  } catch (e) {
    results.push({ ok: false, name: 'workspace 级联删除', error: e.message })
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
