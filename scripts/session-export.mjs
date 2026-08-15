// 会话 Markdown 导出格式解析器（docs/06 §4 解析规则，agent 消费协议 + 导出往返测试用）。
// 仅解析本协议自身的导出产物（frontmatter 子集 + 条目分隔符 + git/标签元数据行），非通用 YAML/Markdown 解析器。
// 解析规则（06 §4）：
// 1. YAML frontmatter 中 format: trailmind-session 是本格式标识
// 2. 条目以 `## [type] HH:mm · 类型名` 为分隔符；type 必须是 §2 枚举
// 3. `> git: \`hash\`` 行表示绑定提交；`> 标签：\`a\` \`b\`` 行表示标签；两者为条目级元数据，可同时存在
// 4. 条目正文为分隔符到下一分隔符之间的全部 Markdown
// 5. 时间以条目标题中的 HH:mm + frontmatter startedAt 日期组合还原

export const ENTRY_TYPES = [
  'goal',
  'context',
  'prompt',
  'action',
  'artifact',
  'decision',
  'error',
  'test',
  'review',
  'next',
  'note',
]

/** YAML 标量（本协议子集）：null / "引号字符串（转义 \" \\ \n）" / 裸词。 */
function parseYamlScalar(raw) {
  const t = raw.trim()
  if (t === 'null') return null
  if (t.startsWith('"') && t.endsWith('"')) {
    return t
      .slice(1, -1)
      .replace(/\\n/g, '\n')
      .replace(/\\"/g, '"')
      .replace(/\\\\/g, '\\')
  }
  return t
}

/** gitRange: ["hash", "hash"] → 数组（元素可为 null）。 */
function parseGitRange(raw) {
  const inner = raw.trim().replace(/^\[/, '').replace(/\]$/, '')
  if (!inner) return []
  return inner.split(',').map((part) => parseYamlScalar(part.trim()))
}

function parseFrontmatter(text) {
  const out = { format: null, version: null, entries: null, session: {} }
  for (const line of text.split('\n')) {
    const top = line.match(/^([A-Za-z]+):\s*(.*)$/)
    if (top) {
      const [, key, raw] = top
      if (key === 'format') out.format = parseYamlScalar(raw)
      else if (key === 'version') out.version = parseYamlScalar(raw)
      else if (key === 'entries') out.entries = Number(parseYamlScalar(raw))
      continue
    }
    const kv = line.match(/^  ([A-Za-z]+):\s*(.*)$/)
    if (kv) {
      const [, key, raw] = kv
      out.session[key] = key === 'gitRange' ? parseGitRange(raw) : parseYamlScalar(raw)
    }
  }
  return out
}

/**
 * 解析会话导出 Markdown，返回 { frontmatter, entries }。
 * entries[i] = { type, time: 'HH:mm', content, commits: string[], tags: string[] }。
 * 格式非法时抛错（标识缺失、类型非法）。
 */
export function parseSessionMarkdown(md) {
  if (typeof md !== 'string' || md.length === 0) throw new Error('导出内容为空')
  const fmMatch = md.match(/^---\n([\s\S]*?)\n---\n\n/)
  if (!fmMatch) throw new Error('缺少 YAML frontmatter（06 §4 解析规则 1）')
  const frontmatter = parseFrontmatter(fmMatch[1])
  if (frontmatter.format !== 'trailmind-session') throw new Error(`非 trailmind-session 格式：${frontmatter.format}`)

  const body = md.slice(fmMatch[0].length)
  const headingRe = /^## \[([a-z]+)\] (\d{2}:\d{2}) · .+\n/gm
  const starts = []
  let m
  while ((m = headingRe.exec(body))) {
    starts.push({ index: m.index, type: m[1], time: m[2] })
  }

  const entries = []
  for (let i = 0; i < starts.length; i++) {
    const start = starts[i]
    if (!ENTRY_TYPES.includes(start.type)) throw new Error(`未知条目类型：${start.type}（06 §2 枚举）`)
    const contentStart = body.indexOf('\n', start.index) + 1
    const contentEnd = i + 1 < starts.length ? starts[i + 1].index : body.length
    const chunk = body.slice(contentStart, contentEnd)

    // 条目级元数据行位于正文末尾（06 §4 解析规则 3）：`> git: \`hash\`` / `> 标签：\`a\` \`b\``
    // 先去掉 chunk 尾部空行（条目分隔产生的空行），再收集末尾连续的 `> ` 元数据行
    const lines = chunk.split('\n')
    while (lines.length && lines[lines.length - 1].trim() === '') lines.pop()
    const meta = []
    while (lines.length && lines[lines.length - 1].startsWith('> ')) {
      meta.unshift(lines.pop())
    }
    const content = lines.join('\n')

    const commits = []
    const tags = []
    for (const line of meta) {
      const git = line.match(/^> git: `([0-9a-f]{40})`$/)
      if (git) {
        commits.push(git[1])
        continue
      }
      const tagLine = line.match(/^> 标签：(.*)$/)
      if (tagLine) {
        for (const t of tagLine[1].matchAll(/`([^`]+)`/g)) tags.push(t[1])
      }
    }
    entries.push({ type: start.type, time: start.time, content, commits, tags })
  }
  return { frontmatter, entries }
}
