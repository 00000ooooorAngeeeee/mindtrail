import { useCallback, useMemo } from 'react'
import { useSettingsStore } from '../store/useSettingsStore'
import {
  matchesCombo,
  parseKeymap,
  serializeKeymap,
  type ActionId,
  type KeyCombo,
} from './keymap'

/**
 * 快捷键映射 hook（v1.2 P2「自定义快捷键」，03 §5 + 04 §6.6）：
 * 从 settings.keymap（diff JSON）派生完整 keymap（合并默认），提供 matches(actionId, e)
 * 供各 keydown handler 判定；setCombo/resetAll 持久化到 setting 表。
 *
 * matches 的回调身份随 keymap 变化而变，handler 的 useEffect 以其为依赖即可在改键后自动重绑监听。
 */
export function useKeymap() {
  const raw = useSettingsStore((s) => s.settings?.keymap)
  const setKeymap = useSettingsStore((s) => s.setKeymap)

  const keymap = useMemo(() => parseKeymap(raw), [raw])

  const matches = useCallback(
    (actionId: ActionId, e: KeyboardEvent) => {
      const c = keymap[actionId]
      return c ? matchesCombo(c, e) : false
    },
    [keymap],
  )

  const setCombo = useCallback(
    async (actionId: ActionId, combo: KeyCombo) => {
      const next = { ...keymap, [actionId]: combo }
      await setKeymap(serializeKeymap(next))
    },
    [keymap, setKeymap],
  )

  const resetAll = useCallback(async () => {
    // 空白字符串 → 后端 deleteByKey，前端回落默认
    await setKeymap('')
  }, [setKeymap])

  return { keymap, matches, setCombo, resetAll }
}
