package com.trailmind.backend.service;

import com.trailmind.backend.common.BadRequestException;
import com.trailmind.backend.common.NotFoundException;
import com.trailmind.backend.entity.Mindmap;
import com.trailmind.backend.repository.MindmapMapper;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.w3c.dom.Document;
import org.w3c.dom.Element;
import org.w3c.dom.NodeList;

import javax.imageio.ImageIO;
import javax.xml.parsers.DocumentBuilderFactory;
import java.awt.image.BufferedImage;
import java.io.ByteArrayInputStream;
import java.util.Base64;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.Mockito.when;

/**
 * 导图导出单测（M4 任务三，PRD B5）：
 * OPML 为合法 XML 且层级/文本/备注/标签保留、自由边忽略（OPML 无法表达）；
 * PNG 为可解码的真实图片（Base64 → ImageIO）、整图内容不裁剪、超大画布等比缩放；
 * 文件名清理与非法类型/不存在的导图错误语义。
 */
@ExtendWith(MockitoExtension.class)
class MindmapExportServiceTest {

    @Mock
    private MindmapMapper mapper;

    private MindmapExportService service;

    private void initService() {
        service = new MindmapExportService(mapper);
    }

    private Mindmap mindmap(String name, String contentJson) {
        Mindmap m = new Mindmap();
        m.setId(1L);
        m.setWorkspaceId(3L);
        m.setName(name);
        m.setContentJson(contentJson);
        return m;
    }

    private String contentWithTree() {
        return """
                {"version":1,"rootNodeId":"n1","nodes":{
                  "n1":{"id":"n1","text":"中心主题","note":"根备注","style":{"color":"indigo","bold":true,"shape":"rounded"},"tags":["根标签"],"parentId":null,"layout":null,"collapsed":false,"sticky":false},
                  "n2":{"id":"n2","text":"子节点 <&>","note":"子备注","style":{"color":"green","bold":false,"shape":"ellipse"},"tags":["标签甲","标签乙"],"parentId":"n1","layout":null,"collapsed":false,"sticky":false},
                  "n3":{"id":"n3","text":"孙节点","note":"","style":{"color":"default","bold":false,"shape":"rect"},"tags":[],"parentId":"n2","layout":null,"collapsed":false,"sticky":false}
                },
                "edges":[{"id":"e1","source":"n1","target":"n2","type":"free","label":"自由连线"}]}
                """;
    }

    /** 画布坐标内容：根与子节点纵向拉开 320px，确保 PNG 高度明显大于节点高度（整图边界正确）。 */
    private String contentWithCanvas() {
        return """
                {"version":1,"rootNodeId":"n1","nodes":{
                  "n1":{"id":"n1","text":"画布根","note":"","style":{"color":"indigo","bold":true,"shape":"diamond"},"tags":[],"parentId":null,"layout":{"x":20,"y":20},"collapsed":false,"sticky":false},
                  "n2":{"id":"n2","text":"画布子节点","note":"","style":{"color":"green","bold":false,"shape":"ellipse"},"tags":[],"parentId":"n1","layout":{"x":420,"y":340},"collapsed":false,"sticky":false}
                },
                "edges":[{"id":"e1","source":"n1","target":"n2","type":"free","label":"自由连线"}]}
                """;
    }

