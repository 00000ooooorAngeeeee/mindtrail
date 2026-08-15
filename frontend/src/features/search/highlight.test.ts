import { describe, expect, it } from 'vitest'
import { splitHighlight, tokenizeQuery } from './highlight'

describe('tokenizeQuery', () => {
  it('按空白分词并去空', () => {
    expect(tokenizeQuery('  布局  算法 ')).toEqual(['布局', '算法'])
    expect(tokenizeQuery('')).toEqual([])
    expect(tokenizeQuery('单字')).toEqual(['单字'])
  })
})

describe('splitHighlight', () => {
  it('无 token 时整体为普通段', () => {
    expect(splitHighlight('文本', [])).toEqual([{ text: '文本', hit: false }])
  })

  it('命中片段标记 hit，其余为普通段', () => {
    expect(splitHighlight('前后 布局算法 后文', ['布局算法'])).toEqual([
      { text: '前后 ', hit: false },
      { text: '布局算法', hit: true },
      { text: ' 后文', hit: false },
    ])
  })

  it('大小写不敏感', () => {
    expect(splitHighlight('React Flow 画布', ['react'])).toEqual([
      { text: 'React', hit: true },
      { text: ' Flow 画布', hit: false },
    ])
  })

  it('长词优先，避免短词吃掉长词前缀', () => {
    expect(splitHighlight('布局算法', ['布局', '布局算法'])).toEqual([{ text: '布局算法', hit: true }])
  })

  it('多 token 各自命中', () => {
    expect(splitHighlight('a布局b算法c', ['布局', '算法'])).toEqual([
      { text: 'a', hit: false },
      { text: '布局', hit: true },
      { text: 'b', hit: false },
      { text: '算法', hit: true },
      { text: 'c', hit: false },
    ])
  })

  it('未命中时整体普通段', () => {
    expect(splitHighlight('无关文本', ['布局'])).toEqual([{ text: '无关文本', hit: false }])
  })

  it('空文本返回空数组', () => {
    expect(splitHighlight('', ['x'])).toEqual([])
  })
})
