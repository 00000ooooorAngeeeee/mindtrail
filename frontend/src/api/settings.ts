import { get, put } from './client'
import type { AppSettings, ThemeMode } from './types'

/** 应用设置接口（04 §5 GET/PUT /settings，M4 任务四）。 */
export function fetchSettings(): Promise<AppSettings> {
  return get<AppSettings>('/settings')
}

/**
 * 更新设置（PATCH 语义：null 字段不改动；defaultRepoPath 传空白字符串表示清除）。
 * 后端校验：theme ∈ light|dark|system；defaultRepoPath 须为含 .git 目录的有效路径。
 */
export function updateSettings(patch: {
  theme?: ThemeMode
  defaultRepoPath?: string | null
  /** 自定义快捷键 JSON（空白字符串=重置默认，v1.2 P2）。 */
  keymap?: string | null
}): Promise<AppSettings> {
  return put<AppSettings>('/settings', patch)
}
