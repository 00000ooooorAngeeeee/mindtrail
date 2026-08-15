// 浏览器下载纯函数（M4 任务三导出）：文本/Base64 → Blob → 临时 URL → <a download>。
// 文件名规则与后端 MindmapExportService.sanitizeFileName 保持一致，会话/导图共用。

/** Windows 文件名安全化：替换非法字符与控制字符，去首尾空白与末尾点；空值回退 fallback。 */
export function sanitizeFileName(name: string | null | undefined, fallback = '未命名'): string {
  const cleaned = (name ?? '')
    .trim()
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_')
    .replace(/\.+$/, '')
  return cleaned === '' ? fallback : cleaned
}

/** Base64 → 字节数组（用于后端返回的 PNG 内容）。非法输入抛错，由调用方转提示。 */
export function base64ToBytes(base64: string): Uint8Array {
  if (!base64) return new Uint8Array(0)
  let source = base64.replace(/\s/g, '')
  const pad = source.length % 4
  if (pad !== 0) source += '='.repeat(4 - pad)
  const binary = atob(source)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

/** 触发浏览器下载（jsdom 测试中可对 URL.createObjectURL/HTMLAnchorElement.click 打桩）。 */
export function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

/** 下载文本文件（会话 Markdown/JSON、导图 OPML）。 */
export function downloadTextFile(filename: string, content: string, contentType: string): void {
  triggerDownload(new Blob([content], { type: contentType }), filename)
}

/** 下载 Base64 内容（导图 PNG）。 */
export function downloadBase64File(filename: string, base64: string, contentType: string): void {
  triggerDownload(new Blob([base64ToBytes(base64)], { type: contentType }), filename)
}
