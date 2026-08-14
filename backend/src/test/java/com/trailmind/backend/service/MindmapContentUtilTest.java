package com.trailmind.backend.service;

import com.trailmind.backend.common.BadRequestException;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * content_json 解析纯函数单测：search_text 拼接与 node_count 统计（05 §4 保存语义）。
 */
class MindmapContentUtilTest {

    @Test
    void analyze_extracts_name_nodes_and_edges() {
        String json = """
                {"version":1,"rootNodeId":"n1",
                 "nodes":{
                   "n1":{"text":"根节点","note":"备注","tags":["标签1","标签2"]},
                   "n2":{"text":"子节点","note":"","tags":[]}
                 },
                 "edges":[{"id":"e1","source":"n1","target":"n2","label":"父子边"}]}
                """;

        MindmapContentUtil.Summary s = MindmapContentUtil.analyze("导图A", json);

        assertEquals(2, s.nodeCount());
        assertTrue(s.searchText().contains("导图A"));
        assertTrue(s.searchText().contains("根节点"));
        assertTrue(s.searchText().contains("备注"));
        assertTrue(s.searchText().contains("标签1"));
        assertTrue(s.searchText().contains("标签2"));
        assertTrue(s.searchText().contains("子节点"));
        assertTrue(s.searchText().contains("父子边"));
    }

    @Test
    void analyze_empty_nodes_counts_zero_and_keeps_name() {
        String json = "{\"version\":1,\"nodes\":{},\"edges\":[]}";

        MindmapContentUtil.Summary s = MindmapContentUtil.analyze("导图A", json);

        assertEquals(0, s.nodeCount());
        assertEquals("导图A", s.searchText());
    }

    @Test
    void analyze_invalid_json_throws() {
        assertThrows(BadRequestException.class, () -> MindmapContentUtil.analyze("导图", "{not-json"));
    }

    @Test
    void analyze_blank_json_throws() {
        assertThrows(BadRequestException.class, () -> MindmapContentUtil.analyze("导图", "  "));
        assertThrows(BadRequestException.class, () -> MindmapContentUtil.analyze("导图", null));
    }

    @Test
    void analyze_truncates_search_text_to_8000() {
        String longText = "x".repeat(9000);
        String json = "{\"version\":1,\"nodes\":{\"n1\":{\"text\":\"" + longText + "\"}},\"edges\":[]}";

        MindmapContentUtil.Summary s = MindmapContentUtil.analyze(null, json);

        assertEquals(1, s.nodeCount());
        assertEquals(8000, s.searchText().length());
    }

    @Test
    void defaultContentJson_has_single_root_node() {
        String json = MindmapContentUtil.defaultContentJson();

        MindmapContentUtil.Summary s = MindmapContentUtil.analyze("导图A", json);

        assertEquals(1, s.nodeCount());
        assertTrue(s.searchText().contains("中心主题"));
    }
}
