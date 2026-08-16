// 验收冒烟脚本关键逻辑单测（node:test，无第三方依赖）。
// 覆盖纯决策函数：缺失表检测、通过/失败汇总、保存内容比对、备份 zip 解析（docs/08 §6 DoD「关键逻辑补单测」）。
import { test } from 'node:test'
import assert from 'node:assert'
import zlib from 'node:zlib'
import { EXPECTED_TABLES, missingTables, summarize, checkSavedContent, unzipBackupJson } from '../verify.mjs'

test('EXPECTED_TABLES：固定 8 张表，与 schema.sql 一致', () => {
  assert.strictEqual(EXPECTED_TABLES.length, 8)
  assert.ok(EXPECTED_TABLES.includes('workspace'))
  assert.ok(EXPECTED_TABLES.includes('entry_commit'))
})

test('missingTables：全部齐全返回空数组', () => {
  assert.deepStrictEqual(missingTables(EXPECTED_TABLES), [])
})

test('missingTables：缺表时返回缺失表名', () => {
  const actual = ['workspace', 'mindmap', 'session', 'entry', 'tag', 'entry_tag', 'entry_commit'] // 少 setting
  assert.deepStrictEqual(missingTables(actual), ['setting'])
})

test('summarize：全部通过输出 ALL PASS 且 pass=true', () => {
  const { pass, message } = summarize([
    { ok: true, name: 'A' },
    { ok: true, name: 'B' },
  ])
  assert.strictEqual(pass, true)
  assert.match(message, /SMOKE: ALL PASS/)
  assert.match(message, /✓ A/)
})

test('summarize：任一失败输出 FAILED 且 pass=false，含失败项', () => {
  const { pass, message } = summarize([
    { ok: true, name: 'A' },
    { ok: false, name: 'B', error: '原因' },
  ])
  assert.strictEqual(pass, false)
  assert.match(message, /SMOKE: FAILED/)
  assert.match(message, /✗ B — 原因/)
})

const savedFixture = () =>
  JSON.stringify({
    version: 1,
    rootNodeId: 'n1',
    nodes: {
      n1: {
        id: 'n1',
        text: '根',
        style: { color: 'indigo', bold: true, shape: 'diamond' },
        parentId: null,
        layout: { x: 120, y: 80 },
        collapsed: false,
        sticky: false,
      },
      n2: {
        id: 'n2',
        text: '',
        style: { color: 'amber', bold: false, shape: 'rounded' },
        parentId: 'n1',
        layout: { x: 900, y: 60 },
        collapsed: false,
        sticky: true,
      },
    },
    edges: [{ id: 'e1', source: 'n1', target: 'n2', type: 'free', label: '自由连线' }],
  })

test('checkSavedContent：坐标/样式/便签/自由边全部一致返回 ok', () => {
  const r = checkSavedContent(savedFixture(), {
    nodeCount: 2,
    nodes: {
      n1: { layout: { x: 120, y: 80 }, style: { color: 'indigo', bold: true, shape: 'diamond' }, sticky: false },
      n2: { layout: { x: 900, y: 60 }, sticky: true },
    },
    edges: [{ id: 'e1', type: 'free', source: 'n1', target: 'n2', label: '自由连线' }],
  })
  assert.strictEqual(r.ok, true)
})

test('checkSavedContent：非法 JSON 返回失败', () => {
  const r = checkSavedContent('{{{', { nodeCount: 1, nodes: {}, edges: [] })
  assert.strictEqual(r.ok, false)
  assert.match(r.error, /不是合法 JSON/)
})

test('checkSavedContent：坐标漂移返回失败并指明节点', () => {
  const c = JSON.parse(savedFixture())
  c.nodes.n1.layout.x = 121
  const r = checkSavedContent(c, {
    nodeCount: 2,
    nodes: { n1: { layout: { x: 120, y: 80 } }, n2: { layout: { x: 900, y: 60 } } },
    edges: [{ id: 'e1', type: 'free', source: 'n1', target: 'n2' }],
  })
  assert.strictEqual(r.ok, false)
  assert.match(r.error, /n1 layout/)
})

