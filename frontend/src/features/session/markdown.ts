import MarkdownIt from 'markdown-it'

// 条目卡片 GFM 渲染（06 §9：代码块/列表/引用/粗斜体；markdown-it default 预设另含表格/删除线）。
// html:false 禁止原始 HTML 透传 → 渲染结果可直接注入（防 XSS）；breaks:true 对齐 GFM 软换行语义。
const md = new MarkdownIt({ html: false, breaks: true })

/** Markdown → 安全 HTML 字符串（供 dangerouslySetInnerHTML 使用）。 */
export function renderMarkdown(contentMd: string): string {
  return md.render(contentMd ?? '')
}
