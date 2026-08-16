package com.trailmind.backend.service;

import com.trailmind.backend.common.BadRequestException;
import com.trailmind.backend.common.NotFoundException;
import com.trailmind.backend.entity.Entry;
import com.trailmind.backend.entity.Mindmap;
import com.trailmind.backend.entity.NodeEntry;
import com.trailmind.backend.entity.Session;
import com.trailmind.backend.entity.Workspace;
import com.trailmind.backend.repository.EntryMapper;
import com.trailmind.backend.repository.MindmapMapper;
import com.trailmind.backend.repository.NodeEntryMapper;
import com.trailmind.backend.repository.SessionMapper;
import com.trailmind.backend.repository.WorkspaceMapper;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * 导图↔记录联动服务单测（v1.1 P1，docs/07 §8 Backlog 第一优先）：
 * 节点挂条目（替换语义 + 节点/条目/同工作区校验）、条目引用节点（跨导图 + 同工作区校验）、
 * 双向查询（挂接图 / 详情 / 引用列表 / 会话批量回填）、选择器（节点搜索 + 路径 / 最近条目）、
 * 保存差异清理（cleanupRemovedNodes）与防御性过滤（节点已删的挂接不可见）。
 */
@ExtendWith(MockitoExtension.class)
class NodeEntryServiceTest {

    @Mock
    private NodeEntryMapper nodeEntryMapper;
    @Mock
    private MindmapMapper mindmapMapper;
    @Mock
    private EntryMapper entryMapper;
    @Mock
    private SessionMapper sessionMapper;
    @Mock
    private WorkspaceMapper workspaceMapper;

    @InjectMocks
    private NodeEntryService service;

    /** 构造 content_json：nodeSpec 形如 "n1:根:null"（id:text:parentId）。 */
    private String jsonOf(String... nodeSpecs) {
        StringBuilder sb = new StringBuilder("{\"version\":1,\"nodes\":{");
        for (int i = 0; i < nodeSpecs.length; i++) {
            String[] p = nodeSpecs[i].split(":", 3);
            if (i > 0) {
                sb.append(',');
            }
            sb.append('"').append(p[0]).append("\":{\"id\":\"").append(p[0])
                    .append("\",\"text\":\"").append(p[1]).append("\",\"parentId\":")
                    .append("null".equals(p[2]) ? "null" : "\"" + p[2] + "\"").append('}');
        }
        return sb.append("},\"edges\":[]}").toString();
    }

    private Mindmap mindmap(Long id, Long workspaceId, String json) {
        Mindmap m = new Mindmap();
        m.setId(id);
        m.setWorkspaceId(workspaceId);
        m.setName("验收导图");
        m.setContentJson(json);
        return m;
    }

    private Entry entry(Long id, Long sessionId) {
        Entry e = new Entry();
        e.setId(id);
        e.setSessionId(sessionId);
        e.setSeq(1);
        e.setType("action");
        e.setContentMd("内容");
        return e;
    }

    private Session session(Long id, Long workspaceId) {
        Session s = new Session();
        s.setId(id);
        s.setWorkspaceId(workspaceId);
        s.setTitle("会话");
        return s;
    }

    private NodeEntryMapper.LinkedEntryRow linkedRow(Long entryId, Long sessionId, String title, int seq) {
        NodeEntryMapper.LinkedEntryRow r = new NodeEntryMapper.LinkedEntryRow();
        r.setId(entryId);
        r.setSessionId(sessionId);
        r.setSessionTitle(title);
        r.setSeq(seq);
        r.setType("action");
        r.setContentMd("正文");
        r.setCreatedAt(LocalDateTime.of(2026, 8, 20, 10, 0, 0));
        return r;
    }

    private NodeEntryMapper.NodeRefRow refRow(Long mindmapId, String nodeId, Long workspaceId) {
        NodeEntryMapper.NodeRefRow r = new NodeEntryMapper.NodeRefRow();
        r.setMindmapId(mindmapId);
        r.setNodeId(nodeId);
        r.setWorkspaceId(workspaceId);
        return r;
    }

    // ==================== 节点挂条目 ====================

