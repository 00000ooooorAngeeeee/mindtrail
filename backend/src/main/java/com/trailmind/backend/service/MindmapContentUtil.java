package com.trailmind.backend.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.trailmind.backend.common.BadRequestException;

import java.util.ArrayList;
import java.util.Iterator;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * 导图 content_json 纯函数解析：从整图 JSON 提取搜索文本（search_text）与节点数（node_count）。
 * 规则见 docs/05 §4 保存语义：search_text = name + 全部节点 text/note/tags + 边 label；node_count = nodes 数量。
 * 无 Spring 依赖，便于纯单测（对应 08 §6「前端纯函数单测」在后端的等价物）。
 */
public final class MindmapContentUtil {

    private static final ObjectMapper MAPPER = new ObjectMapper();
    /** search_text 列宽 VARCHAR(8000)，超出截断（2000 节点极端场景防溢出）。 */
    private static final int SEARCH_TEXT_MAX = 8000;

    private MindmapContentUtil() {
    }

    /** 新建导图的默认内容：单个根节点「中心主题」（PRD B1.1）。 */
    public static String defaultContentJson() {
        return DEFAULT_CONTENT;
    }

    /** 解析整图 JSON，返回拼接好的搜索文本与节点数。contentJson 为空或非法 JSON 抛 BadRequestException。 */
    public static Summary analyze(String name, String contentJson) {
        JsonNode root = parse(contentJson);

        List<String> parts = new ArrayList<>();
        if (name != null && !name.isBlank()) {
            parts.add(name.trim());
        }

        int nodeCount = 0;
        JsonNode nodes = root.path("nodes");
        if (nodes.isObject()) {
            Iterator<Map.Entry<String, JsonNode>> it = nodes.fields();
            while (it.hasNext()) {
                JsonNode node = it.next().getValue();
                nodeCount++;
                addText(parts, node.path("text"));
                addText(parts, node.path("note"));
                JsonNode tags = node.path("tags");
                if (tags.isArray()) {
                    for (JsonNode tag : tags) {
                        addText(parts, tag);
                    }
                }
            }
        }

        JsonNode edges = root.path("edges");
        if (edges.isArray()) {
            for (JsonNode edge : edges) {
                addText(parts, edge.path("label"));
            }
        }

        String searchText = String.join(" ", parts);
        if (searchText.length() > SEARCH_TEXT_MAX) {
            searchText = searchText.substring(0, SEARCH_TEXT_MAX);
        }
        return new Summary(searchText, nodeCount);
    }

    private static JsonNode parse(String contentJson) {
        if (contentJson == null || contentJson.isBlank()) {
            throw new BadRequestException("content_json 不能为空");
        }
        try {
            return MAPPER.readTree(contentJson);
        } catch (Exception e) {
            throw new BadRequestException("content_json 不是合法 JSON");
        }
    }

    private static void addText(List<String> parts, JsonNode node) {
        if (node == null || node.isMissingNode() || node.isNull()) {
            return;
        }
        String s = node.isTextual() ? node.textValue() : node.toString();
        if (s != null && !s.isBlank()) {
            parts.add(s);
        }
    }

    /** 解析整图 JSON，返回全部节点 id 集合（v1.1 联动：节点存在性校验 / 保存差异清理）。非法 JSON 抛 BadRequestException。 */
    public static Set<String> nodeIds(String contentJson) {
        JsonNode nodes = parse(contentJson).path("nodes");
        Set<String> ids = new LinkedHashSet<>();
        if (nodes.isObject()) {
            nodes.fieldNames().forEachRemaining(ids::add);
        }
        return ids;
    }

    /** 节点搜索视图：id → (text, parentId)，保留 JSON 书写顺序（v1.1 联动节点搜索/路径派生用）。非法 JSON 抛 BadRequestException。 */
    public static Map<String, NodeView> nodeViews(String contentJson) {
        JsonNode nodes = parse(contentJson).path("nodes");
        Map<String, NodeView> out = new LinkedHashMap<>();
        if (nodes.isObject()) {
            Iterator<Map.Entry<String, JsonNode>> it = nodes.fields();
            while (it.hasNext()) {
                Map.Entry<String, JsonNode> e = it.next();
                JsonNode n = e.getValue();
                out.put(e.getKey(), new NodeView(nodeText(n.path("text")), nodeParentId(n.path("parentId"))));
            }
        }
        return out;
    }

    private static String nodeText(JsonNode node) {
        if (node == null || node.isMissingNode() || node.isNull()) {
            return "";
        }
        return node.isTextual() ? node.textValue() : node.toString();
    }

    private static String nodeParentId(JsonNode node) {
        if (node == null || node.isMissingNode() || node.isNull() || !node.isTextual()) {
            return null;
        }
        return node.textValue();
    }

    /** 节点视图：文本 + 父节点 id（父不存在为 null）。 */
    public record NodeView(String text, String parentId) {
    }

    /** 解析结果：搜索文本 + 节点数。 */
    public record Summary(String searchText, int nodeCount) {
    }

    private static final String DEFAULT_CONTENT = """
            {"version":1,"rootNodeId":"n1","nodes":{"n1":{"id":"n1","text":"中心主题","note":"","style":{"color":"default","bold":false,"shape":"rounded"},"tags":[],"parentId":null,"layout":null,"collapsed":false}},"edges":[]}
            """;
}
