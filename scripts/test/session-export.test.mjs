// 会话导出解析器单测（node:test）：按 docs/06 §4 解析规则逐条验证（M3 总验收「导出→解析→比对」的解析侧）。
import { test } from 'node:test'
import assert from 'node:assert'
import { parseSessionMarkdown, ENTRY_TYPES } from '../session-export.mjs'

const fixture = `---
format: trailmind-session
version: 1
session:
  title: 从 0 到 1 搭建 TrailMind 骨架
  status: completed
  workspace: TrailMind
  startedAt: "2025-06-01T09:00"
  endedAt: "2025-06-01T11:30"
  repoPath: "D:/projects/trailmind"
  gitRange: ["${'a'.repeat(40)}", "${'b'.repeat(40)}"]
entries: 3
---

# 会话：从 0 到 1 搭建 TrailMind 骨架

## [goal] 09:02 · 目标
搭建可运行的前后端骨架，表现为：双击启动、首页可见、前后端连通。

## [action] 09:10 · 操作
初始化 Spring Boot 工程，依赖：web、mybatis-plus、mysql-connector。
> git: \`${'c'.repeat(40)}\`

## [decision] 09:40 · 决策
选 React Flow 而非自研 canvas。

多行正文第二行。
> 标签：\`技术选型\` \`前端\`
`

test('parseSessionMarkdown：frontmatter 字段与标识解析正确（规则 1）', () => {
  const { frontmatter, entries } = parseSessionMarkdown(fixture)
  assert.strictEqual(frontmatter.format, 'trailmind-session')
  assert.strictEqual(frontmatter.version, '1')
  assert.strictEqual(frontmatter.entries, 3)
  assert.strictEqual(frontmatter.session.title, '从 0 到 1 搭建 TrailMind 骨架')
  assert.strictEqual(frontmatter.session.status, 'completed')
  assert.strictEqual(frontmatter.session.startedAt, '2025-06-01T09:00')
  assert.deepStrictEqual(frontmatter.session.gitRange, ['a'.repeat(40), 'b'.repeat(40)])
  assert.strictEqual(entries.length, 3)
})

test('parseSessionMarkdown：条目分隔符还原类型/时间/正文（规则 2/4/5）', () => {
  const { entries } = parseSessionMarkdown(fixture)
  assert.deepStrictEqual(
    entries.map((e) => [e.type, e.time]),
    [['goal', '09:02'], ['action', '09:10'], ['decision', '09:40']],
  )
  assert.strictEqual(entries[0].content, '搭建可运行的前后端骨架，表现为：双击启动、首页可见、前后端连通。')
  assert.strictEqual(entries[2].content, '选 React Flow 而非自研 canvas。\n\n多行正文第二行。')
})

test('parseSessionMarkdown：git 行与标签行还原（规则 3）', () => {
  const { entries } = parseSessionMarkdown(fixture)
  assert.deepStrictEqual(entries[1].commits, ['c'.repeat(40)])
  assert.deepStrictEqual(entries[0].commits, [])
  assert.deepStrictEqual(entries[2].tags, ['技术选型', '前端'])
})

test('parseSessionMarkdown：非 trailmind-session 格式抛错', () => {
  assert.throws(() => parseSessionMarkdown('---\nformat: other\n---\n\n'), /trailmind-session/)
})

test('parseSessionMarkdown：缺少 frontmatter 抛错', () => {
  assert.throws(() => parseSessionMarkdown('# 会话：没有 frontmatter'), /frontmatter/)
})

test('parseSessionMarkdown：未知条目类型抛错（06 §2 枚举不可扩展）', () => {
  const bad = fixture.replace('## [goal]', '## [todo]')
  assert.throws(() => parseSessionMarkdown(bad), /未知条目类型/)
})

test('parseSessionMarkdown：gitRange 为 null 时解析为 null 元素', () => {
  const md = fixture.replace(/gitRange: \[[^\]]*\]/, 'gitRange: [null, null]')
  const { frontmatter } = parseSessionMarkdown(md)
  assert.deepStrictEqual(frontmatter.session.gitRange, [null, null])
})

test('ENTRY_TYPES：与 docs/06 §2 十一类一致', () => {
  assert.strictEqual(ENTRY_TYPES.length, 11)
  assert.ok(ENTRY_TYPES.includes('review'))
  assert.ok(ENTRY_TYPES.includes('note'))
})
