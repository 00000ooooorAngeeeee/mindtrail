import { beforeEach, describe, expect, it } from 'vitest'
import { ENTRY_TYPE_STORAGE_KEY, loadEntryType, saveEntryType } from './typeMemory'

describe('typeMemory：快速记录类型记忆（03 §4/06 §9「记住上次用的类型」）', () => {
  beforeEach(() => localStorage.clear())

  it('未保存过时默认 action（PRD C2.2）', () => {
    expect(loadEntryType()).toBe('action')
  })

  it('保存后可读回', () => {
    saveEntryType('decision')
    expect(loadEntryType()).toBe('decision')
  })

  it('覆盖保存：后写者生效', () => {
    saveEntryType('goal')
    saveEntryType('test')
    expect(loadEntryType()).toBe('test')
  })

  it('非法存量值回退默认 action（防脏数据）', () => {
    localStorage.setItem(ENTRY_TYPE_STORAGE_KEY, 'todo')
    expect(loadEntryType()).toBe('action')
  })

  it('空存量值回退默认 action', () => {
    localStorage.setItem(ENTRY_TYPE_STORAGE_KEY, '')
    expect(loadEntryType()).toBe('action')
  })
})