test('checkSavedContent：节点数不符返回失败', () => {
  const r = checkSavedContent(savedFixture(), { nodeCount: 1, nodes: {}, edges: [] })
  assert.strictEqual(r.ok, false)
  assert.match(r.error, /节点数/)
})

// 最小单条目 zip 构造（deflate 方法 8），与后端 BackupExportService（ZipOutputStream）产物同构
function buildZip(entryName, content) {
  const deflated = zlib.deflateRawSync(Buffer.from(content, 'utf8'))
  const crc = crc32(Buffer.from(content, 'utf8'))
  // 本地文件头
  const lfh = Buffer.alloc(30)
  lfh.writeUInt32LE(0x04034b50, 0)
  lfh.writeUInt16LE(20, 4) // version needed
  lfh.writeUInt16LE(0x0800, 6) // flags
  lfh.writeUInt16LE(8, 8) // method deflate
  lfh.writeUInt32LE(crc, 14)
  lfh.writeUInt32LE(deflated.length, 18)
  lfh.writeUInt32LE(Buffer.byteLength(content), 22)
  lfh.writeUInt16LE(Buffer.byteLength(entryName), 26)
  const lfhBody = Buffer.concat([lfh, Buffer.from(entryName), deflated])
  // 中央目录
  const cd = Buffer.alloc(46)
  cd.writeUInt32LE(0x02014b50, 0)
  cd.writeUInt16LE(20, 4)
  cd.writeUInt16LE(20, 6)
  cd.writeUInt16LE(0x0800, 8)
  cd.writeUInt16LE(8, 10)
  cd.writeUInt32LE(crc, 16)
  cd.writeUInt32LE(deflated.length, 20)
  cd.writeUInt32LE(Buffer.byteLength(content), 24)
  cd.writeUInt16LE(Buffer.byteLength(entryName), 28)
  cd.writeUInt32LE(0, 42) // local header offset
  const cdBody = Buffer.concat([cd, Buffer.from(entryName)])
  // EOCD
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)
  eocd.writeUInt16LE(1, 8) // entry count
  eocd.writeUInt16LE(1, 10)
  eocd.writeUInt32LE(cdBody.length, 12)
  eocd.writeUInt32LE(lfhBody.length, 16)
  return Buffer.concat([lfhBody, cdBody, eocd])
}

// CRC-32（IEEE），Node 无内建 → 查表实现（仅测试用）
function crc32(buf) {
  let table = crc32.table
  if (!table) {
    table = crc32.table = new Int32Array(256)
    for (let n = 0; n < 256; n++) {
      let c = n
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
      table[n] = c
    }
  }
  let crc = -1
  for (const b of buf) crc = (crc >>> 8) ^ table[(crc ^ b) & 0xff]
  return (crc ^ -1) >>> 0
}

test('unzipBackupJson：解析备份 zip 还原 format/version/tables', () => {
  const json = JSON.stringify({
    format: 'trailmind-backup',
    version: 1,
    exportedAt: '2025-08-16T12:00:00',
    tables: { workspace: [{ id: 1, name: '项目A' }], entry_tag: [], entry_commit: [] },
  })
  const zip = buildZip('trailmind-backup.json', json)
  const doc = unzipBackupJson(zip)
  assert.strictEqual(doc.format, 'trailmind-backup')
  assert.strictEqual(doc.version, 1)
  assert.strictEqual(doc.tables.workspace[0].name, '项目A')
})

test('unzipBackupJson：非法 zip 抛出明确错误', () => {
  assert.throws(() => unzipBackupJson(Buffer.from('not a zip')), /EOCD|签名/)
})

test('unzipBackupJson：缺少目标条目抛出明确错误', () => {
  const zip = buildZip('other.json', '{}')
  assert.throws(() => unzipBackupJson(zip), /未找到 trailmind-backup\.json/)
})
