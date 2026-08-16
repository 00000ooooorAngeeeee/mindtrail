package com.trailmind.backend.service;

import com.trailmind.backend.common.BadRequestException;
import com.trailmind.backend.common.NotFoundException;
import com.trailmind.backend.entity.Entry;
import com.trailmind.backend.entity.Mindmap;
import com.trailmind.backend.entity.NodeEntry;
import com.trailmind.backend.entity.Session;
import com.trailmind.backend.repository.EntryMapper;
import com.trailmind.backend.repository.MindmapMapper;
import com.trailmind.backend.repository.NodeEntryMapper;
import com.trailmind.backend.repository.SessionMapper;
import com.trailmind.backend.repository.WorkspaceMapper;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.stream.Collectors;

/**
 * 导图节点↔记录条目联动（v1.1 P1，PRD §5 / 07 §8 Backlog 第一优先：节点挂条目、条目引用节点）：
 * 节点侧替换挂接（PUT /mindmaps/{id}/nodes/{nodeId}/links）、条目侧替换引用（PUT /entries/{id}/nodes）、
 * 双向查询（含会话级批量回填，避免时间线 N+1）、节点搜索与最近条目（选择器数据源）。
 * 关系存 node_entry 表（05 §3），不写入 content_json（避免整图 JSON 漂移）；查询侧按 content_json
 * 节点存在性过滤（节点已删的挂接不可见，由 save 差异清理收敛孤儿行，05 §4 保存语义）。
 * 约束：导图与条目必须属于同一工作区（跨工作区联动超出 MVP 范围）；「先清后插」替换语义保证幂等。
 */
@Service
public class NodeEntryService {

    /** 单节点/单条目挂接数量上限（选择器勾选防失控）。 */
    private static final int MAX_LINKS = 100;
    /** 节点搜索命中上限（有关键词）。 */
    private static final int NODE_SEARCH_LIMIT = 50;
    /** 节点浏览上限（无关键词）。 */
    private static final int NODE_BROWSE_LIMIT = 100;
    /** 祖先路径链最长（防脏数据成环死循环）。 */
    private static final int PATH_MAX_DEPTH = 20;
    /** 最近条目默认条数 / 上限。 */
    private static final int RECENT_LIMIT = 20;
    /** 详情/候选内容预览截断长度。 */
    private static final int PREVIEW_MAX = 500;

    private final NodeEntryMapper nodeEntryMapper;
    private final MindmapMapper mindmapMapper;
    private final EntryMapper entryMapper;
    private final SessionMapper sessionMapper;
    private final WorkspaceMapper workspaceMapper;

    public NodeEntryService(NodeEntryMapper nodeEntryMapper, MindmapMapper mindmapMapper,
                            EntryMapper entryMapper, SessionMapper sessionMapper,
                            WorkspaceMapper workspaceMapper) {
        this.nodeEntryMapper = nodeEntryMapper;
        this.mindmapMapper = mindmapMapper;
        this.entryMapper = entryMapper;
        this.sessionMapper = sessionMapper;
        this.workspaceMapper = workspaceMapper;
    }

    // ==================== 节点侧 ====================

    /** 替换节点挂接的条目集合（先清后插，事务内，幂等）。返回最新挂接详情。 */
    @Transactional
    public List<LinkedEntry> replaceNodeLinks(Long mindmapId, String nodeId, List<Long> entryIds) {
        Mindmap mindmap = requireMindmap(mindmapId);
        ensureNodeExists(mindmap, nodeId);
        List<Long> ids = normalizeEntryIds(entryIds);
        for (Long entryId : ids) {
            ensureEntryInWorkspace(entryId, mindmap.getWorkspaceId());
        }
        nodeEntryMapper.deleteByMindmapAndNode(mindmapId, nodeId);
        for (Long entryId : ids) {
            nodeEntryMapper.insert(new NodeEntry(mindmapId, nodeId, entryId));
        }
        return nodeLinks(mindmapId, nodeId);
    }

    /** 节点挂接的条目详情（详情弹层数据源，04 §5）。 */
    public List<LinkedEntry> nodeLinks(Long mindmapId, String nodeId) {
        requireMindmap(mindmapId);
        List<NodeEntryMapper.LinkedEntryRow> rows = nodeEntryMapper.selectLinkedEntries(mindmapId, nodeId);
        List<LinkedEntry> out = new ArrayList<>(rows.size());
        for (NodeEntryMapper.LinkedEntryRow r : rows) {
            out.add(new LinkedEntry(r.getId(), r.getSessionId(), r.getSessionTitle(), r.getSeq(),
                    r.getType(), preview(r.getContentMd()), r.getCreatedAt()));
        }
        return out;
    }

