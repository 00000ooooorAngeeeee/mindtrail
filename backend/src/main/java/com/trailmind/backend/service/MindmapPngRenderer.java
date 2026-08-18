package com.trailmind.backend.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.trailmind.backend.common.BadRequestException;

import javax.imageio.ImageIO;
import java.awt.BasicStroke;
import java.awt.Color;
import java.awt.Font;
import java.awt.FontMetrics;
import java.awt.Graphics2D;
import java.awt.Polygon;
import java.awt.RenderingHints;
import java.awt.geom.AffineTransform;
import java.awt.geom.Point2D;
import java.awt.geom.Rectangle2D;
import java.awt.image.BufferedImage;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.util.ArrayList;
import java.util.Base64;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * 导图 PNG 整图渲染器（M4 任务三，PRD B5「PNG 整图」）：
 * 无第三方依赖，Java2D 绘制全部节点/父链边/自由边。坐标规则与前端一致（04 §6.4 / 05 §4）：
 * nodes[].layout 有坐标则用画布坐标，无坐标用自研右向树布局兜底（算法与前端 treeLayout.ts 同构：递归槽位 × 层/行间距）。
 * 折叠状态在导出时忽略（保证「整图」完整）；超宽/超高导图按比例缩放至最长边 4096px，内容不裁剪。
 */
public final class MindmapPngRenderer {

    /** PNG 最长边上限（像素）：防极端导图（2000 节点长链/大坐标画布）撑爆内存，超出整体等比缩放。 */
    static final int MAX_IMAGE_SIDE = 4096;
    private static final int MARGIN = 24;
    private static final int LEVEL_GAP = 200;
    private static final int ROW_GAP = 64;
    private static final int MAX_TEXT_WIDTH = 260;
    private static final int MAX_TEXT_LINES = 6;
    private static final int PAD_X = 14;
    private static final int PAD_Y = 10;
    private static final int MIN_NODE_W = 88;
    private static final int MIN_NODE_H = 36;

    private static final ObjectMapper MAPPER = new ObjectMapper();
    private static final Color BACKGROUND = Color.WHITE;
    private static final Color TEXT_COLOR = new Color(0x1f, 0x23, 0x29);
    private static final Color TREE_EDGE = new Color(0xc3, 0xc8, 0xd4);
    private static final Color FREE_EDGE = new Color(0x4f, 0x6b, 0xff);

    private static final Map<String, Color[]> COLORS = Map.ofEntries(
            Map.entry("default", colors("#ffffff", "#d9dbe2")),
            Map.entry("indigo", colors("#eef1ff", "#4f6bff")),
            Map.entry("green", colors("#eafaf1", "#2e9e5b")),
            Map.entry("amber", colors("#fff7e6", "#e0a100")),
            Map.entry("red", colors("#fdecec", "#d64545")),
            Map.entry("purple", colors("#f3edff", "#7c4dff")),
            Map.entry("cyan", colors("#e6f7fb", "#0aa0b8")),
            Map.entry("pink", colors("#fdeef5", "#e0558f")));

    private MindmapPngRenderer() {
    }

