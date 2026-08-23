import { post } from './client'

/** 全量备份导出产物（04 §5 POST /backup/export，M4 任务六）：zip 文件名 + Base64 内容。 */
export interface BackupExportFile {
  filename: string
  contentType: string
  /** zip 内容（Base64）。 */
  content: string
}

/** 导入恢复摘要（04 §5 POST /backup/import，v1.2 P2）：各表回填行数 + 总计 + 备份导出时间。 */
export interface RestoreSummary {
  workspace: number
  mindmap: number
  session: number
  entry: number
  tag: number
  entryTag: number
  entryCommit: number
  nodeEntry: number
  setting: number
  total: number
  /** 备份导出时间（恢复自备份头部，用于展示「恢复到某时刻」）。 */
  exportedAt: string
}

/** 导出全部数据为 JSON 压缩包（PRD E5，P1）；返回 zip（内含 trailmind-backup.json）。 */
export function exportBackup(): Promise<BackupExportFile> {
  return post<BackupExportFile>('/backup/export')
}

/**
 * 全量导入恢复（PRD E5「导入恢复」P2，04 §5 POST /backup/import）：
 * content 为 exportBackup 返回的同款 Base64 zip；后端单事务清空 9 表 + 按原 id 回填（全量替换语义）。
 */
export function importBackup(content: string): Promise<RestoreSummary> {
  return post<RestoreSummary>('/backup/import', { content })
}