    /** 导图全部挂接（徽标计数）：nodeId → entryIds（仅含当前 content_json 仍存在的节点）。 */
    public Map<String, List<Long>> mindmapLinks(Long mindmapId) {
        Mindmap mindmap = requireMindmap(mindmapId);
        Map<String, MindmapContentUtil.NodeView> views = safeNodeViews(mindmap);
        Map<String, List<Long>> out = new LinkedHashMap<>();
        for (NodeEntryMapper.NodeRow row : nodeEntryMapper.selectByMindmap(mindmapId)) {
            if (!views.containsKey(row.getNodeId())) {
                continue; // 节点已删（历史残留），不展示
            }
            out.computeIfAbsent(row.getNodeId(), k -> new ArrayList<>()).add(row.getEntryId());
        }
        return out;
    }

    // ==================== 条目侧 ====================

    /** 替换条目引用的节点集合（先清后插，事务内，幂等；可跨导图）。返回最新引用列表。 */
    @Transactional
    public List<NodeRef> replaceEntryNodes(Long entryId, List<NodeRefInput> refs) {
        Entry entry = requireEntry(entryId);
        Session session = requireSession(entry.getSessionId());
        List<NodeRefInput> list = normalizeRefs(refs);
        for (NodeRefInput ref : list) {
            ensureMindmapInWorkspace(ref.mindmapId(), session.getWorkspaceId(), ref.nodeId());
        }
        nodeEntryMapper.deleteByEntry(entryId);
        for (NodeRefInput ref : list) {
            nodeEntryMapper.insert(new NodeEntry(ref.mindmapId(), ref.nodeId(), entryId));
        }
        return entryNodes(entryId);
    }

    /** 条目引用的节点列表（含导图名与节点文本；节点/导图已删的引用过滤掉）。 */
    public List<NodeRef> entryNodes(Long entryId) {
        requireEntry(entryId);
        return resolveRefs(nodeEntryMapper.selectByEntry(entryId));
    }

    /** 会话内全部条目引用（时间线批量回填，避免逐条 N+1）：entryId → [NodeRef]。 */
    public Map<Long, List<NodeRef>> sessionLinks(Long sessionId) {
        requireSession(sessionId);
        List<NodeEntryMapper.SessionRefRow> rows = nodeEntryMapper.selectBySession(sessionId);
        if (rows.isEmpty()) {
            return Map.of();
        }
        Map<Long, List<NodeRef>> byEntry = new LinkedHashMap<>();
        // 按导图分组一次读 content_json（避免对每个引用逐导图读）
        Map<Long, List<RefKey>> refsByMindmap = new LinkedHashMap<>();
        for (NodeEntryMapper.SessionRefRow row : rows) {
            byEntry.computeIfAbsent(row.getEntryId(), k -> new ArrayList<>());
            refsByMindmap.computeIfAbsent(row.getMindmapId(), k -> new ArrayList<>())
                    .add(new RefKey(row.getEntryId(), row.getNodeId(), row.getWorkspaceId()));
        }
        Map<Long, Mindmap> mindmaps = loadMindmaps(refsByMindmap.keySet());
        for (Map.Entry<Long, List<RefKey>> e : refsByMindmap.entrySet()) {
            Mindmap mm = mindmaps.get(e.getKey());
            if (mm == null) {
                continue; // 导图已删（级联应已清理，防御）
            }
            Map<String, MindmapContentUtil.NodeView> views = safeNodeViews(mm);
            for (RefKey key : e.getValue()) {
                if (!views.containsKey(key.nodeId())) {
                    continue;
                }
                byEntry.get(key.entryId()).add(
                        new NodeRef(key.workspaceId(), mm.getId(), mm.getName(), key.nodeId(),
                                views.get(key.nodeId()).text()));
            }
        }
        byEntry.values().removeIf(List::isEmpty);
        return byEntry;
    }

    // ==================== 选择器 ====================

    /** 节点搜索：文本包含 q（大小写不敏感）；q 空时浏览全部。返回 {nodeId, text, path}（path 为祖先链「根/子/孙」）。 */
    public List<NodeHit> searchNodes(Long mindmapId, String q) {
        Mindmap mindmap = requireMindmap(mindmapId);
        Map<String, MindmapContentUtil.NodeView> views = MindmapContentUtil.nodeViews(mindmap.getContentJson());
        String keyword = q == null ? "" : q.trim().toLowerCase();
        int limit = keyword.isEmpty() ? NODE_BROWSE_LIMIT : NODE_SEARCH_LIMIT;
        List<NodeHit> out = new ArrayList<>();
        for (Map.Entry<String, MindmapContentUtil.NodeView> e : views.entrySet()) {
            String text = e.getValue().text();
            if (!keyword.isEmpty() && !text.toLowerCase().contains(keyword)) {
                continue;
            }
            out.add(new NodeHit(e.getKey(), text, pathOf(views, e.getKey())));
            if (out.size() >= limit) {
                break;
            }
        }
        return out;
    }

