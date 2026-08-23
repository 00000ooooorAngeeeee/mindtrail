package com.trailmind.backend.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.trailmind.backend.common.BadRequestException;
import com.trailmind.backend.common.NotFoundException;
import com.trailmind.backend.entity.Mindmap;
import com.trailmind.backend.repository.MindmapMapper;
import org.springframework.stereotype.Service;

import java.awt.image.BufferedImage;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;

/**
 * 导图导出（M4 任务三，PRD B5 / 04 §5）：当前导图 → PNG（整图，含父链边与自由边，布局坐标优先、树布局兜底）
 * 或 OPML（树状大纲，层级由 nodes[].parentId 派生；自由连线无法用 OPML 表达，导出时忽略并记入文档）。
 * 响应统一走 ApiResponse：data 为 { filename, contentType, content }，其中 PNG content 为 Base64、OPML content 为 XML 原文，
 * 前端解码后触发浏览器下载，不破坏 08 §4.2 的统一响应结构。
 */
@Service
public class MindmapExportService {

    private static final ObjectMapper MAPPER = new ObjectMapper();

    private final MindmapMapper mapper;

    public MindmapExportService(MindmapMapper mapper) {
        this.mapper = mapper;
    }

    /** 导出产物：文件名（已做 Windows 非法字符清理）、MIME 类型、内容（PNG=Base64，OPML=XML 原文）。 */
    public record ExportFile(String filename, String contentType, String content) {
    }

    public ExportFile export(Long mindmapId, String type) {
        Mindmap m = mapper.selectById(mindmapId);
        if (m == null) {
            throw new NotFoundException("导图不存在");
        }
        String t = type == null ? "" : type.trim().toUpperCase(Locale.ROOT);
        String base = sanitizeFileName(m.getName());
        return switch (t) {
            case "PNG" -> new ExportFile(base + ".png", "image/png", MindmapPngRenderer.encode(m.getContentJson()));
            case "OPML" -> new ExportFile(base + ".opml", "text/x-opml;charset=utf-8", exportOpml(m));
            case "MD" -> new ExportFile(base + ".md", "text/markdown;charset=utf-8", exportMarkdown(m));
            default -> throw new BadRequestException("不支持的导图导出类型：" + type + "（仅支持 PNG / OPML / MD）");
        };
    }

    /**
     * Windows 文件名安全化：替换非法字符 {@code \ / : * ? " < > |} 与控制字符为下划线，
     * 去掉首尾空格与点（Windows 文件名规则），空白/清理后为空时回退「未命名导图」。
     */
    static String sanitizeFileName(String name) {
        String cleaned = name == null ? "" : name.trim().replaceAll("[\\\\/:*?\"<>|\\p{Cntrl}]", "_").replaceAll("\\.+$", "");
        if (cleaned.isBlank()) {
            return "未命名导图";
        }
        return cleaned;
    }

    private String exportOpml(Mindmap m) {
        JsonNode content = parseContent(m.getContentJson());
        JsonNode nodes = content.path("nodes");
        if (!nodes.isObject() || nodes.isEmpty()) {
            throw new BadRequestException("导图内容为空，无法导出 OPML");
        }
        // 层级由 parentId 派生（05 §4 注意：树边不落库；自由边忽略，OPML 无法表达多父/环）
        Map<String, List<String>> children = buildChildren(nodes);

        StringBuilder xml = new StringBuilder();
        xml.append("<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n");
        xml.append("<opml version=\"2.0\">\n");
        xml.append("  <head>\n    <title>").append(escapeXml(m.getName())).append("</title>\n  </head>\n");
        xml.append("  <body>\n");

        Set<String> appended = new LinkedHashSet<>();
        String rootId = resolveRoot(content, nodes, children);
        if (rootId != null) {
            appendOutline(xml, nodes, children, rootId, appended, "    ");
        }
        // 兜底：父链断裂/成环等异常数据以孤根导出，保证节点不丢失
        for (var it = nodes.fields(); it.hasNext(); ) {
            String id = it.next().getKey();
            if (appended.add(id)) {
                appendOutline(xml, nodes, children, id, appended, "    ");
            }
        }

        xml.append("  </body>\n</opml>\n");
        return xml.toString();
    }

    /**
     * 导图 → Markdown 大纲（PRD B5 P2，v1.2 落地）：与 OPML 同一棵 parentId 派生树，
     * 输出 ATX H1 标题（导图名）+ 嵌套无序列表（2 空格/层缩进）；节点 note 作 blockquote 子行、
     * 节点 tags 以 # 前缀内联（单 token，与产品标签命名一致）。自由连线无法用大纲表达，导出时忽略。
     * 与 OPML 同属「导图视图导出」，非 06 会话导出协议（无需升 version）。
     */
    private String exportMarkdown(Mindmap m) {
        JsonNode content = parseContent(m.getContentJson());
        JsonNode nodes = content.path("nodes");
        if (!nodes.isObject() || nodes.isEmpty()) {
            throw new BadRequestException("导图内容为空，无法导出 Markdown 大纲");
        }
        Map<String, List<String>> children = buildChildren(nodes);

        StringBuilder md = new StringBuilder();
        md.append("# ").append(m.getName() == null ? "" : m.getName()).append("\n\n");

        Set<String> appended = new LinkedHashSet<>();
        String rootId = resolveRoot(content, nodes, children);
        if (rootId != null) {
            appendMarkdown(md, nodes, children, rootId, appended, 0);
        }
        for (var it = nodes.fields(); it.hasNext(); ) {
            String id = it.next().getKey();
            if (appended.add(id)) {
                appendMarkdown(md, nodes, children, id, appended, 0);
            }
        }
        return md.toString();
    }

