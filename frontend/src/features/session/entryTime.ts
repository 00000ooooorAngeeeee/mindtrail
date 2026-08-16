/**
 * 条目补记时间工具（PRD C2.4，v1.1 P1）：
 * datetime-local 输入框（"yyyy-MM-ddTHH:mm[:ss]"）↔ 后端 ISO-8601 秒级字符串互转。
 * 后端存 LocalDateTime（Asia/Shanghai 本地时间，无时区后缀），
 * 前端 `new Date('2025-06-01T09:02:00')` 按本地时间解析——两端同机同区，往返无损。
 */

const pad = (n: number): string => String(n).padStart(2, '0')

/**
 * ISO-8601 时间（后端 LocalDateTime 字符串）→ datetime-local 输入框值。
 * 空值/非法输入返回空串（输入框留空 = 不改时间 / 交给后端默认）。
 */
export function isoToDatetimeLocal(iso?: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

/**
 * datetime-local 输入值 → ISO-8601 秒级字符串（"yyyy-MM-ddTHH:mm:ss"）。
 * 部分浏览器/用户输入缺秒（"…THH:mm"）→ 补 ":00"；非法输入返回空串。
 */
export function datetimeLocalToIso(value: string): string {
  const v = value.trim()
  if (!v) return ''
  const normalized = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(v) ? `${v}:00` : v
  const d = new Date(normalized)
  if (Number.isNaN(d.getTime())) return ''
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

/** 当前本地时间 → ISO-8601 秒级字符串（插入面板默认时间）。 */
export function nowLocalIso(): string {
  return isoToDatetimeLocal(new Date().toISOString())
}
