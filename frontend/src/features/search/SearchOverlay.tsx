import { useEffect, useMemo, useRef, useState } from 'react'
import { searchGlobal } from '../../api/search'
import {
  SEARCH_RESULT_LABELS,
  SEARCH_RESULT_TYPES,
  type SearchMindmapHit,
  type SearchEntryHit,
  type SearchResults,
  type SearchResultType,
  type SearchSessionHit,
} from '../../api/types'
import { ENTRY_TYPE_LABELS } from '../../api/types'
import { splitHighlight, tokenizeQuery } from './highlight'
import './search.css'

/** 跳转目标（PRD D2「点击结果定位到对应工作区/导图/会话及具体条目」），由 App 统一导航。 */
export type SearchNavigateTarget =
  | { kind: 'mindmap'; workspaceId: number; mindmapId: number; nodeId: string | null }
  | { kind: 'entry'; workspaceId: number; sessionId: number; entryId: number; seq: number }
  | { kind: 'session'; workspaceId: number; sessionId: number }

type Tab = 'all' | SearchResultType

/** 搜索防抖间隔（避免每键一次请求；后端另有 30s 结果缓存，04 §8）。 */
const DEBOUNCE_MS = 300

/**
 * 全局搜索浮层（M4 任务一，PRD D1/D2 + 03 §5 Ctrl+K / §7.3 空态）：
 * 顶部输入框（自动聚焦，Esc 关闭）→ 类型 Tab（全部/导图/条目/会话，带计数）→ 分组结果列表；
 * 片段关键词 <mark> 高亮（04 §6.3 前端高亮）；点击结果回调跳转（定位信息由后端命中行提供）。
 */
