import { get } from './client'
import type { SearchResultType, SearchResults } from './types'

/** 全局搜索（M4 任务一，04 §5 GET /search?q=&type=&workspaceId=）；type=all 时不传 type 参数。 */
export function searchGlobal(
  q: string,
  opts: { type?: SearchResultType | 'all'; workspaceId?: number } = {},
): Promise<SearchResults> {
  const params = new URLSearchParams({ q })
  if (opts.type && opts.type !== 'all') params.set('type', opts.type)
  if (opts.workspaceId != null) params.set('workspaceId', String(opts.workspaceId))
  return get(`/search?${params.toString()}`)
}
