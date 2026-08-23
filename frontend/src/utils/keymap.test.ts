import { describe, expect, it } from 'vitest'
import {
  DEFAULT_KEYMAP,
  comboFromEvent,
  findConflict,
  formatCombo,
  matchesCombo,
  normalizeKey,
  parseKeymap,
  sameCombo,
  serializeKeymap,
  type ActionId,
  type KeyCombo,
} from './keymap'

function ev(key: string, opts: { ctrl?: boolean; shift?: boolean; alt?: boolean; meta?: boolean } = {}): KeyboardEvent {
  return { key, ctrlKey: !!opts.ctrl, metaKey: !!opts.meta, shiftKey: !!opts.shift, altKey: !!opts.alt } as KeyboardEvent
}

describe('keymap 纯函数（v1.2 P2 自定义快捷键）', () => {
  it('normalizeKey 单字符小写、多字符原样', () => {
    expect(normalizeKey('N')).toBe('n')
    expect(normalizeKey('z')).toBe('z')
    expect(normalizeKey('Delete')).toBe('Delete')
    expect(normalizeKey(',')).toBe(',')
  })

  it('comboFromEvent 归一 Combo 且纯修饰键返回 null', () => {
    expect(comboFromEvent(ev('n', { ctrl: true }))).toEqual({ ctrl: true, shift: false, alt: false, key: 'n' })
    // Shift+N → key 小写 + shift true
    expect(comboFromEvent(ev('N', { shift: true }))).toEqual({ ctrl: false, shift: true, alt: false, key: 'n' })
    expect(comboFromEvent(ev('Delete'))).toEqual({ ctrl: false, shift: false, alt: false, key: 'Delete' })
    // metaKey 视为 ctrl（跨平台 Cmd）
    expect(comboFromEvent(ev('k', { meta: true }))?.ctrl).toBe(true)
    expect(comboFromEvent(ev('Shift'))).toBeNull()
    expect(comboFromEvent(ev('Control'))).toBeNull()
  })

  it('matchesCombo 默认 keymap 命中 03 §5 默认键位', () => {
    expect(matchesCombo(DEFAULT_KEYMAP.save, ev('s', { ctrl: true }))).toBe(true)
    expect(matchesCombo(DEFAULT_KEYMAP.redo, ev('Z', { ctrl: true, shift: true }))).toBe(true)
    expect(matchesCombo(DEFAULT_KEYMAP.openSettings, ev(',', { ctrl: true }))).toBe(true)
    expect(matchesCombo(DEFAULT_KEYMAP.deleteSelected, ev('Delete'))).toBe(true)
    // 不该命中的：Save 不匹配无 Ctrl 的 s
    expect(matchesCombo(DEFAULT_KEYMAP.save, ev('s'))).toBe(false)
    // redo 默认 Ctrl+Shift+Z，不匹配纯 Ctrl+Z（那是 undo）
    expect(matchesCombo(DEFAULT_KEYMAP.redo, ev('z', { ctrl: true }))).toBe(false)
  })

  it('formatCombo 展示串', () => {
    expect(formatCombo({ ctrl: true, shift: true, alt: false, key: 'z' })).toBe('Ctrl+Shift+Z')
    expect(formatCombo({ ctrl: false, shift: false, alt: false, key: 'Delete' })).toBe('Delete')
    expect(formatCombo({ ctrl: true, shift: false, alt: false, key: ',' })).toBe('Ctrl+,')
    expect(formatCombo({ ctrl: true, shift: false, alt: true, key: '1' })).toBe('Ctrl+Alt+1')
  })

  it('parseKeymap 合并 diff 到默认、非法回落默认', () => {
    const map = parseKeymap(JSON.stringify({ save: { ctrl: true, shift: false, alt: false, key: 'd' } }))
    expect(map.save.key).toBe('d') // 覆盖
    expect(map.undo).toEqual(DEFAULT_KEYMAP.undo) // 未改项保持默认
    // 非法 JSON
    expect(parseKeymap('{bad')).toEqual(DEFAULT_KEYMAP)
    expect(parseKeymap(null)).toEqual(DEFAULT_KEYMAP)
  })

  it('serializeKeymap 只存与默认不同的条目', () => {
    const map = { ...DEFAULT_KEYMAP, save: { ctrl: true, shift: false, alt: false, key: 'd' } }
    const s = serializeKeymap(map)
    const obj = JSON.parse(s) as Record<string, KeyCombo>
    expect(Object.keys(obj)).toEqual(['save'])
    expect(obj.save.key).toBe('d')
    // 全默认 → 空对象
    expect(serializeKeymap(DEFAULT_KEYMAP)).toBe('{}')
  })

  it('serialize→parse 往返保持自定义', () => {
    const map = { ...DEFAULT_KEYMAP, newNode: { ctrl: false, shift: true, alt: false, key: 'n' } as KeyCombo }
    const rt = parseKeymap(serializeKeymap(map))
    expect(rt.newNode).toEqual(map.newNode)
    expect(rt.save).toEqual(DEFAULT_KEYMAP.save)
  })

  it('findConflict 检出与他人重复、排除自身', () => {
    const map: Record<ActionId, KeyCombo> = { ...DEFAULT_KEYMAP }
    // save 默认 Ctrl+S，尝试把 newNode 也设为 Ctrl+S → 应冲突到 save
    const dup: KeyCombo = { ctrl: true, shift: false, alt: false, key: 's' }
    expect(findConflict(map, dup, 'newNode')).toBe('save')
    // 自身默认值不与自身冲突
    expect(findConflict(map, DEFAULT_KEYMAP.save, 'save')).toBeNull()
  })

  it('sameCombo 全字段比对', () => {
    const a: KeyCombo = { ctrl: true, shift: false, alt: false, key: 's' }
    expect(sameCombo(a, { ...a })).toBe(true)
    expect(sameCombo(a, { ...a, shift: true })).toBe(false)
    expect(sameCombo(a, { ...a, key: 'd' })).toBe(false)
  })
})