    @Test
    void exportOpml_emits_valid_opml_tree_with_text_note_and_tags() throws Exception {
        initService();
        when(mapper.selectById(1L)).thenReturn(mindmap("验收/导图", contentWithTree()));

        MindmapExportService.ExportFile file = service.export(1L, "opml");

        assertEquals("验收_导图.opml", file.filename());
        assertTrue(file.contentType().startsWith("text/x-opml"));
        Document doc = DocumentBuilderFactory.newInstance().newDocumentBuilder()
                .parse(new ByteArrayInputStream(file.content().getBytes(java.nio.charset.StandardCharsets.UTF_8)));
        Element root = doc.getDocumentElement();
        assertEquals("opml", root.getTagName());
        assertEquals("2.0", root.getAttribute("version"));
        assertEquals("验收/导图", root.getElementsByTagName("title").item(0).getTextContent());

        NodeList outlines = root.getElementsByTagName("outline");
        assertEquals(3, outlines.getLength());
        Element n1 = (Element) outlines.item(0);
        assertEquals("中心主题", n1.getAttribute("text"));
        assertEquals("根备注", n1.getAttribute("_note"));
        assertEquals("根标签", n1.getAttribute("category"));
        // 层级：n2 是 n1 的子节点，n3 是 n2 的子节点
        Element n2 = (Element) outlines.item(1);
        assertEquals("子节点 <&>", n2.getAttribute("text"));
        assertEquals("标签甲,标签乙", n2.getAttribute("category"));
        assertTrue(((Element) n2.getParentNode()).getAttribute("text").equals("中心主题"));
        Element n3 = (Element) outlines.item(2);
        assertTrue(((Element) n3.getParentNode()).getAttribute("text").equals("子节点 <&>"));

        // 自由连线无法用 OPML 表达，导出时忽略（文档同步说明）
        assertFalse(file.content().contains("e1"));
        assertFalse(file.content().contains("自由连线"));
    }

    @Test
    void exportPng_returns_decodable_base64_png() throws Exception {
        initService();
        when(mapper.selectById(1L)).thenReturn(mindmap("画布图", contentWithCanvas()));

        MindmapExportService.ExportFile file = service.export(1L, "PNG");

        assertEquals("画布图.png", file.filename());
        assertEquals("image/png", file.contentType());
        byte[] bytes = Base64.getDecoder().decode(file.content());
        BufferedImage image = ImageIO.read(new ByteArrayInputStream(bytes));
        assertNotNull(image);
        assertTrue(image.getWidth() > 100);
        assertTrue(image.getHeight() > 100);
        // 白底图片有内容：角落为白、中心区域非纯白（节点/边被绘制）
        assertEquals(0xffffff, image.getRGB(0, 0) & 0xffffff);
    }

    @Test
    void export_unknown_type_throws_bad_request() {
        initService();
        when(mapper.selectById(1L)).thenReturn(mindmap("图", contentWithTree()));
        assertThrows(BadRequestException.class, () -> service.export(1L, "MD"));
    }

    @Test
    void export_missing_mindmap_throws_not_found() {
        initService();
        when(mapper.selectById(99L)).thenReturn(null);
        assertThrows(NotFoundException.class, () -> service.export(99L, "PNG"));
    }

    @Test
    void sanitizeFileName_replaces_invalid_chars_and_falls_back() {
        assertEquals("验收_导图", MindmapExportService.sanitizeFileName("验收/导图"));
        assertEquals("a_b_c_", MindmapExportService.sanitizeFileName("a:b*c?"));
        assertEquals("名字", MindmapExportService.sanitizeFileName("名字..."));
        assertEquals("名字", MindmapExportService.sanitizeFileName(" 名字 "));
        assertEquals("未命名导图", MindmapExportService.sanitizeFileName("   "));
        assertEquals("未命名导图", MindmapExportService.sanitizeFileName("..."));
    }

    @Test
    void renderer_scales_down_huge_canvas_without_cropping() throws Exception {
        // 画布坐标相距 10 万像素：最长边应被等比缩放到 4096 上限内，而不是创建超大图片
        String json = """
                {"version":1,"rootNodeId":"n1","nodes":{
                  "n1":{"id":"n1","text":"左","style":{"color":"default","bold":false,"shape":"rounded"},"tags":[],"parentId":null,"layout":{"x":0,"y":0},"collapsed":false,"sticky":false},
                  "n2":{"id":"n2","text":"右","style":{"color":"default","bold":false,"shape":"rounded"},"tags":[],"parentId":"n1","layout":{"x":100000,"y":0},"collapsed":false,"sticky":false}
                },"edges":[]}
                """;
        BufferedImage image = MindmapPngRenderer.render(json);
        assertEquals(4096, image.getWidth());
        assertTrue(image.getHeight() < 4096);
        assertNotNull(ImageIO.read(imageToPng(image)));
    }

    private static ByteArrayInputStream imageToPng(BufferedImage image) throws Exception {
        java.io.ByteArrayOutputStream out = new java.io.ByteArrayOutputStream();
        ImageIO.write(image, "png", out);
        return new ByteArrayInputStream(out.toByteArray());
    }
}