    /** 渲染 content_json 为 BufferedImage（最长边 ≤ MAX_IMAGE_SIDE，白底）。JSON 非法/节点为空抛 BadRequestException。 */
    public static BufferedImage render(String contentJson) {
        JsonNode content = parse(contentJson);
        JsonNode nodesNode = content.path("nodes");
        if (!nodesNode.isObject() || nodesNode.isEmpty()) {
            throw new BadRequestException("导图内容为空，无法导出 PNG");
        }

        Map<String, NodeBox> boxes = measureNodes(nodesNode);
        Map<String, List<String>> children = buildChildren(nodesNode);
        Map<String, Point2D.Double> positions = layout(nodesNode, content.path("rootNodeId").asText(null), children);

        double minX = Double.MAX_VALUE;
        double minY = Double.MAX_VALUE;
        double maxX = -Double.MAX_VALUE;
        double maxY = -Double.MAX_VALUE;
        for (Map.Entry<String, NodeBox> e : boxes.entrySet()) {
            Point2D.Double p = positions.get(e.getKey());
            if (p == null) {
                continue;
            }
            e.getValue().setLocation(p.x, p.y);
            minX = Math.min(minX, p.x);
            minY = Math.min(minY, p.y);
            maxX = Math.max(maxX, p.x + e.getValue().getWidth());
            maxY = Math.max(maxY, p.y + e.getValue().getHeight());
        }
        // 自由边端点也计入边界（画布坐标可能远离节点中心，但边端点就是节点，理论上已覆盖；防御性保留）
        JsonNode edges = content.path("edges");
        if (edges.isArray()) {
            for (JsonNode edge : edges) {
                for (String side : new String[]{"source", "target"}) {
                    Point2D.Double p = positions.get(edge.path(side).asText(null));
                    if (p != null) {
                        minX = Math.min(minX, p.x);
                        minY = Math.min(minY, p.y);
                        maxX = Math.max(maxX, p.x);
                        maxY = Math.max(maxY, p.y);
                    }
                }
            }
        }
        if (maxX <= minX || maxY <= minY) {
            // 正常数据不会走到；保底 1×1 图会令 ImageIO 正常输出但无意义，给 400 更明确
            throw new BadRequestException("导图节点无有效坐标，无法导出 PNG");
        }

        double width = maxX - minX + MARGIN * 2;
        double height = maxY - minY + MARGIN * 2;
        double scale = Math.min(1.0, MAX_IMAGE_SIDE / Math.max(width, height));
        int imageW = Math.max(1, (int) Math.ceil(width * scale));
        int imageH = Math.max(1, (int) Math.ceil(height * scale));

        BufferedImage image = new BufferedImage(imageW, imageH, BufferedImage.TYPE_INT_RGB);
        Graphics2D g = image.createGraphics();
        try {
            g.setRenderingHint(RenderingHints.KEY_ANTIALIASING, RenderingHints.VALUE_ANTIALIAS_ON);
            g.setRenderingHint(RenderingHints.KEY_TEXT_ANTIALIASING, RenderingHints.VALUE_TEXT_ANTIALIAS_ON);
            g.setColor(BACKGROUND);
            g.fillRect(0, 0, imageW, imageH);
            // 先缩放再平移：全部几何/字号随内容一起等比缩放，导出内容完整不裁剪
            g.scale(scale, scale);
            g.translate(MARGIN - minX, MARGIN - minY);

            drawParentEdges(g, nodesNode, positions, boxes, children);
            drawFreeEdges(g, edges, positions, boxes);
            for (Map.Entry<String, NodeBox> e : boxes.entrySet()) {
                if (positions.containsKey(e.getKey())) {
                    drawNode(g, nodesNode.get(e.getKey()), e.getValue());
                }
            }
        } finally {
            g.dispose();
        }
        return image;
    }

    /** 编码为 PNG Base64（前端解码后下载，保持统一 JSON 响应）。 */
    public static String encode(String contentJson) {
        BufferedImage image = render(contentJson);
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        try {
            ImageIO.write(image, "png", out);
        } catch (IOException e) {
            throw new IllegalStateException("PNG 编码失败", e);
        }
        return Base64.getEncoder().encodeToString(out.toByteArray());
    }

    // ---- 节点度量（文本换行 + 形状盒尺寸） ----

    private static Map<String, NodeBox> measureNodes(JsonNode nodesNode) {
        Map<String, NodeBox> boxes = new LinkedHashMap<>();
        BufferedImage probe = new BufferedImage(1, 1, BufferedImage.TYPE_INT_RGB);
        Graphics2D g = probe.createGraphics();
        try {
            for (var it = nodesNode.fields(); it.hasNext(); ) {
                Map.Entry<String, JsonNode> e = it.next();
                JsonNode node = e.getValue();
                boolean bold = node.path("style").path("bold").asBoolean(false);
                boolean root = node.path("parentId").isNull();
                Font font = new Font("Microsoft YaHei", bold ? Font.BOLD : Font.PLAIN, root ? 16 : 13);
                FontMetrics fm = g.getFontMetrics(font);

                String text = node.path("text").asText("");
                if (text.isBlank()) {
                    // 自由便签（text 空）显示 note 备注；两者皆空保留空便签盒
                    text = node.path("note").asText("");
                }
                List<String> lines = wrap(text, fm, MAX_TEXT_WIDTH, MAX_TEXT_LINES);
                double textW = 0;
                for (String line : lines) {
                    textW = Math.max(textW, fm.stringWidth(line));
                }
                int width = Math.max(MIN_NODE_W, (int) Math.ceil(textW + PAD_X * 2));
                int lineHeight = fm.getHeight() + 2;
                int height = Math.max(MIN_NODE_H, (int) Math.ceil(lines.size() * lineHeight + PAD_Y * 2));
                NodeBox box = new NodeBox(width, height, lines, font, lineHeight);
                box.color = colorOf(node.path("style").path("color").asText("default"));
                box.shape = node.path("style").path("shape").asText("rounded");
                boxes.put(e.getKey(), box);
            }
        } finally {
            g.dispose();
        }
        return boxes;
    }

