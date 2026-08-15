// 验收冒烟（docs/10 §10/§12 起）：/health → schema 表齐全 → workspace 往返 → mindmap 往返（M2 总验收补充）
// → session/entry 往返（M3 任务一：start_head、seq 1/2/3、标签、分页、编辑、结束写 review、追加限制、级联删除）
// → git 服务往返（M3 任务三：仓库校验、提交历史、since=start_head 新提交感知、绑定/解绑、详情回填、级联清理）→ 输出 ALL PASS。
// 仅依赖 Node 内建（http/child_process/fs）+ 系统 git 命令，无第三方依赖。前置：后端已在 127.0.0.1:17860 运行、MySQL 可连（DB_PASS/MYSQL_PWD）。
import http from 'node:http'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { execFile } from 'node:child_process'
import { parseSessionMarkdown } from './session-export.mjs'

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
