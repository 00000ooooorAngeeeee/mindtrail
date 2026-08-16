import { post } from './client'

/** 全量备份导出产物（04 §5 POST /backup/export，M4 任务六）：zip 文件名 + Base64 内容。 */
export interface BackupExportFile {
  filename: string
  contentType: string
  /** zip 内容（Base64）。 */
  content: string
}

/** 导出全部数据为 JSON 压缩包（PRD E5，P1）；返回 zip（内含 trailmind-backup.json）。 */
export function exportBackup(): Promise<BackupExportFile> {
  return post<BackupExportFile>('/backup/export')
}
