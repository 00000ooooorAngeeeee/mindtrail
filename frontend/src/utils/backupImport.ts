import type { RestoreSummary } from '../api/backup'

// 备份导入恢复前端纯函数（v1.2 P2，PRD E5「导入恢复」）：
// 文件 → Base64（与后端 /backup/import 请求体 content 同形态）+ 恢复摘要可读化。

/** 一次性导入恢复的文件类型限定（zip 压缩包，与 exportBackup 产物一致）。 */
export const BACKUP_ACCEPT = '.zip,application/zip,application/x-zip-compressed'

/**
 * ArrayBuffer → Base64 字符串（无第三方依赖，分块避免 String.fromCharCode.apply 栈溢出）。
 * 用于把用户选择的 .zip 文件读为后端 /backup/import 期望的 content 字段。
 */
export function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  let binary = ''
  const CHUNK = 0x8000 // 32K 一段，兼顾栈安全与拼接次数
  for (let i = 0; i < bytes.length; i += CHUNK) {
    const slice = bytes.subarray(i, i + CHUNK)
    // String.fromCharCode.apply 接受 number[]；Array.from(Uint8Array) 即 number[]
    binary += String.fromCharCode.apply(null, Array.from(slice))
  }
  return btoa(binary)
}

/**
 * 读取 Blob/File 为 ArrayBuffer（FileReader，浏览器与 jsdom 均支持；File.arrayBuffer 在 jsdom 未实现）。
 */
export function readFileAsArrayBuffer(file: Blob): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as ArrayBuffer)
    reader.onerror = () => reject(reader.error ?? new Error('读取文件失败'))
    reader.readAsArrayBuffer(file)
  })
}

/**
 * 恢复摘要 → 可读消息（前端成功提示用）。非零表项列出，全空给出「已清空」语义。
 * 例：「已恢复 9 条记录（工作区 1 · 导图 1 · 会话 1 · 条目 1 · 标签 1 · 绑定 2 · 设置 1），恢复至 2025-08-16T12:00:00」
 */
export function formatRestoreSummary(summary: RestoreSummary): string {
  const parts: string[] = []
  if (summary.workspace) parts.push(`工作区 ${summary.workspace}`)
  if (summary.mindmap) parts.push(`导图 ${summary.mindmap}`)
  if (summary.session) parts.push(`会话 ${summary.session}`)
  if (summary.entry) parts.push(`条目 ${summary.entry}`)
  if (summary.tag) parts.push(`标签 ${summary.tag}`)
  const links = summary.entryTag + summary.entryCommit + summary.nodeEntry
  if (links) parts.push(`绑定 ${links}`)
  if (summary.setting) parts.push(`设置 ${summary.setting}`)
  const detail = parts.length ? `（${parts.join(' · ')}）` : ''
  return `已恢复 ${summary.total} 条记录${detail}，恢复至 ${summary.exportedAt}`
}