    @Test
    void replaceNodeLinks_replaces_set_and_returns_latest_details() {
        Mindmap mm = mindmap(1L, 3L, jsonOf("n1:根:null", "n2:子:n1"));
        when(mindmapMapper.selectById(1L)).thenReturn(mm, mm);
        when(entryMapper.selectById(10L)).thenReturn(entry(10L, 7L));
        when(entryMapper.selectById(11L)).thenReturn(entry(11L, 8L));
        when(sessionMapper.selectById(7L)).thenReturn(session(7L, 3L));
        when(sessionMapper.selectById(8L)).thenReturn(session(8L, 3L));
        when(nodeEntryMapper.selectLinkedEntries(1L, "n1")).thenReturn(
                List.of(linkedRow(10L, 7L, "会话甲", 2), linkedRow(11L, 8L, "会话乙", 5)));

        List<NodeEntryService.LinkedEntry> out = service.replaceNodeLinks(1L, "n1", List.of(10L, 11L));

        verify(nodeEntryMapper).deleteByMindmapAndNode(1L, "n1");
        verify(nodeEntryMapper, times(2)).insert(any(NodeEntry.class));
        assertEquals(2, out.size());
        assertEquals("会话甲", out.get(0).sessionTitle());
        assertEquals(2, out.get(0).seq());
        assertEquals("正文", out.get(0).contentPreview());
    }

    @Test
    void replaceNodeLinks_empty_list_clears_links() {
        Mindmap mm = mindmap(1L, 3L, jsonOf("n1:根:null"));
        when(mindmapMapper.selectById(1L)).thenReturn(mm, mm);
        when(nodeEntryMapper.selectLinkedEntries(1L, "n1")).thenReturn(List.of());

        List<NodeEntryService.LinkedEntry> out = service.replaceNodeLinks(1L, "n1", null);

        verify(nodeEntryMapper).deleteByMindmapAndNode(1L, "n1");
        verify(nodeEntryMapper, never()).insert(any(NodeEntry.class));
        assertTrue(out.isEmpty());
    }

    @Test
    void replaceNodeLinks_node_not_in_content_throws() {
        Mindmap mm = mindmap(1L, 3L, jsonOf("n1:根:null"));
        when(mindmapMapper.selectById(1L)).thenReturn(mm);

        assertThrows(BadRequestException.class, () -> service.replaceNodeLinks(1L, "n9", List.of(10L)));
        verify(nodeEntryMapper, never()).deleteByMindmapAndNode(anyLong(), anyString());
    }

    @Test
    void replaceNodeLinks_entry_in_other_workspace_throws() {
        Mindmap mm = mindmap(1L, 3L, jsonOf("n1:根:null"));
        when(mindmapMapper.selectById(1L)).thenReturn(mm);
        when(entryMapper.selectById(10L)).thenReturn(entry(10L, 7L));
        when(sessionMapper.selectById(7L)).thenReturn(session(7L, 99L)); // 另一工作区

        assertThrows(BadRequestException.class, () -> service.replaceNodeLinks(1L, "n1", List.of(10L)));
        verify(nodeEntryMapper, never()).deleteByMindmapAndNode(anyLong(), anyString());
    }

    @Test
    void replaceNodeLinks_entry_not_found_throws() {
        Mindmap mm = mindmap(1L, 3L, jsonOf("n1:根:null"));
        when(mindmapMapper.selectById(1L)).thenReturn(mm);
        when(entryMapper.selectById(99L)).thenReturn(null);

        assertThrows(NotFoundException.class, () -> service.replaceNodeLinks(1L, "n1", List.of(99L)));
    }

    @Test
    void replaceNodeLinks_dedupes_ids_and_rejects_over_limit() {
        Mindmap mm = mindmap(1L, 3L, jsonOf("n1:根:null"));
        when(mindmapMapper.selectById(1L)).thenReturn(mm, mm);
        when(entryMapper.selectById(10L)).thenReturn(entry(10L, 7L));
        when(sessionMapper.selectById(7L)).thenReturn(session(7L, 3L));
        when(nodeEntryMapper.selectLinkedEntries(1L, "n1")).thenReturn(List.of(linkedRow(10L, 7L, "会话", 1)));

        service.replaceNodeLinks(1L, "n1", List.of(10L, 10L, 10L));

        verify(nodeEntryMapper, times(1)).insert(any(NodeEntry.class)); // 去重后只插一次
        List<Long> tooMany = new ArrayList<>();
        for (long i = 1; i <= 101; i++) {
            tooMany.add(i);
        }
        assertThrows(BadRequestException.class, () -> service.replaceNodeLinks(1L, "n1", tooMany));
    }

    @Test
    void nodeLinks_maps_rows_and_truncates_preview() {
        Mindmap mm = mindmap(1L, 3L, jsonOf("n1:根:null"));
        when(mindmapMapper.selectById(1L)).thenReturn(mm);
        NodeEntryMapper.LinkedEntryRow r = linkedRow(10L, 7L, "会话", 3);
        r.setContentMd("x".repeat(600));
        when(nodeEntryMapper.selectLinkedEntries(1L, "n1")).thenReturn(List.of(r));

        List<NodeEntryService.LinkedEntry> out = service.nodeLinks(1L, "n1");

        assertEquals(1, out.size());
        assertEquals(500, out.get(0).contentPreview().length());
    }