    /** 递归输出 Markdown 列表行；已输出节点跳过，防止环死循环。 */
    private void appendMarkdown(StringBuilder md, JsonNode nodes, Map<String, List<String>> children,
                                String id, Set<String> appended, int depth) {
        if (!appended.add(id) || !nodes.has(id)) {
            return;
        }
        JsonNode node = nodes.get(id);
        String indent = "  ".repeat(depth);
        md.append(indent).append("- ").append(node.path("text").asText(""));
        JsonNode tags = node.path("tags");
        if (tags.isArray()) {
            for (JsonNode tag : tags) {
                if (tag.isTextual() && !tag.textValue().isBlank()) {
                    md.append(" #").append(tag.textValue().trim());
                }
            }
        }
        md.append("\n");
        String note = node.path("note").asText(null);
        if (note != null && !note.isBlank()) {
            String ni = "  ".repeat(depth + 1);
            for (String line : note.split("\n", -1)) {
                md.append(ni).append("> ").append(line).append("\n");
            }
        }
        for (String kid : children.getOrDefault(id, List.of())) {
            appendMarkdown(md, nodes, children, kid, appended, depth + 1);
        }
    }

    /** 由 nodes[].parentId 派生子节点列表（树边不落库；自由边不属于父子关系，不进入）。 */
    private Map<String, List<String>> buildChildren(JsonNode nodes) {
        Map<String, List<String>> children = new LinkedHashMap<>();
        for (var it = nodes.fields(); it.hasNext(); ) {
            Map.Entry<String, JsonNode> e = it.next();
            String parent = textOrNull(e.getValue().path("parentId"));
            if (parent != null && nodes.has(parent)) {
                children.computeIfAbsent(parent, k -> new ArrayList<>()).add(e.getKey());
            }
        }
        return children;
    }

    /** 根优先取 content.rootNodeId，缺失或无效时回退首个无有效父的节点。 */
    private String resolveRoot(JsonNode content, JsonNode nodes, Map<String, List<String>> children) {
        String rootId = content.path("rootNodeId").asText(null);
        if (rootId == null || !nodes.has(rootId)) {
            rootId = findFirstOrphanRoot(nodes, children);
        }
        return rootId;
    }

    /** 递归输出 outline；已输出节点跳过，防止环死循环。OPML 2.0：text 必填、_note 为备注、category 存节点标签。 */
    private void appendOutline(StringBuilder xml, JsonNode nodes, Map<String, List<String>> children,
                               String id, Set<String> appended, String indent) {
        if (!appended.add(id) || !nodes.has(id)) {
            return;
        }
        JsonNode node = nodes.get(id);
        xml.append(indent).append("<outline text=\"").append(escapeXml(node.path("text").asText(""))).append('"');
        String note = node.path("note").asText(null);
        if (note != null && !note.isBlank()) {
            xml.append(" _note=\"").append(escapeXml(note)).append('"');
        }
        JsonNode tags = node.path("tags");
        if (tags.isArray() && !tags.isEmpty()) {
            List<String> names = new ArrayList<>();
            for (JsonNode tag : tags) {
                if (tag.isTextual() && !tag.textValue().isBlank()) {
                    names.add(tag.textValue().trim());
                }
            }
            if (!names.isEmpty()) {
                xml.append(" category=\"").append(escapeXml(String.join(",", names))).append('"');
            }
        }

        List<String> kids = children.getOrDefault(id, List.of());
        if (kids.isEmpty()) {
            xml.append("/>\n");
            return;
        }
        xml.append(">\n");
        for (String kid : kids) {
            appendOutline(xml, nodes, children, kid, appended, indent + "  ");
        }
        xml.append(indent).append("</outline>\n");
    }

    /** 正常数据 rootNodeId 存在；异常时选第一个无有效父节点的节点作为 OPML 根。 */
    private String findFirstOrphanRoot(JsonNode nodes, Map<String, List<String>> children) {
        Set<String> hasParent = new LinkedHashSet<>();
        for (List<String> list : children.values()) {
            hasParent.addAll(list);
        }
        for (var it = nodes.fields(); it.hasNext(); ) {
            String id = it.next().getKey();
            if (!hasParent.contains(id)) {
                return id;
            }
        }
        return nodes.fieldNames().hasNext() ? nodes.fieldNames().next() : null;
    }

    private JsonNode parseContent(String contentJson) {
        try {
            JsonNode node = MAPPER.readTree(contentJson);
            if (node == null || node.isNull()) {
                throw new BadRequestException("导图内容为空");
            }
            return node;
        } catch (BadRequestException e) {
            throw e;
        } catch (Exception e) {
            throw new BadRequestException("导图内容不是合法 JSON");
        }
    }

    private String textOrNull(JsonNode node) {
        if (node == null || node.isMissingNode() || node.isNull() || node.asText(null) == null || node.asText().isBlank()) {
            return null;
        }
        return node.asText();
    }

    private String escapeXml(String v) {
        return v == null ? "" : v
                .replace("&", "&amp;")
                .replace("<", "&lt;")
                .replace(">", "&gt;")
                .replace("\"", "&quot;")
                .replace("'", "&apos;");
    }
}
