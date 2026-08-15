// 导图导出校验器单测（node:test）：OPML 树解析 + PNG Base64 校验（M4 任务三验收侧）。
import { test } from 'node:test'
import assert from 'node:assert'
import { parseOpmlOutlines, pngInfoFromBase64 } from '../mindmap-export.mjs'

const fixture = `<?xml version="1.0" encoding="UTF-8"?>
<opml version="2.0">
  <head>
    <title>验收导图</title>
  </head>
  <body>
    <outline text="根 &amp; 主题" _note="根备注" category="标签甲,标签乙">
      <outline text="子节点" _note="子备注">
        <outline text="孙节点"/>
      </outline>
    </outline>
    <outline text="孤根"/>
  </body>
</opml>
`

test('parseOpmlOutlines：还原文本/备注/标签与嵌套层级', () => {
  const roots = parseOpmlOutlines(fixture)
  assert.strictEqual(roots.length, 2)
  const [root, orphan] = roots
  assert.strictEqual(root.text, '根 & 主题')
  assert.strictEqual(root.note, '根备注')
  assert.strictEqual(root.category, '标签甲,标签乙')
  assert.strictEqual(root.children.length, 1)
  assert.strictEqual(root.children[0].text, '子节点')
  assert.strictEqual(root.children[0].note, '子备注')
  assert.strictEqual(root.children[0].children[0].text, '孙节点')
  assert.strictEqual(orphan.text, '孤根')
})

test('parseOpmlOutlines：非 XML 声明或非 opml 2.0 抛错', () => {
  assert.throws(() => parseOpmlOutlines('<opml version="2.0"><body/></opml>'), /XML 声明/)
  assert.throws(() => parseOpmlOutlines('<?xml version="1.0" encoding="UTF-8"?>\n<opml version="1.0"/>'), /version=2\.0/)
})

test('parseOpmlOutlines：标签未闭合/闭合多余抛错', () => {
  assert.throws(() => parseOpmlOutlines('<?xml version="1.0" encoding="UTF-8"?>\n<opml version="2.0"><body><outline text="x">'), /未闭合/)
  assert.throws(
    () => parseOpmlOutlines('<?xml version="1.0" encoding="UTF-8"?>\n<opml version="2.0"><body></outline></body></opml>'),
    /闭合标签多余/,
  )
})

// 最小合法 PNG：魔数 + IHDR（宽高各 4 字节大端 + 其余字段 5 字节）+ IEND 补齐
const pngBytes = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from([0x00, 0x00, 0x00, 0x0d]),
  Buffer.from('IHDR', 'ascii'),
  Buffer.from([0x00, 0x00, 0x02, 0x00, 0x00, 0x00, 0x01, 0xe0, 0x08, 0x06, 0x00, 0x00, 0x00]),
])

test('pngInfoFromBase64：校验魔数并读取 IHDR 尺寸', () => {
  const { width, height } = pngInfoFromBase64(pngBytes.toString('base64'))
  assert.strictEqual(width, 512)
  assert.strictEqual(height, 480)
})

test('pngInfoFromBase64：魔数不符/空内容抛错', () => {
  assert.throws(() => pngInfoFromBase64('aGVsbG8='), /魔数/)
  assert.throws(() => pngInfoFromBase64(''), /为空/)
})