    @Test
    void mindmapLinks_groups_by_node_and_filters_deleted_nodes() {
        Mindmap mm = mindmap(1L, 3L, jsonOf("n1:根:null")); // n2 已从内容删除
        when(mindmapMapper.selectById(1L)).thenReturn(mm);
        NodeEntryMapper.NodeRow r1 = new NodeEntryMapper.NodeRow();
        r1.setNodeId("n1");
        r1.setEntryId(10L);
        NodeEntryMapper.NodeRow r2 = new NodeEntryMapper.NodeRow();
        r2.setNodeId("n2"); // 内容中不存在 → 过滤
        r2.setEntryId(11L);
        when(nodeEntryMapper.selectByMindmap(1L)).thenReturn(List.of(r1, r2));

        Map<String, List<Long>> out = service.mindmapLinks(1L);

        assertEquals(Map.of("n1", List.of(10L)), out);
    }

    // ==================== 条目引用节点 ====================

    @Test
    void replaceEntryNodes_replaces_across_mindmaps_and_returns_refs() {
        when(entryMapper.selectById(10L)).thenReturn(entry(10L, 7L));
        when(sessionMapper.selectById(7L)).thenReturn(session(7L, 3L));
        when(mindmapMapper.selectById(1L)).thenReturn(mindmap(1L, 3L, jsonOf("n1:根:null", "n2:子:n1")));
        when(mindmapMapper.selectById(2L)).thenReturn(mindmap(2L, 3L, jsonOf("n9:另一张图:null")));
        when(nodeEntryMapper.selectByEntry(10L)).thenReturn(
                List.of(refRow(1L, "n2", 3L), refRow(2L, "n9", 3L)));
        when(mindmapMapper.selectBatchIds(Set.of(1L, 2L))).thenReturn(
                List.of(mindmap(1L, 3L, jsonOf("n1:根:null", "n2:子:n1")), mindmap(2L, 3L, jsonOf("n9:另一张图:null"))));

        List<NodeEntryService.NodeRef> out = service.replaceEntryNodes(
                10L, List.of(new NodeEntryService.NodeRefInput(1L, "n2"), new NodeEntryService.NodeRefInput(2L, "n9")));

        verify(nodeEntryMapper).deleteByEntry(10L);
        verify(nodeEntryMapper, times(2)).insert(any(NodeEntry.class));
        assertEquals(2, out.size());
        assertEquals("验收导图", out.get(0).mindmapName());
        assertEquals("子", out.get(0).nodeText());
        assertEquals("另一张图", out.get(1).nodeText());
    }

    @Test
    void replaceEntryNodes_mindmap_in_other_workspace_throws() {
        when(entryMapper.selectById(10L)).thenReturn(entry(10L, 7L));
        when(sessionMapper.selectById(7L)).thenReturn(session(7L, 3L));
        when(mindmapMapper.selectById(1L)).thenReturn(mindmap(1L, 99L, jsonOf("n1:根:null"))); // 另一工作区

        assertThrows(BadRequestException.class,
                () -> service.replaceEntryNodes(10L, List.of(new NodeEntryService.NodeRefInput(1L, "n1"))));
        verify(nodeEntryMapper, never()).deleteByEntry(anyLong());
    }

    @Test
    void replaceEntryNodes_node_missing_in_mindmap_throws() {
        when(entryMapper.selectById(10L)).thenReturn(entry(10L, 7L));
        when(sessionMapper.selectById(7L)).thenReturn(session(7L, 3L));
        when(mindmapMapper.selectById(1L)).thenReturn(mindmap(1L, 3L, jsonOf("n1:根:null")));

        assertThrows(BadRequestException.class,
                () -> service.replaceEntryNodes(10L, List.of(new NodeEntryService.NodeRefInput(1L, "n9"))));
    }

    @Test
    void entryNodes_skips_refs_whose_node_or_mindmap_is_gone() {
        when(entryMapper.selectById(10L)).thenReturn(entry(10L, 7L));
        when(nodeEntryMapper.selectByEntry(10L)).thenReturn(
                List.of(refRow(1L, "n1", 3L), refRow(1L, "n9", 3L), refRow(9L, "n1", 3L)));
        when(mindmapMapper.selectBatchIds(Set.of(1L, 9L))).thenReturn(
                List.of(mindmap(1L, 3L, jsonOf("n1:根:null")))); // 导图 9 已删、节点 n9 已删

        List<NodeEntryService.NodeRef> out = service.entryNodes(10L);

        assertEquals(1, out.size());
        assertEquals("n1", out.get(0).nodeId());
        assertEquals("根", out.get(0).nodeText());
    }

