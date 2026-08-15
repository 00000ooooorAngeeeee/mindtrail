// 导图导出产物校验/解析（M4 任务三，PRD B5「OPML 可被其他工具导入、PNG 完整」的验收冒烟侧）：
// 仅依赖 Node 内建（Buffer/正则），与 session-export.mjs 同为「协议解析器 + verify.mjs 实机断言」。
// parseOpmlOutlines 解析本产品生成的 OPML 2.0 子集（outline 嵌套 + text/_note/category 属性），
// 返回树结构供 verify 比对层级；pngInfoFromBase64 校验 PNG 魔数与 IHDR 尺寸（完整图片至少尺寸 > 0）。

/** XML 属性实体还原（本产品只转义这 5 类，docs/06 §4 同类子集解析器约定）。 */
function decodeXmlEntities(value) {
  return value
    .replace(/&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&gt;/g, '>')
    .replace(/&lt;/g, '<')
    .replace(/&amp;/g, '&')
}

function parseAttrs(raw) {
  const out = {}
  const re = /([A-Za-z_:][A-Za-z0-9_:.-]*)\s*=\s*"([^"]*)"/g
  let m
  while ((m = re.exec(raw))) {
    out[m[1]] = decodeXmlEntities(m[2])
  }
  return out
}

/**
 * 解析 OPML XML 字符串，返回 outline 树（根节点数组）。
 * 节点结构：{ text, note, category, children }；note/category 缺失为 null。
 * 格式非法（非 XML 声明 / 非 opml 2.0 / outline 未闭合或多余闭合）抛错。
 */
export function parseOpmlOutlines(xml) {
  if (typeof xml !== 'string' || !xml.trimStart().startsWith('<?xml version="1.0" encoding="UTF-8"?>')) {
    throw new Error('OPML 缺少 XML 声明')
  }
  if (!/<opml\s+version="2\.0">/.test(xml)) {
    throw new Error('OPML 根元素应为 version=2.0')
  }

  const roots = []
  const stack = []
  const tokenRe = /<outline\b([^>]*?)(\/?)>|<\/outline>/g
  let m
  while ((m = tokenRe.exec(xml))) {
    if (m[0] === '</outline>') {
      const done = stack.pop()
      if (!done) throw new Error('outline 闭合标签多余')
      const parent = stack[stack.length - 1]
      if (parent) parent.children.push(done)
      else roots.push(done)
      continue
    }

    const attrs = parseAttrs(m[1])
    const node = {
      text: attrs.text ?? '',
      note: attrs._note ?? null,
      category: attrs.category ?? null,
      children: [],
    }
    if (m[2] === '/') {
      const parent = stack[stack.length - 1]
      if (parent) parent.children.push(node)
      else roots.push(node)
    } else {
      stack.push(node)
    }
  }
  if (stack.length !== 0) throw new Error(`outline 未闭合：${stack.length} 个`)
  return roots
}

/**
 * 校验 Base64 PNG 并读取 IHDR 尺寸。
 * 返回 { width, height }；魔数不符 / 尺寸非法抛错（verify 的「PNG 完整」冒烟断言）。
 */
export function pngInfoFromBase64(base64) {
  if (typeof base64 !== 'string' || base64.length === 0) throw new Error('PNG Base64 内容为空')
  const bytes = Buffer.from(base64.replace(/\s/g, ''), 'base64')
  const magic = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  if (bytes.length < 24 || !bytes.subarray(0, 8).equals(magic)) {
    throw new Error('不是合法 PNG（魔数不符）')
  }
  const width = bytes.readUInt32BE(16)
  const height = bytes.readUInt32BE(20)
  if (width <= 0 || height <= 0) throw new Error(`PNG 尺寸非法：${width}×${height}`)
  return { width, height }
}