    /** 工作区最近条目（节点挂条目对话框候选，按创建时间倒序）。 */
    public List<RecentEntry> recentEntries(Long workspaceId, Integer limit) {
        if (workspaceMapper.selectById(workspaceId) == null) {
            throw new NotFoundException("工作区不存在");
        }
        int n = limit == null ? RECENT_LIMIT : Math.min(Math.max(limit, 1), RECENT_LIMIT);
        List<EntryMapper.RecentRow> rows = entryMapper.selectRecentByWorkspace(workspaceId, n);
        List<RecentEntry> out = new ArrayList<>(rows.size());
        for (EntryMapper.RecentRow r : rows) {
            out.add(new RecentEntry(r.getId(), r.getSessionId(), r.getSessionTitle(), r.getSeq(), r.getType(),
                    preview(r.getContentMd()), r.getCreatedAt()));
        }
        return out;
    }

    // ==================== 保存差异清理（05 §4 保存语义补充） ====================

    /** 整图保存后调用：删除「内容中已不存在节点」的挂接（防孤儿行；节点撤销恢复场景由「保存前撤销不落库」保证不误伤）。 */
    public void cleanupRemovedNodes(Long mindmapId, String oldContentJson, String newContentJson) {
        Set<String> oldIds;
        Set<String> newIds;
        try {
            oldIds = MindmapContentUtil.nodeIds(oldContentJson);
            newIds = MindmapContentUtil.nodeIds(newContentJson);
        } catch (BadRequestException e) {
            return; // 旧内容异常时跳过清理（新内容合法性由保存路径的 analyze 单独校验）
        }
        Set<String> removed = new LinkedHashSet<>(oldIds);
        removed.removeAll(newIds);
        if (!removed.isEmpty()) {
            nodeEntryMapper.deleteByMindmapAndNodeIds(mindmapId, new ArrayList<>(removed));
        }
    }

    // ==================== 内部工具 ====================

    private List<NodeRef> resolveRefs(List<NodeEntryMapper.NodeRefRow> rows) {
        if (rows.isEmpty()) {
            return List.of();
        }
        Map<Long, List<NodeEntryMapper.NodeRefRow>> byMindmap = rows.stream().collect(
                Collectors.groupingBy(NodeEntryMapper.NodeRefRow::getMindmapId, LinkedHashMap::new, Collectors.toList()));
        Map<Long, Mindmap> mindmaps = loadMindmaps(byMindmap.keySet());
        List<NodeRef> out = new ArrayList<>();
        for (Map.Entry<Long, List<NodeEntryMapper.NodeRefRow>> e : byMindmap.entrySet()) {
            Mindmap mm = mindmaps.get(e.getKey());
            if (mm == null) {
                continue; // 导图已删（级联应已清理，防御）
            }
            Map<String, MindmapContentUtil.NodeView> views = safeNodeViews(mm);
            for (NodeEntryMapper.NodeRefRow row : e.getValue()) {
                if (!views.containsKey(row.getNodeId())) {
                    continue; // 节点已删：引用不可见（保存差异清理会收敛孤儿行）
                }
                out.add(new NodeRef(row.getWorkspaceId(), mm.getId(), mm.getName(), row.getNodeId(),
                        views.get(row.getNodeId()).text()));
            }
        }
        return out;
    }

    /** 祖先链路径「根 / 子 / 孙」（含自身文本；空白文本节点回退显示 id；环/缺失时截断）。 */
    private String pathOf(Map<String, MindmapContentUtil.NodeView> views, String nodeId) {
        List<String> chain = new ArrayList<>();
        String cur = nodeId;
        Set<String> seen = new HashSet<>();
        while (cur != null && chain.size() < PATH_MAX_DEPTH && seen.add(cur)) {
            MindmapContentUtil.NodeView v = views.get(cur);
            if (v == null) {
                break;
            }
            chain.add(v.text().isBlank() ? cur : v.text());
            cur = v.parentId();
        }
        Collections.reverse(chain);
        return String.join(" / ", chain);
    }

    private Map<Long, Mindmap> loadMindmaps(Set<Long> ids) {
        if (ids.isEmpty()) {
            return Map.of();
        }
        Map<Long, Mindmap> out = new LinkedHashMap<>();
        for (Mindmap m : mindmapMapper.selectBatchIds(ids)) {
            out.put(m.getId(), m);
        }
        return out;
    }

    /** 防御性节点视图：content_json 异常时按空图处理（历史脏数据不阻断联动查询）。 */
    private Map<String, MindmapContentUtil.NodeView> safeNodeViews(Mindmap mindmap) {
        try {
            return MindmapContentUtil.nodeViews(mindmap.getContentJson());
        } catch (BadRequestException e) {
            return Map.of();
        }
    }