export function SearchOverlay({
  onClose,
  onNavigate,
}: {
  onClose: () => void
  onNavigate: (target: SearchNavigateTarget) => void
}) {
  const [q, setQ] = useState('')
  const [tab, setTab] = useState<Tab>('all')
  const [results, setResults] = useState<SearchResults | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  useEffect(() => {
    const trimmed = q.trim()
    if (!trimmed) {
      setResults(null)
      setError(null)
      setLoading(false)
      return
    }
    setLoading(true)
    const timer = setTimeout(() => {
      searchGlobal(trimmed, { type: tab })
        .then((r) => {
          setResults(r)
          setError(null)
        })
        .catch((e) => {
          setResults(null)
          setError(e instanceof Error ? e.message : '搜索失败')
        })
        .finally(() => setLoading(false))
    }, DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [q, tab])

  const tokens = useMemo(() => tokenizeQuery(q), [q])
  const counts = useMemo(
    () => ({
      all: results ? results.mindmaps.length + results.entries.length + results.sessions.length : 0,
      mindmap: results?.mindmaps.length ?? 0,
      entry: results?.entries.length ?? 0,
      session: results?.sessions.length ?? 0,
    }),
    [results],
  )

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      onClose()
    }
  }

  return (
    <div className="search-overlay" onMouseDown={onClose} onKeyDown={onKeyDown}>
      <div className="search-panel" role="dialog" aria-label="全局搜索" onMouseDown={(e) => e.stopPropagation()}>
        <div className="search-input-row">
          <span className="search-icon" aria-hidden="true">
            🔍
          </span>
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="搜索导图节点、条目与会话（Esc 关闭）"
            aria-label="搜索关键词"
          />
          <button className="search-close" onClick={onClose} aria-label="关闭搜索">
            ✕
          </button>
        </div>

        <div className="search-tabs" role="tablist">
          {(['all', ...SEARCH_RESULT_TYPES] as Tab[]).map((t) => (
            <button
              key={t}
              role="tab"
              aria-selected={tab === t}
              className={`search-tab${tab === t ? ' active' : ''}`}
              onClick={() => setTab(t)}
            >
              {t === 'all' ? '全部' : SEARCH_RESULT_LABELS[t]}
              <span className="search-tab-count">{counts[t]}</span>
            </button>
          ))}
        </div>

        <div className="search-body">
          {!q.trim() && <p className="search-hint">输入关键词，搜索全部工作区的导图节点文本、条目标题/正文与会话标题</p>}
          {loading && <p className="search-hint">搜索中…</p>}
          {!loading && error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          {!loading && !error && results && counts.all === 0 && (
            <p className="search-hint">未找到，试试其他关键词</p>
          )}
          {!loading && !error && results && counts.all > 0 && (
            <ul className="search-results">
              {tab === 'all' ? (
                <>
                  {counts.mindmap > 0 && (
                    <SectionHeader label="导图" count={counts.mindmap} />
                  )}
                  {tab === 'all' &&
                    results.mindmaps.map((hit) => (
                      <MindmapRow key={`m${hit.id}`} hit={hit} tokens={tokens} onNavigate={onNavigate} />
                    ))}
                  {tab === 'all' && counts.entry > 0 && <SectionHeader label="条目" count={counts.entry} />}
                  {tab === 'all' &&
                    results.entries.map((hit) => (
                      <EntryRow key={`e${hit.id}`} hit={hit} tokens={tokens} onNavigate={onNavigate} />
                    ))}
                  {tab === 'all' && counts.session > 0 && <SectionHeader label="会话" count={counts.session} />}
                  {tab === 'all' &&
                    results.sessions.map((hit) => (
                      <SessionRow key={`s${hit.id}`} hit={hit} tokens={tokens} onNavigate={onNavigate} />
                    ))}
                </>
              ) : tab === 'mindmap' ? (
                results.mindmaps.map((hit) => (
                  <MindmapRow key={`m${hit.id}`} hit={hit} tokens={tokens} onNavigate={onNavigate} />
                ))
              ) : tab === 'entry' ? (
                results.entries.map((hit) => (
                  <EntryRow key={`e${hit.id}`} hit={hit} tokens={tokens} onNavigate={onNavigate} />
                ))
              ) : (
                results.sessions.map((hit) => (
                  <SessionRow key={`s${hit.id}`} hit={hit} tokens={tokens} onNavigate={onNavigate} />
                ))
              )}
            </ul>
          )}
        </div>
      </div>
    </div>
  )
}

function SectionHeader({ label, count }: { label: string; count: number }) {
  return (
    <li className="search-section-header" aria-hidden="true">
      {label} · {count}
    </li>
  )
}

function Highlighted({ text, tokens }: { text: string; tokens: string[] }) {
  return (
    <>
      {splitHighlight(text, tokens).map((seg, i) =>
        seg.hit ? <mark key={i}>{seg.text}</mark> : <span key={i}>{seg.text}</span>,
      )}
    </>
  )
}

function MindmapRow({
  hit,
  tokens,
  onNavigate,
}: {
  hit: SearchMindmapHit
  tokens: string[]
  onNavigate: (t: SearchNavigateTarget) => void
}) {
  return (
    <li>
      <button
        className="search-hit"
        aria-label={hit.name}
        onClick={() => onNavigate({ kind: 'mindmap', workspaceId: hit.workspaceId, mindmapId: hit.id, nodeId: hit.nodeId })}
      >
        <span className="search-hit-title">
          🗺 <Highlighted text={hit.name} tokens={tokens} />
        </span>
        <span className="search-hit-snippet">
          <Highlighted text={hit.snippet} tokens={tokens} />
        </span>
        <span className="search-hit-meta">
          {hit.workspaceName} · {hit.nodeCount} 节点
        </span>
      </button>
    </li>
  )
}

function EntryRow({
  hit,
  tokens,
  onNavigate,
}: {
  hit: SearchEntryHit
  tokens: string[]
  onNavigate: (t: SearchNavigateTarget) => void
}) {
  return (
    <li>
      <button
        className="search-hit"
        aria-label={`#${hit.seq} ${ENTRY_TYPE_LABELS[hit.type]} ${hit.sessionTitle}`}
        onClick={() =>
          onNavigate({
            kind: 'entry',
            workspaceId: hit.workspaceId,
            sessionId: hit.sessionId,
            entryId: hit.id,
            seq: hit.seq,
          })
        }
      >
        <span className="search-hit-title">
          #{hit.seq} {ENTRY_TYPE_LABELS[hit.type]} · <Highlighted text={hit.sessionTitle} tokens={tokens} />
        </span>
        <span className="search-hit-snippet">
          <Highlighted text={hit.snippet} tokens={tokens} />
        </span>
        <span className="search-hit-meta">{hit.workspaceName}</span>
      </button>
    </li>
  )
}

function SessionRow({
  hit,
  tokens,
  onNavigate,
}: {
  hit: SearchSessionHit
  tokens: string[]
  onNavigate: (t: SearchNavigateTarget) => void
}) {
  return (
    <li>
      <button
        className="search-hit"
        aria-label={hit.title}
        onClick={() => onNavigate({ kind: 'session', workspaceId: hit.workspaceId, sessionId: hit.id })}
      >
        <span className="search-hit-title">
          💬 <Highlighted text={hit.title} tokens={tokens} />
        </span>
        <span className="search-hit-meta">
          {hit.workspaceName} · {hit.status === 'completed' ? '已完成' : '进行中'}
        </span>
      </button>
    </li>
  )
}