    @Test
    void sessionLinks_batches_by_entry_and_skips_deleted_nodes() {
        when(sessionMapper.selectById(7L)).thenReturn(session(7L, 3L));
        NodeEntryMapper.SessionRefRow r1 = new NodeEntryMapper.SessionRefRow();
        r1.setEntryId(10L);
        r1.setMindmapId(1L);
        r1.setNodeId("n1");
        r1.setWorkspaceId(3L);
        NodeEntryMapper.SessionRefRow r2 = new NodeEntryMapper.SessionRefRow();
        r2.setEntryId(11L);
        r2.setMindmapId(1L);
        r2.setNodeId("n2");
        r2.setWorkspaceId(3L);
        NodeEntryMapper.SessionRefRow r3 = new NodeEntryMapper.SessionRefRow();
        r3.setEntryId(11L);
        r3.setMindmapId(1L);
        r3.setNodeId("n9"); // 已删节点 → 过滤
        r3.setWorkspaceId(3L);
        when(nodeEntryMapper.selectBySession(7L)).thenReturn(List.of(r1, r2, r3));
        when(mindmapMapper.selectBatchIds(Set.of(1L))).thenReturn(
                List.of(mindmap(1L, 3L, jsonOf("n1:根:null", "n2:子:n1"))));

        Map<Long, List<NodeEntryService.NodeRef>> out = service.sessionLinks(7L);

        assertEquals(2, out.size());
        assertEquals(1, out.get(10L).size());
        assertEquals(1, out.get(11L).size());
        assertEquals("子", out.get(11L).get(0).nodeText());
        assertEquals(3L, out.get(10L).get(0).workspaceId());
    }

    // ==================== 选择器 ====================

    @Test
    void searchNodes_filters_by_keyword_and_builds_path() {
        Mindmap mm = mindmap(1L, 3L, jsonOf("n1:根:null", "n2:思维导图:n1", "n3:导图:n2"));
        when(mindmapMapper.selectById(1L)).thenReturn(mm);

        List<NodeEntryService.NodeHit> out = service.searchNodes(1L, "导图");

        assertEquals(2, out.size());
        assertEquals("n2", out.get(0).nodeId());
        assertEquals("根 / 思维导图", out.get(0).path());
        assertEquals("n3", out.get(1).nodeId());
        assertEquals("根 / 思维导图 / 导图", out.get(1).path());
    }

    @Test
    void searchNodes_empty_keyword_browses_all_and_case_insensitive() {
        Mindmap mm = mindmap(1L, 3L, jsonOf("n1:Root:null", "n2:子:n1"));
        when(mindmapMapper.selectById(1L)).thenReturn(mm);

        assertEquals(2, service.searchNodes(1L, "").size());
        assertEquals(1, service.searchNodes(1L, "root").size());
    }

    @Test
    void recentEntries_workspace_missing_throws_and_limit_clamped() {
        when(workspaceMapper.selectById(99L)).thenReturn(null);
        assertThrows(NotFoundException.class, () -> service.recentEntries(99L, null));

        when(workspaceMapper.selectById(3L)).thenReturn(new Workspace());
        when(entryMapper.selectRecentByWorkspace(3L, 20)).thenReturn(List.of());
        service.recentEntries(3L, 1000); // 超上限收敛为 20

        EntryMapper.RecentRow r = new EntryMapper.RecentRow();
        r.setId(10L);
        r.setSessionId(7L);
        r.setSessionTitle("会话");
        r.setType("action");
        r.setContentMd("内容");
        r.setCreatedAt(LocalDateTime.of(2026, 8, 20, 10, 0, 0));
        when(entryMapper.selectRecentByWorkspace(3L, 20)).thenReturn(List.of(r));
        List<NodeEntryService.RecentEntry> out = service.recentEntries(3L, null);
        assertEquals(1, out.size());
        assertEquals("会话", out.get(0).sessionTitle());
    }

    // ==================== 保存差异清理 ====================

    @Test
    void cleanupRemovedNodes_deletes_links_of_removed_nodes_only() {
        service.cleanupRemovedNodes(1L, jsonOf("n1:根:null", "n2:子:n1", "n3:孙:n2"),
                jsonOf("n1:根:null", "n2:子:n1"));

        verify(nodeEntryMapper).deleteByMindmapAndNodeIds(1L, List.of("n3"));
    }

    @Test
    void cleanupRemovedNodes_no_removal_skips_delete() {
        service.cleanupRemovedNodes(1L, jsonOf("n1:根:null", "n2:子:n1"),
                jsonOf("n1:根:null", "n2:子:n1"));

        verify(nodeEntryMapper, never()).deleteByMindmapAndNodeIds(anyLong(), any());
    }

    @Test
    void cleanupRemovedNodes_invalid_old_content_is_defensive_skip() {
        service.cleanupRemovedNodes(1L, "{broken", jsonOf("n1:根:null"));

        verify(nodeEntryMapper, never()).deleteByMindmapAndNodeIds(anyLong(), any());
    }
}
