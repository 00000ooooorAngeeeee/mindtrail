/**
 * 轻提示 toast（v1.2 P2「删除内容时采用带撤销操作的轻提示」）：
 * 模块级 toast 存储 + 订阅，不依赖 React，便于单测（注入假定时器）。
 * 由 components/Toaster.tsx 订阅渲染；utils/undoDelete.ts 用于「删除撤销」提示。
 *
 * 设计：toast 不可变快照（每次 show/dismiss 重建数组），订阅者收快照引用；
 * 自动消失用 setTimeout 映射，撤销/手动关闭即清 timer。
 */
export interface ToastItem {
  id: number
  message: string
  actionLabel?: string
  onAction?: () => void
}

export interface ShowToastOptions {
  actionLabel?: string
  onAction?: () => void
  /** 自动消失毫秒；0 = 不自动消失（需手动关闭）。默认 5000。 */
  durationMs?: number
}

type Listener = (toasts: ToastItem[]) => void

let nextId = 1
let toasts: ToastItem[] = []
const listeners = new Set<Listener>()
/** 自动消失定时器映射（id → timer），撤销/关闭时取消。 */
const timers = new Map<number, ReturnType<typeof setTimeout>>()

function emit(): void {
  const snapshot = toasts
  listeners.forEach((l) => l(snapshot))
}

/** 弹出一条 toast，返回其 id。 */
export function showToast(message: string, opts?: ShowToastOptions): number {
  const id = nextId++
  toasts = [...toasts, { id, message, actionLabel: opts?.actionLabel, onAction: opts?.onAction }]
  emit()
  const duration = opts?.durationMs ?? 5000
  if (duration > 0) {
    timers.set(id, setTimeout(() => dismissToast(id), duration))
  }
  return id
}

/** 关闭一条 toast（含取消其自动消失定时器）。不存在则 no-op。 */
export function dismissToast(id: number): void {
  if (!toasts.some((t) => t.id === id)) return
  toasts = toasts.filter((t) => t.id !== id)
  const timer = timers.get(id)
  if (timer !== undefined) {
    clearTimeout(timer)
    timers.delete(id)
  }
  emit()
}

/** 触发 toast 动作（撤销）并关闭该 toast。 */
export function runToastAction(id: number): void {
  const item = toasts.find((t) => t.id === id)
  if (!item) return
  dismissToast(id)
  item.onAction?.()
}

/** 订阅 toast 快照变化；立即投递当前快照；返回取消订阅函数。 */
export function subscribeToast(listener: Listener): () => void {
  listeners.add(listener)
  listener(toasts)
  return () => {
    listeners.delete(listener)
  }
}

/** 仅供单测：读取当前快照。 */
export function getToasts(): ToastItem[] {
  return toasts
}

/** 仅供单测：清空全部 toast 与定时器并重置 id。 */
export function __resetToastsForTest(): void {
  toasts = []
  timers.forEach((t) => clearTimeout(t))
  timers.clear()
  nextId = 1
  emit()
}
