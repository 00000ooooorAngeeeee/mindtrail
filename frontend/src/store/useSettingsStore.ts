import { create } from 'zustand'
import { fetchSettings, updateSettings } from '../api/settings'
import type { AppSettings, ThemeMode } from '../api/types'
import { applyTheme, resolveTheme, prefersDark } from '../features/settings/theme'

/**
 * 设置状态（04 §6.6「设置存 MySQL setting 表 + 前端缓存」）：
 * 启动 load 回填并应用主题；切换主题乐观应用（立即生效）+ 落库，失败回滚并报错；
 * 默认仓库路径保存走接口（后端校验 .git 目录）。
 */
interface SettingsState {
  settings: AppSettings | null
  loading: boolean
  saving: boolean
  error: string | null
  load: () => Promise<void>
  setTheme: (theme: ThemeMode) => Promise<void>
  setDefaultRepoPath: (path: string) => Promise<void>
  /** 保存自定义快捷键 JSON（空白=重置默认，v1.2 P2，03 §5）。 */
  setKeymap: (keymap: string) => Promise<void>
  /** system 模式下系统偏好变化时重解析应用（由组件订阅 matchMedia 触发）。 */
  applyForSystemPreference: (prefersDarkValue: boolean) => void
}

export const useSettingsStore = create<SettingsState>()((set, get) => ({
  settings: null,
  loading: false,
  saving: false,
  error: null,

  load: async () => {
    set({ loading: true, error: null })
    try {
      const settings = await fetchSettings()
      set({ settings, loading: false })
      applyTheme(resolveTheme(settings.theme, prefersDark()))
    } catch {
      // 加载失败不阻断使用：按系统偏好兜底，静默（后端不可达时页面已有全局错误提示）
      applyTheme(resolveTheme('system', prefersDark()))
      set({ loading: false })
    }
  },

  setTheme: async (theme) => {
    const prev = get().settings
    set({ saving: true, error: null })
    // 乐观应用：切换立即生效（03 §6），落库失败回滚
    applyTheme(resolveTheme(theme, prefersDark()))
    try {
      const settings = await updateSettings({ theme })
      set({ settings, saving: false })
    } catch (e) {
      if (prev) {
        applyTheme(resolveTheme(prev.theme, prefersDark()))
      }
      set({ saving: false, error: e instanceof Error ? e.message : '主题保存失败' })
    }
  },

  setDefaultRepoPath: async (path) => {
    set({ saving: true, error: null })
    try {
      const settings = await updateSettings({ defaultRepoPath: path })
      set({ settings, saving: false })
    } catch (e) {
      set({ saving: false, error: e instanceof Error ? e.message : '仓库路径保存失败' })
    }
  },

  setKeymap: async (keymap) => {
    set({ saving: true, error: null })
    try {
      const settings = await updateSettings({ keymap })
      set({ settings, saving: false })
    } catch (e) {
      set({ saving: false, error: e instanceof Error ? e.message : '快捷键保存失败' })
    }
  },

  applyForSystemPreference: (prefersDarkValue) => {
    const theme = get().settings?.theme
    if (theme === 'system') {
      applyTheme(resolveTheme('system', prefersDarkValue))
    }
  },
}))