    private static List<String> wrap(String text, FontMetrics fm, int maxWidth, int maxLines) {
        List<String> out = new ArrayList<>();
        if (text == null || text.isBlank()) {
            return out;
        }
        for (String segment : text.split("\\n", -1)) {
            StringBuilder line = new StringBuilder();
            double width = 0;
            int i = 0;
            while (i < segment.length()) {
                int cp = segment.codePointAt(i);
                String ch = new String(Character.toChars(cp));
                i += Character.charCount(cp);
                double w = fm.stringWidth(ch);
                if (line.length() > 0 && width + w > maxWidth) {
                    out.add(line.toString());
                    line = new StringBuilder();
                    width = 0;
                    if (out.size() == maxLines) {
                        return out;
                    }
                }
                line.append(ch);
                width += w;
            }
            out.add(line.toString());
            if (out.size() >= maxLines) {
                return out;
            }
        }
        return out;
    }

    // ---- 布局（与前端 treeLayout.ts 同构：槽位索引 × ROW_GAP；折叠忽略保证整图完整） ----

    private static Map<String, Point2D.Double> layout(JsonNode nodesNode, String rootNodeId,
                                                      Map<String, List<String>> children) {
        Map<String, Point2D.Double> tree = new LinkedHashMap<>();
        Map<String, Double> slots = new LinkedHashMap<>();
        Set<String> visited = new LinkedHashSet<>();
        double[] nextLeaf = {0};

        String root = rootNodeId;
        if (root == null || !nodesNode.has(root)) {
            root = findFirstNode(nodesNode);
        }
        if (root != null) {
            place(root, 0, nodesNode, children, tree, slots, visited, nextLeaf);
        }
        // 兜底：父链断裂/成环等异常节点排到主树下方
        for (var it = nodesNode.fields(); it.hasNext(); ) {
            String id = it.next().getKey();
            if (!visited.contains(id)) {
                tree.put(id, new Point2D.Double(0, nextLeaf[0]++ * ROW_GAP));
            }
        }

        // 画布坐标优先（PRD B2.1：layout 持久化为用户摆放成果），缺坐标节点用树布局兜底
        Map<String, Point2D.Double> out = new LinkedHashMap<>();
        for (var it = nodesNode.fields(); it.hasNext(); ) {
            Map.Entry<String, JsonNode> e = it.next();
            JsonNode layoutNode = e.getValue().path("layout");
            if (layoutNode.isObject() && layoutNode.hasNonNull("x") && layoutNode.hasNonNull("y")) {
                out.put(e.getKey(), new Point2D.Double(layoutNode.path("x").asDouble(), layoutNode.path("y").asDouble()));
            } else {
                Point2D.Double p = tree.get(e.getKey());
                if (p != null) {
                    out.put(e.getKey(), p);
                }
            }
        }
        return out;
    }

    private static void place(String id, int depth, JsonNode nodesNode, Map<String, List<String>> children,
                              Map<String, Point2D.Double> positions, Map<String, Double> slots,
                              Set<String> visited, double[] nextLeaf) {
        if (!visited.add(id) || !nodesNode.has(id)) {
            return;
        }
        List<String> kids = children.getOrDefault(id, List.of());
        double slot;
        if (kids.isEmpty()) {
            slot = nextLeaf[0]++;
        } else {
            double sum = 0;
            for (String kid : kids) {
                place(kid, depth + 1, nodesNode, children, positions, slots, visited, nextLeaf);
                sum += slots.get(kid);
            }
            slot = sum / kids.size();
        }
        slots.put(id, slot);
        positions.put(id, new Point2D.Double(depth * LEVEL_GAP, slot * ROW_GAP));
    }

    private static String findFirstNode(JsonNode nodesNode) {
        var it = nodesNode.fieldNames();
        return it.hasNext() ? it.next() : null;
    }

    private static Map<String, List<String>> buildChildren(JsonNode nodesNode) {
        Map<String, List<String>> children = new LinkedHashMap<>();
        for (var it = nodesNode.fields(); it.hasNext(); ) {
            Map.Entry<String, JsonNode> e = it.next();
            String parent = e.getValue().path("parentId").asText(null);
            if (parent != null && nodesNode.has(parent)) {
                children.computeIfAbsent(parent, k -> new ArrayList<>()).add(e.getKey());
            }
        }
        return children;
    }

    // ---- 绘制 ----

