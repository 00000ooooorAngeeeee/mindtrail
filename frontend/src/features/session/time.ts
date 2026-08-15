/** ISO 时间 → 本地 HH:mm（时间线条目时间戳，06 §4 精度到分）；空值/非法输入返回空串。 */
export function formatTime(iso?: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  return `${hh}:${mm}`
}
