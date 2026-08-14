import { get } from './client'
import type { Health } from './types'

export function fetchHealth(): Promise<Health> {
  return get<Health>('/health')
}