    private static void drawParentEdges(Graphics2D g, JsonNode nodesNode, Map<String, Point2D.Double> positions,
                                        Map<String, NodeBox> boxes, Map<String, List<String>> children) {
        g.setColor(TREE_EDGE);
        g.setStroke(new BasicStroke(2f, BasicStroke.CAP_ROUND, BasicStroke.JOIN_ROUND));
        for (Map.Entry<String, List<String>> e : children.entrySet()) {
            Point2D.Double from = positions.get(e.getKey());
            if (from == null) {
                continue;
            }
            for (String kid : e.getValue()) {
                Point2D.Double to = positions.get(kid);
                NodeBox parent = boxes.get(e.getKey());
                NodeBox child = boxes.get(kid);
                if (to == null || parent == null || child == null) {
                    continue;
                }
                Point2D.Double a = edgePoint(parent.bounds(), center(to, child));
                Point2D.Double b = edgePoint(child.bounds(), center(from, parent));
                drawCurve(g, a, b);
            }
        }
    }

    private static void drawFreeEdges(Graphics2D g, JsonNode edges, Map<String, Point2D.Double> positions,
                                      Map<String, NodeBox> boxes) {
        if (edges == null || !edges.isArray()) {
            return;
        }
        g.setColor(FREE_EDGE);
        g.setStroke(new BasicStroke(1.6f, BasicStroke.CAP_ROUND, BasicStroke.JOIN_ROUND,
                10f, new float[]{8f, 6f}, 0f));
        for (JsonNode edge : edges) {
            Point2D.Double from = positions.get(edge.path("source").asText(null));
            Point2D.Double to = positions.get(edge.path("target").asText(null));
            NodeBox source = boxes.get(edge.path("source").asText(null));
            NodeBox target = boxes.get(edge.path("target").asText(null));
            if (from == null || to == null || source == null || target == null) {
                continue;
            }
            Point2D.Double a = edgePoint(source.bounds(), center(to, target));
            Point2D.Double b = edgePoint(target.bounds(), center(from, source));
            drawCurve(g, a, b);
            drawArrowHead(g, a, b);
            String label = edge.path("label").asText(null);
            if (label != null && !label.isBlank()) {
                drawEdgeLabel(g, a, b, label);
            }
        }
    }

    /** 自由边标签（PRD B2.2 P1「可编辑标签」，05 §4 edges[].label）：绘制于贝塞尔中点（t=0.5）的纯文字。
     *  与前端同构（缺陷修复：原白底胶囊与胶囊标签易混淆，改纯文字 + 四向偏移白字模拟文字描边保证跨线可读）。 */
    private static void drawEdgeLabel(Graphics2D g, Point2D.Double a, Point2D.Double b, String label) {
        double dx = Math.max(40, Math.abs(b.x - a.x) * 0.5);
        // 三次贝塞尔 t=0.5 公式：B(0.5) = (P0 + 3P1 + 3P2 + P3) / 8；P1/P2 与 drawCurve 同构
        double mx = (a.x + 3 * (a.x + dx) + 3 * (b.x - dx) + b.x) / 8;
        double my = (a.y + 3 * a.y + 3 * b.y + b.y) / 8;

        Font old = g.getFont();
        g.setFont(old.deriveFont(11f));
        FontMetrics fm = g.getFontMetrics();
        int textX = (int) Math.round(mx - fm.stringWidth(label) / 2.0);
        int textY = (int) Math.round(my + fm.getAscent() / 2.0 - 1);
        // 文字描边：±1px 八向白字（与前端 text-shadow 同效），主体文字最后绘制
        g.setColor(Color.WHITE);
        for (int ox = -1; ox <= 1; ox++) {
            for (int oy = -1; oy <= 1; oy++) {
                g.drawString(label, textX + ox, textY + oy);
            }
        }
        g.setColor(TEXT_COLOR);
        g.drawString(label, textX, textY);
        g.setFont(old);
    }

    private static void drawCurve(Graphics2D g, Point2D.Double a, Point2D.Double b) {
        double dx = Math.max(40, Math.abs(b.x - a.x) * 0.5);
        g.draw(new java.awt.geom.CubicCurve2D.Double(
                a.x, a.y, a.x + dx, a.y, b.x - dx, b.y, b.x, b.y));
    }

