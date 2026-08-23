/**
 * 快捷键映射纯函数（v1.2 P2「自定义快捷键」，03 §5 全集，04 §6.6 setting 表 keymap JSON 持久化）。
 *
 * Combo 形态：{ ctrl, shift, alt, key }，ctrl 兼容 metaKey（跨平台 Cmd）；key 对单字符归一为小写
 * （Shift+N → key 'n' + shift true），多字符键名（Delete/Enter）原样保留。仅 §5 中已落地的 10 项可定制；
 * Enter（提交，textarea 上下文行为）与 Ctrl+W（关闭视图，尚未接线）不纳入可定制集。
 *
 * 持久化只存与默认不同的条目（diff），未改项随代码默认值变化而自动跟进。
 */
import type { AppSettings } from '../api/types'

export interface KeyCombo {
  ctrl: boolean
  shift: boolean
  alt: boolean
  /** 单字符归一小写；多字符键名原样（Delete/Enter/','）。 */
  key: string
}

export type ActionId =
  | 'newNode'
  | 'globalSearch'
  | 'modeTree'
  | 'modeCanvas'
  | 'focusQuickRecord'
  | 'undo'
  | 'redo'
  | 'save'
  | 'openSettings'
  | 'deleteSelected'

/** 可定制快捷键清单（03 §5 已落地项，供设置页渲染）。 */
export const KEYMAP_ACTIONS: { id: ActionId; label: string; scope: string }[] = [
  { id: 'newNode', label: '新建节点', scope: '导图画布' },
  { id: 'globalSearch', label: '全局搜索', scope: '全局' },
  { id: 'modeTree', label: '树状模式', scope: '导图画布' },
  { id: 'modeCanvas', label: '画布模式', scope: '导图画布' },
  { id: 'focusQuickRecord', label: '聚焦快速记录', scope: '会话页' },
  { id: 'undo', label: '撤销', scope: '导图画布' },
  { id: 'redo', label: '重做', scope: '导图画布' },
  { id: 'save', label: '手动保存', scope: '导图画布' },
  { id: 'openSettings', label: '打开设置', scope: '全局' },
  { id: 'deleteSelected', label: '删除选中', scope: '导图画布' },
]

/** 默认键位（03 §5）。 */
export const DEFAULT_KEYMAP: Record<ActionId, KeyCombo> = {
  newNode: { ctrl: true, shift: false, alt: false, key: 'n' },
  globalSearch: { ctrl: true, shift: false, alt: false, key: 'k' },
  modeTree: { ctrl: true, shift: false, alt: false, key: '1' },
  modeCanvas: { ctrl: true, shift: false, alt: false, key: '2' },
  focusQuickRecord: { ctrl: true, shift: false, alt: false, key: 'e' },
  undo: { ctrl: true, shift: false, alt: false, key: 'z' },
  redo: { ctrl: true, shift: true, alt: false, key: 'z' },
  save: { ctrl: true, shift: false, alt: false, key: 's' },
  openSettings: { ctrl: true, shift: false, alt: false, key: ',' },
  deleteSelected: { ctrl: false, shift: false, alt: false, key: 'Delete' },
}

/** 归一键盘事件的 key：单字符小写，多字符原样。 */
export function normalizeKey(key: string): string {
  return key.length === 1 ? key.toLowerCase() : key
}

/** 从 KeyboardEvent 提取 Combo（ctrl 兼容 metaKey）。纯修饰键（Shift/Control/Alt/Meta）返回 null。 */
export function comboFromEvent(e: { ctrlKey: boolean; metaKey: boolean; shiftKey: boolean; altKey: boolean; key: string }): KeyCombo | null {
  const k = e.key
  if (k === 'Shift' || k === 'Control' || k === 'Alt' || k === 'Meta') return null
  return { ctrl: e.ctrlKey || e.metaKey, shift: e.shiftKey, alt: e.altKey, key: normalizeKey(k) }
}

/** Combo 是否匹配键盘事件（handler keydown 判定用）。 */
export function matchesCombo(combo: KeyCombo, e: KeyboardEvent): boolean {
  const ctrl = e.ctrlKey || e.metaKey
  return ctrl === combo.ctrl && e.shiftKey === combo.shift && e.altKey === combo.alt && normalizeKey(e.key) === combo.key
}

/** 两 Combo 是否相同。 */
export function sameCombo(a: KeyCombo, b: KeyCombo): boolean {
  return a.ctrl === b.ctrl && a.shift === b.shift && a.alt === b.alt && a.key === b.key
}

/** 格式化 Combo 为展示串：Ctrl+Shift+Z / Delete / Ctrl+,。 */
export function formatCombo(c: KeyCombo): string {
  const parts: string[] = []
  if (c.ctrl) parts.push('Ctrl')
  if (c.shift) parts.push('Shift')
  if (c.alt) parts.push('Alt')
  const display = c.key.length === 1 && /[a-z]/.test(c.key) ? c.key.toUpperCase() : c.key
  parts.push(display)
  return parts.join('+')
}

/** 解析 setting.keymap JSON（仅存 diff），合并到默认值上；非法回落默认。 */
export function parseKeymap(json: string | null | undefined): Record<ActionId, KeyCombo> {
  const merged: Record<ActionId, KeyCombo> = { ...DEFAULT_KEYMAP }
  if (!json) return merged
  try {
    const obj = JSON.parse(json) as Partial<Record<ActionId, KeyCombo>>
    for (const id of Object.keys(obj) as ActionId[]) {
      const c = obj[id]
      if (c && typeof c.ctrl === 'boolean' && typeof c.shift === 'boolean' && typeof c.alt === 'boolean' && typeof c.key === 'string') {
        merged[id] = { ctrl: c.ctrl, shift: c.shift, alt: c.alt, key: c.key }
      }
    }
  } catch {
    // 非法 JSON：回落默认（防御性）
  }
  return merged
}

/** 序列化为 diff JSON（仅与默认不同的条目）。 */
export function serializeKeymap(map: Record<ActionId, KeyCombo>): string {
  const diff: Partial<Record<ActionId, KeyCombo>> = {}
  for (const id of Object.keys(map) as ActionId[]) {
    if (!sameCombo(map[id], DEFAULT_KEYMAP[id])) {
      diff[id] = map[id]
    }
  }
  return JSON.stringify(diff)
}

/**
 * 查冲突：map 中除 excludeActionId 外是否有与 newCombo 相同的键位。
 * 返回冲突的 actionId 或 null（设置页捕获新键位时阻止重复绑定）。
 */
export function findConflict(map: Record<ActionId, KeyCombo>, newCombo: KeyCombo, excludeActionId: ActionId): ActionId | null {
  for (const id of Object.keys(map) as ActionId[]) {
    if (id === excludeActionId) continue
    if (sameCombo(map[id], newCombo)) return id
  }
  return null
}

/** 从 AppSettings 派生完整 keymap（合并默认）。 */
export function keymapFromSettings(settings: AppSettings | null | undefined): Record<ActionId, KeyCombo> {
  return parseKeymap(settings?.keymap)
}