    private Mindmap requireMindmap(Long mindmapId) {
        Mindmap m = mindmapMapper.selectById(mindmapId);
        if (m == null) {
            throw new NotFoundException("导图不存在");
        }
        return m;
    }

    private Entry requireEntry(Long entryId) {
        Entry e = entryMapper.selectById(entryId);
        if (e == null) {
            throw new NotFoundException("条目不存在");
        }
        return e;
    }

    private Session requireSession(Long sessionId) {
        Session s = sessionMapper.selectById(sessionId);
        if (s == null) {
            throw new NotFoundException("会话不存在");
        }
        return s;
    }

    /** 节点必须存在于该导图 content_json（05 §4）；node_id 同时校验格式（列宽 VARCHAR(64)）。 */
    private void ensureNodeExists(Mindmap mindmap, String nodeId) {
        if (nodeId == null || nodeId.isBlank() || nodeId.length() > 64) {
            throw new BadRequestException("无效的节点 id");
        }
        if (!MindmapContentUtil.nodeIds(mindmap.getContentJson()).contains(nodeId)) {
            throw new BadRequestException("节点不存在：" + nodeId);
        }
    }

    /** 条目必须存在且与导图同工作区（跨工作区联动超出 MVP 范围，04 §5）。 */
    private void ensureEntryInWorkspace(Long entryId, Long workspaceId) {
        Entry e = entryMapper.selectById(entryId);
        if (e == null) {
            throw new NotFoundException("条目不存在：" + entryId);
        }
        Session s = sessionMapper.selectById(e.getSessionId());
        if (s == null || !workspaceId.equals(s.getWorkspaceId())) {
            throw new BadRequestException("条目不属于该导图所在工作区：" + entryId);
        }
    }

    /** 导图必须存在、与条目同工作区、且节点存在于该导图。 */
    private void ensureMindmapInWorkspace(Long mindmapId, Long workspaceId, String nodeId) {
        Mindmap mm = mindmapMapper.selectById(mindmapId);
        if (mm == null) {
            throw new NotFoundException("导图不存在：" + mindmapId);
        }
        if (!workspaceId.equals(mm.getWorkspaceId())) {
            throw new BadRequestException("导图不属于条目所在工作区：" + mindmapId);
        }
        ensureNodeExists(mm, nodeId);
    }

    private List<Long> normalizeEntryIds(List<Long> entryIds) {
        if (entryIds == null || entryIds.isEmpty()) {
            return List.of();
        }
        LinkedHashSet<Long> seen = new LinkedHashSet<>();
        for (Long id : entryIds) {
            if (id == null || id <= 0) {
                throw new BadRequestException("无效的条目 id：" + id);
            }
            seen.add(id);
            if (seen.size() > MAX_LINKS) {
                throw new BadRequestException("单节点最多挂接 " + MAX_LINKS + " 个条目");
            }
        }
        return List.copyOf(seen);
    }

    private List<NodeRefInput> normalizeRefs(List<NodeRefInput> refs) {
        if (refs == null || refs.isEmpty()) {
            return List.of();
        }
        LinkedHashSet<NodeRefInput> seen = new LinkedHashSet<>();
        for (NodeRefInput ref : refs) {
            if (ref == null || ref.mindmapId() == null || ref.nodeId() == null || ref.nodeId().isBlank()) {
                continue;
            }
            seen.add(ref);
            if (seen.size() > MAX_LINKS) {
                throw new BadRequestException("单条目最多引用 " + MAX_LINKS + " 个节点");
            }
        }
        return List.copyOf(seen);
    }

    private String preview(String contentMd) {
        if (contentMd == null || contentMd.length() <= PREVIEW_MAX) {
            return contentMd;
        }
        return contentMd.substring(0, PREVIEW_MAX);
    }

    // ==================== 对外结构 ====================

    /** 节点挂接的条目详情。 */
    public record LinkedEntry(Long entryId, Long sessionId, String sessionTitle, Integer seq, String type,
                              String contentPreview, LocalDateTime createdAt) {
    }

    /** 条目引用的节点（含工作区 id 供前端跳转定位）。 */
    public record NodeRef(Long workspaceId, Long mindmapId, String mindmapName, String nodeId, String nodeText) {
    }

    /** 节点搜索命中。 */
    public record NodeHit(String nodeId, String text, String path) {
    }

    /** 工作区最近条目（选择器候选）。 */
    public record RecentEntry(Long entryId, Long sessionId, String sessionTitle, Integer seq, String type,
                              String contentMd, LocalDateTime createdAt) {
    }

    /** 条目引用节点请求项。 */
    public record NodeRefInput(Long mindmapId, String nodeId) {
    }

    /** 内部分组键：会话引用行。 */
    private record RefKey(Long entryId, String nodeId, Long workspaceId) {
    }
}