    private static void drawArrowHead(Graphics2D g, Point2D.Double a, Point2D.Double b) {
        double angle = Math.atan2(b.y - a.y, b.x - a.x);
        double size = 9;
        double ax = b.x - Math.cos(angle) * size;
        double ay = b.y - Math.sin(angle) * size;
        g.setStroke(new BasicStroke(1.6f));
        int x1 = (int) Math.round(ax);
        int y1 = (int) Math.round(ay);
        int x2 = (int) Math.round(ax + Math.cos(angle + Math.PI * 0.82) * size);
        int y2 = (int) Math.round(ay + Math.sin(angle + Math.PI * 0.82) * size);
        int x3 = (int) Math.round(ax + Math.cos(angle - Math.PI * 0.82) * size);
        int y3 = (int) Math.round(ay + Math.sin(angle - Math.PI * 0.82) * size);
        g.fillPolygon(new int[]{x1, x2, x3}, new int[]{y1, y2, y3}, 3);
    }

    private static void drawNode(Graphics2D g, JsonNode node, NodeBox box) {
        Rectangle2D.Double r = box.bounds();
        Color fill = box.color[0];
        Color border = box.color[1];
        g.setColor(fill);
        switch (box.shape) {
            case "rect" -> g.fillRect((int) r.x, (int) r.y, (int) r.width, (int) r.height);
            case "ellipse" -> g.fillOval((int) r.x, (int) r.y, (int) r.width, (int) r.height);
            case "diamond" -> g.fillPolygon(diamond(r));
            default -> g.fillRoundRect((int) r.x, (int) r.y, (int) r.width, (int) r.height, 12, 12);
        }
        g.setColor(border);
        g.setStroke(new BasicStroke(1.8f));
        switch (box.shape) {
            case "rect" -> g.drawRect((int) r.x, (int) r.y, (int) r.width, (int) r.height);
            case "ellipse" -> g.drawOval((int) r.x, (int) r.y, (int) r.width, (int) r.height);
            case "diamond" -> g.drawPolygon(diamond(r));
            default -> g.drawRoundRect((int) r.x, (int) r.y, (int) r.width, (int) r.height, 12, 12);
        }

        g.setFont(box.font);
        g.setColor(TEXT_COLOR);
        FontMetrics fm = g.getFontMetrics(box.font);
        int textY = (int) (r.y + (r.height - box.lines.size() * box.lineHeight) / 2.0 + fm.getAscent() + 1);
        for (String line : box.lines) {
            int textX = (int) (r.x + (r.width - fm.stringWidth(line)) / 2.0);
            g.drawString(line, textX, textY);
            textY += box.lineHeight;
        }
    }

    private static Polygon diamond(Rectangle2D.Double r) {
        int cx = (int) Math.round(r.getCenterX());
        int cy = (int) Math.round(r.getCenterY());
        return new Polygon(
                new int[]{cx, (int) (r.x + r.width), cx, (int) r.x},
                new int[]{(int) r.y, cy, (int) (r.y + r.height), cy},
                4);
    }

    private static Point2D.Double edgePoint(Rectangle2D.Double box, Point2D.Double toward) {
        double cx = box.getCenterX();
        double cy = box.getCenterY();
        double dx = toward.x - cx;
        double dy = toward.y - cy;
        if (Math.abs(dx) < 1e-9 && Math.abs(dy) < 1e-9) {
            return new Point2D.Double(cx, cy);
        }
        double hw = box.width / 2;
        double hh = box.height / 2;
        double scale = Math.min(Math.abs(hw / dx), Math.abs(hh / dy));
        return new Point2D.Double(cx + dx * scale, cy + dy * scale);
    }

    private static Point2D.Double center(Point2D.Double p, NodeBox box) {
        return new Point2D.Double(p.x + box.width / 2, p.y + box.height / 2);
    }

    private static JsonNode parse(String contentJson) {
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

    private static Color[] colors(String bg, String border) {
        return new Color[]{Color.decode(bg), Color.decode(border)};
    }

    private static Color[] colorOf(String name) {
        return COLORS.getOrDefault(name == null ? "" : name, COLORS.get("default"));
    }

    /** 节点盒：位置/尺寸/换行文本/字体与颜色形状（绘制与度量共享）。 */
    private static final class NodeBox {
        private final int width;
        private final int height;
        private final List<String> lines;
        private final Font font;
        private final int lineHeight;
        private double x;
        private double y;
        private Color[] color;
        private String shape;

        private NodeBox(int width, int height, List<String> lines, Font font, int lineHeight) {
            this.width = width;
            this.height = height;
            this.lines = lines;
            this.font = font;
            this.lineHeight = lineHeight;
        }

        private void setLocation(double x, double y) {
            this.x = x;
            this.y = y;
        }

        private int getWidth() {
            return width;
        }

        private int getHeight() {
            return height;
        }

        private Rectangle2D.Double bounds() {
            return new Rectangle2D.Double(x, y, width, height);
        }
    }
}
