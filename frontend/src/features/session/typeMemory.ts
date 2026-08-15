import { ENTRY_TYPES, type EntryType } from '../../api/types'

export const ENTRY_TYPE_STORAGE_KEY = 'trailmind.entryType'

/** 读回上次使用的条目类型（03 §4/06 §9「类型默认记忆」）；无记录或脏数据回退默认 action（PRD C2.2）。 */
export function loadEntryType(): EntryType {
  try {
    const value = localStorage.getItem(ENTRY_TYPE_STORAGE_KEY)
    if (value && (ENTRY_TYPES as readonly string[]).includes(value)) {
      return value as EntryType
    }
  } catch {
    // localStorage 不可用（隐私模式等）时回退默认值
  }
  return 'action'
}

export function saveEntryType(type: EntryType): void {
  try {
    localStorage.setItem(ENTRY_TYPE_STORAGE_KEY, type)
  } catch {
    // 写入失败静默忽略：记忆是体验增强，不阻塞记录本身
  }
}
