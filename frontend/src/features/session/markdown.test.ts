import { describe, expect, it } from 'vitest'
import { renderMarkdown } from './markdown'

describe('renderMarkdown（06 §9 GFM 渲染）', () => {
  it('粗体/斜体/行内代码', () => {
    expect(renderMarkdown('**加粗** 与 *斜体* 与 `code`')).toContain('<strong>加粗</strong>')
    expect(renderMarkdown('**加粗** 与 *斜体* 与 `code`')).toContain('<em>斜体</em>')
    expect(renderMarkdown('**加粗** 与 *斜体* 与 `code`')).toContain('<code>code</code>')
  })

  it('代码块（围栏）与列表与引用', () => {
    const html = renderMarkdown('```js\nconst a = 1\n```\n\n- 甲\n- 乙\n\n> 引用行')
    expect(html).toContain('<pre>')
    expect(html).toContain('<code class="language-js">')
    expect(html).toContain('<li>甲</li>')
    expect(html).toContain('<blockquote>')
  })

  it('原始 HTML 被转义（html:false 防 XSS）', () => {
    const html = renderMarkdown('<script>alert(1)</script> <img src=x onerror=alert(2)>')
    expect(html).not.toContain('<script>')
    expect(html).not.toContain('<img')
    expect(html).toContain('&lt;script&gt;')
  })

  it('软换行按 GFM 渲染为 <br>（与旧 pre 展示语义一致）', () => {
    expect(renderMarkdown('第一行\n第二行')).toContain('<br>')
  })

  it('空内容安全返回', () => {
    expect(renderMarkdown('')).toBe('')
    expect(renderMarkdown('   ')).not.toContain('<')
  })
})
