import { useEffect, useState } from 'react'
import { runToastAction, subscribeToast, type ToastItem } from '../utils/toast'
import './toaster.css'

/**
 * 轻提示渲染器（v1.2 P2）：订阅 utils/toast 的 toast 存储，右下角悬浮岛式堆叠渲染。
 * 在 App 根挂载一次即可；动作按钮（如「撤销」）触发 runToastAction。
 */
export function Toaster() {
  const [items, setItems] = useState<ToastItem[]>([])
  useEffect(() => subscribeToast(setItems), [])
  if (items.length === 0) return null
  return (
    <div className="toaster" role="status" aria-live="polite">
      {items.map((t) => (
        <div key={t.id} className="toast">
          <span className="toast-message">{t.message}</span>
          {t.actionLabel && (
            <button className="toast-action" onClick={() => runToastAction(t.id)}>
              {t.actionLabel}
            </button>
          )}
        </div>
      ))}
    </div>
  )
}
