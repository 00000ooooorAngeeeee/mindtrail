package com.trailmind.backend.service;

import com.trailmind.backend.common.BadRequestException;
import com.trailmind.backend.repository.SearchMapper;
import org.springframework.stereotype.Service;

import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.List;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;

/**
 * 全局搜索业务逻辑（M4 任务一，PRD D1/D2 + 04 §6.3/§8 + 05 §5）：
 * FULLTEXT（ngram 布尔模式）优先、短词/单字 LIKE 兜底（SearchQueryUtil.analyze 判定），
 * 结果按类型分组返回（mindmap|entry|session，前端分 Tab），片段由后端生成（高亮前端做，04 §6.3）；
 * 同词同参结果缓存 30s（04 §8 性能预算「结果缓存（同词 30s）」），容量上限 500 键防膨胀。
 */
@Service
public class SearchService {

    /** 类型参数合法取值（04 §5 /search?type=，默认 all）。 */
    private static final Set<String> TYPES = Set.of("all", "mindmap", "entry", "session");
    /** 每类结果上限（04 §8「FULLTEXT + LIMIT 50」）。 */
    private static final int MAX_RESULTS_PER_TYPE = 50;
    /** 结果缓存 TTL（04 §8：同词 30s）。 */
    private static final long CACHE_TTL_MS = 30_000L;
    /** 缓存键上限：超出整体清空（防高频换词查询内存膨胀；简单策略，本应用查询规模足够）。 */
    private static final int CACHE_MAX_KEYS = 500;

    private final SearchMapper mapper;
    private final ConcurrentHashMap<String, Cached> cache = new ConcurrentHashMap<>();

    public SearchService(SearchMapper mapper) {
        this.mapper = mapper;
    }

    /** 搜索结果（按类型分组，04 §5「结果分 type: mindmap|entry|session」）。 */
    public record SearchResult(String query, List<MindmapHit> mindmaps, List<EntryHit> entries,
                               List<SessionHit> sessions) {
    }

    /** 导图命中：片段 + 首个命中节点 id（D2 跳转定位）+ 工作区上下文。 */
    public record MindmapHit(Long id, Long workspaceId, String workspaceName, String name,
                             String snippet, String nodeId, Integer nodeCount, LocalDateTime updatedAt) {
    }

    /** 条目命中：片段 + 会话/seq 定位（前端按 seq 估算所在页）+ 工作区上下文。 */
    public record EntryHit(Long id, Long sessionId, Long workspaceId, String workspaceName,
                           String sessionTitle, Integer seq, String type, String snippet,
                           LocalDateTime createdAt) {
    }

    /** 会话命中（标题 LIKE）。 */
    public record SessionHit(Long id, Long workspaceId, String workspaceName, String title,
                             String status, LocalDateTime startedAt, LocalDateTime endedAt) {
    }

    /** 缓存条目：结果 + 过期时刻。 */
    private record Cached(SearchResult result, long expiresAt) {
    }

    /**
     * 执行全局搜索。q 为空/超长抛 400；type 非法抛 400；workspaceId 非空时三类查询均按工作区过滤。
     * 同 (q, type, workspaceId) 30s 内命中缓存直接返回。
     */
    public SearchResult search(String q, String type, Long workspaceId) {
        String t = validateType(type);
        String key = q + '\n' + t + '\n' + workspaceId;

        long now = System.currentTimeMillis();
        Cached cached = cache.get(key);
        if (cached != null && cached.expiresAt() > now) {
            return cached.result();
        }
        if (cache.size() > CACHE_MAX_KEYS) {
            cache.clear();
        }

        SearchResult result = doSearch(q, t, workspaceId);
        cache.put(key, new Cached(result, now + CACHE_TTL_MS));
        return result;
    }

    private SearchResult doSearch(String q, String type, Long workspaceId) {
        SearchQueryUtil.Analysis a = SearchQueryUtil.analyze(q);
        // 会话标题匹配各 token（OR 子串）：FULLTEXT 模式下标题也按词命中，行为与条目/导图一致
        List<String> titleTokens = a.tokens().stream().map(SearchQueryUtil::escapeLike).toList();
        boolean all = "all".equals(type);
        List<MindmapHit> mindmaps = new ArrayList<>();
        List<EntryHit> entries = new ArrayList<>();
        List<SessionHit> sessions = new ArrayList<>();

        if (all || "mindmap".equals(type)) {
            for (SearchMapper.MindmapRow row : mapper.searchMindmaps(a.mode(), a.clause(), a.pattern(), workspaceId)) {
                mindmaps.add(new MindmapHit(row.getId(), row.getWorkspaceId(), row.getWorkspaceName(),
                        row.getName(), SearchQueryUtil.snippet(row.getSearchText(), a.tokens()),
                        SearchQueryUtil.findMatchNodeId(row.getContentJson(), a.tokens()),
                        row.getNodeCount(), row.getUpdatedAt()));
            }
        }
        if (all || "entry".equals(type)) {
            for (SearchMapper.EntryRow row : mapper.searchEntries(a.mode(), a.clause(), a.pattern(), workspaceId)) {
                entries.add(new EntryHit(row.getId(), row.getSessionId(), row.getWorkspaceId(), row.getWorkspaceName(),
                        row.getSessionTitle(), row.getSeq(), row.getType(),
                        SearchQueryUtil.snippet(row.getContentMd(), a.tokens()), row.getCreatedAt()));
            }
        }
        if (all || "session".equals(type)) {
            for (SearchMapper.SessionRow row : mapper.searchSessions(titleTokens, workspaceId)) {
                sessions.add(new SessionHit(row.getId(), row.getWorkspaceId(), row.getWorkspaceName(),
                        row.getTitle(), row.getStatus(), row.getStartedAt(), row.getEndedAt()));
            }
        }
        return new SearchResult(q.trim(), List.copyOf(mindmaps), List.copyOf(entries), List.copyOf(sessions));
    }

    private String validateType(String type) {
        String t = type == null || type.isBlank() ? "all" : type.trim().toLowerCase();
        if (!TYPES.contains(t)) {
            throw new BadRequestException("无效的搜索类型：" + type + "（可选 mindmap|entry|session|all）");
        }
        return t;
    }
}
