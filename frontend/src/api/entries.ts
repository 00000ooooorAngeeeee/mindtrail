import { del, post, put } from './client'
import type { Entry, EntryType } from './types'

/** 追加/插入条目入参（04 §5 + v1.1 P1）：afterSeq 插入到该 seq 之后（0=最前），createdAt 补记时间。 */
export interface AddEntryInput {
  type: EntryType
  contentMd: string
  tags?: string[]
  /** PRD C2.5 插入位置：插入到该 seq 之后（0=最前），缺省追加末尾（seq 重排在后端事务内完成）。 */
  afterSeq?: number
  /** PRD C2.4 补记时间：ISO-8601 精确到秒，缺省当前时间。 */
  createdAt?: string
}

/** 追加条目（04 §5）：seq 由后端事务内分配；标签按需即时创建。 */
export function addEntry(sessionId: number, input: AddEntryInput): Promise<Entry> {
  return post<Entry>(`/sessions/${sessionId}/entries`, input)
}

/** 编辑条目（contentMd/type/tags；createdAt 为 PRD C2.4 补记时间，缺省不改）。 */
export function updateEntry(
  id: number,
  input: { contentMd?: string; type?: EntryType; tags?: string[]; createdAt?: string },
): Promise<Entry> {
  return put<Entry>(`/entries/${id}`, input)
}

export function deleteEntry(id: number): Promise<void> {
  return del<void>(`/entries/${id}`)
}
