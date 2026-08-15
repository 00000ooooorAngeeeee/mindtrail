import { del, post, put } from './client'
import type { Entry, EntryType } from './types'

/** 追加条目（04 §5）：seq 由后端事务内分配；标签按需即时创建。 */
export function addEntry(
  sessionId: number,
  input: { type: EntryType; contentMd: string; tags?: string[] },
): Promise<Entry> {
  return post<Entry>(`/sessions/${sessionId}/entries`, input)
}

/** 编辑条目（MVP 仅 contentMd/type/tags，04 §5）。 */
export function updateEntry(
  id: number,
  input: { contentMd?: string; type?: EntryType; tags?: string[] },
): Promise<Entry> {
  return put<Entry>(`/entries/${id}`, input)
}

export function deleteEntry(id: number): Promise<void> {
  return del<void>(`/entries/${id}`)
}
