// 搜索结果关键词高亮纯函数（M4 任务一，PRD D1「关键词高亮」；后端只返回片段，高亮由前端做，04 §6.3）。
// 设计：按空白分词；长词优先匹配避免短词吃掉长词前缀（如「布局」与「布局算法」同时出现时先命中长词）；
// 大小写不敏感（与 MySQL utf8mb4_0900_ai_ci 一致）。

export interface HighlightSegment {
  text: string
  hit: boolean
}

/** 查询分词：空白分割 + 去空（与后端 SearchQueryUtil 的白话口径一致）。 */
export function tokenizeQuery(q: string): string[] {
  return q.trim().split(/\s+/).filter((t) => t.length > 0)
}

/** 把文本按 token 命中切分为段落序列；hit=true 的段落渲染为 <mark>。 */
export function splitHighlight(text: string, tokens: string[]): HighlightSegment[] {
  if (!text) return []
  const terms = [...new Set(tokens.map((t) => t.trim()).filter((t) => t.length > 0))]
    .map((t) => ({ term: t, lower: t.toLowerCase() }))
    .sort((a, b) => b.term.length - a.term.length) // 长词优先，重叠时先切长词
  if (terms.length === 0) return [{ text, hit: false }]

  const lower = text.toLowerCase()
  const segments: HighlightSegment[] = []
  let i = 0
  let plainStart = 0
  const pushPlain = (end: number) => {
    if (end > plainStart) segments.push({ text: text.slice(plainStart, end), hit: false })
  }
  while (i < text.length) {
    const hit = terms.find((t) => lower.startsWith(t.lower, i))
    if (!hit) {
      i++
      continue
    }
    pushPlain(i)
    segments.push({ text: text.slice(i, i + hit.term.length), hit: true })
    i += hit.term.length
    plainStart = i
  }
  pushPlain(text.length)
  return segments
}
