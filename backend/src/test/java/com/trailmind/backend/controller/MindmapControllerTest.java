package com.trailmind.backend.controller;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.trailmind.backend.entity.Mindmap;
import com.trailmind.backend.entity.Workspace;
import com.trailmind.backend.repository.MindmapMapper;
import com.trailmind.backend.repository.WorkspaceMapper;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;

import java.util.LinkedHashMap;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * 真实 MySQL 冒烟：导图 CRUD 全链路 + content_json 存取 + search_text/node_count 维护 + 乐观锁。需本机 MySQL（DB_PASS 注入）。
 */
@SpringBootTest
@AutoConfigureMockMvc
class MindmapControllerTest {

    private static final ObjectMapper JSON = new ObjectMapper();

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private WorkspaceMapper workspaceMapper;

    @Autowired
    private MindmapMapper mindmapMapper;

    @Autowired
    private JdbcTemplate jdbc;

    @Test
    void create_list_get_roundtrip() throws Exception {
        long wid = createWorkspace(uniq("mm-list"));
        String name = uniq("导图");

        // 创建：默认单根节点「中心主题」
        mockMvc.perform(post("/api/v1/workspaces/" + wid + "/mindmaps")
                        .contentType("application/json")
                        .content("{\"name\":\"" + name + "\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(0))
                .andExpect(jsonPath("$.data.id").isNumber())
                .andExpect(jsonPath("$.data.nodeCount").value(1));

        long mid = mindmapMapper.selectOne(new LambdaQueryWrapper<Mindmap>().eq(Mindmap::getName, name)).getId();

        // 列表：摘要（含节点数，不含 content_json）
        mockMvc.perform(get("/api/v1/workspaces/" + wid + "/mindmaps"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(0))
                .andExpect(jsonPath("$.data[?(@.id == " + mid + ")]").isNotEmpty());

        // 详情：整图含 contentJson
        mockMvc.perform(get("/api/v1/mindmaps/" + mid))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(0))
                .andExpect(jsonPath("$.data.contentJson").isNotEmpty())
                .andExpect(jsonPath("$.data.nodeCount").value(1));

        cleanup(mid, wid);
    }

    @Test
    void save_updates_content_search_text_and_node_count() throws Exception {
        long wid = createWorkspace(uniq("mm-save"));
        long mid = createMindmap(wid, "导图A");

        String content = "{\"version\":1,\"rootNodeId\":\"n1\"," +
                "\"nodes\":{\"n1\":{\"text\":\"根\"},\"n2\":{\"text\":\"子\",\"tags\":[\"标签\"]}}," +
                "\"edges\":[{\"id\":\"e1\",\"source\":\"n1\",\"target\":\"n2\",\"label\":\"边\"}]}";
        String body = JSON.writeValueAsString(Map.of("contentJson", content));

        mockMvc.perform(put("/api/v1/mindmaps/" + mid)
                        .contentType("application/json")
                        .content(body))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(0))
                .andExpect(jsonPath("$.data.nodeCount").value(2));

        Mindmap m = mindmapMapper.selectById(mid);
        assertThat(m.getNodeCount()).isEqualTo(2);
        assertThat(m.getSearchText()).contains("导图A", "根", "子", "标签", "边");

        cleanup(mid, wid);
    }

    @Test
    void save_conflict_returns_409() throws Exception {
        long wid = createWorkspace(uniq("mm-conflict"));
        long mid = createMindmap(wid, "导图B");

        Map<String, Object> req = new LinkedHashMap<>();
        req.put("contentJson", "{\"version\":1,\"nodes\":{},\"edges\":[]}");
        req.put("updatedAt", "2000-01-01T00:00:00");

        mockMvc.perform(put("/api/v1/mindmaps/" + mid)
                        .contentType("application/json")
                        .content(JSON.writeValueAsString(req)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(409));

        cleanup(mid, wid);
    }

    @Test
    void save_with_matching_updatedAt_succeeds() throws Exception {
        long wid = createWorkspace(uniq("mm-lock"));
        long mid = createMindmap(wid, "导图锁");

        MvcResult r = mockMvc.perform(get("/api/v1/mindmaps/" + mid))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(0))
                .andReturn();
        String updatedAt = JSON.readTree(r.getResponse().getContentAsString())
                .path("data").path("updatedAt").asText();

        String content = "{\"version\":1,\"nodes\":{\"n1\":{\"text\":\"改\"}},\"edges\":[]}";
        Map<String, Object> req = new LinkedHashMap<>();
        req.put("contentJson", content);
        req.put("updatedAt", updatedAt);

        mockMvc.perform(put("/api/v1/mindmaps/" + mid)
                        .contentType("application/json")
                        .content(JSON.writeValueAsString(req)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(0))
                .andExpect(jsonPath("$.data.nodeCount").value(1));

        cleanup(mid, wid);
    }

    @Test
    void create_blank_name_returns_400() throws Exception {
        long wid = createWorkspace(uniq("mm-blank"));
        mockMvc.perform(post("/api/v1/workspaces/" + wid + "/mindmaps")
                        .contentType("application/json")
                        .content("{\"name\":\"\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(400));
        jdbc.update("DELETE FROM workspace WHERE id = ?", wid);
    }

    @Test
    void get_and_save_not_found_return_404() throws Exception {
        mockMvc.perform(get("/api/v1/mindmaps/999999"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(404));

        mockMvc.perform(put("/api/v1/mindmaps/999999")
                        .contentType("application/json")
                        .content("{\"contentJson\":\"{}\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(404));
    }

    @Test
    void delete_removes_mindmap() throws Exception {
        long wid = createWorkspace(uniq("mm-del"));
        long mid = createMindmap(wid, "导图C");

        mockMvc.perform(delete("/api/v1/mindmaps/" + mid))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(0));

        assertThat(mindmapMapper.selectById(mid)).isNull();
        jdbc.update("DELETE FROM workspace WHERE id = ?", wid);
    }

    private String uniq(String prefix) {
        return prefix + "-" + System.currentTimeMillis();
    }

    private long createWorkspace(String name) {
        Workspace w = new Workspace();
        w.setName(name);
        workspaceMapper.insert(w);
        return w.getId();
    }

    private long createMindmap(long wid, String name) {
        Mindmap m = new Mindmap();
        m.setWorkspaceId(wid);
        m.setName(name);
        m.setContentJson("{\"version\":1,\"nodes\":{\"n1\":{\"text\":\"根\"}},\"edges\":[]}");
        m.setSearchText(name + " 根");
        m.setNodeCount(1);
        mindmapMapper.insert(m);
        return m.getId();
    }

    private void cleanup(long mid, long wid) {
        jdbc.update("DELETE FROM mindmap WHERE id = ?", mid);
        jdbc.update("DELETE FROM workspace WHERE id = ?", wid);
    }
}
