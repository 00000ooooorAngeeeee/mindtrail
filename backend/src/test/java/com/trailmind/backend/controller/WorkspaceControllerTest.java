package com.trailmind.backend.controller;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.trailmind.backend.entity.Workspace;
import com.trailmind.backend.repository.WorkspaceMapper;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.web.servlet.MockMvc;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * 真实 MySQL 冒烟：CRUD 全链路往返 + 级联删除。需本机 MySQL 可用（DB_PASS 环境变量注入，与 application.yml 一致）。
 */
@SpringBootTest
@AutoConfigureMockMvc
class WorkspaceControllerTest {

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private WorkspaceMapper mapper;

    @Autowired
    private JdbcTemplate jdbc;

    @Test
    void create_and_list_roundtrip() throws Exception {
        String name = "smoke-" + System.currentTimeMillis();

        mockMvc.perform(post("/api/v1/workspaces")
                        .contentType("application/json")
                        .content("{\"name\":\"" + name + "\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(0))
                .andExpect(jsonPath("$.data.id").isNumber())
                .andExpect(jsonPath("$.data.name").value(name));

        mockMvc.perform(get("/api/v1/workspaces"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(0))
                .andExpect(jsonPath("$.data[?(@.name == '" + name + "')]").isNotEmpty());

        mapper.delete(new LambdaQueryWrapper<Workspace>().eq(Workspace::getName, name));
    }

    @Test
    void create_blank_name_returns_error() throws Exception {
        mockMvc.perform(post("/api/v1/workspaces")
                        .contentType("application/json")
                        .content("{\"name\":\"\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(400))
                .andExpect(jsonPath("$.message").isNotEmpty());
    }

    @Test
    void get_and_update_roundtrip() throws Exception {
        long id = createWorkspace("smoke-update-" + System.currentTimeMillis());

        mockMvc.perform(get("/api/v1/workspaces/" + id))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(0))
                .andExpect(jsonPath("$.data.id").value(id));

        mockMvc.perform(put("/api/v1/workspaces/" + id)
                        .contentType("application/json")
                        .content("{\"name\":\"改名后\",\"description\":\"新描述\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(0))
                .andExpect(jsonPath("$.data.name").value("改名后"))
                .andExpect(jsonPath("$.data.description").value("新描述"))
                // BUG#1：重命名响应须带计数（selectWithCounts），不再为 null 致前端列表项「导图 0 · 会话 0」。
                .andExpect(jsonPath("$.data.mindmapCount").value(0))
                .andExpect(jsonPath("$.data.sessionCount").value(0));

        mapper.deleteById(id);
    }

    @Test
    void get_and_update_not_found_returns_404() throws Exception {
        mockMvc.perform(get("/api/v1/workspaces/999999"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(404));

        mockMvc.perform(put("/api/v1/workspaces/999999")
                        .contentType("application/json")
                        .content("{\"name\":\"x\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(404));
    }

    @Test
    void delete_cascades_children() throws Exception {
        long wid = createWorkspace("smoke-delete-" + System.currentTimeMillis());
        seedChildren(wid);
        long sid = jdbc.queryForObject("SELECT id FROM session WHERE workspace_id = ?", Long.class, wid);
        long eid = jdbc.queryForObject("SELECT id FROM entry WHERE session_id = ?", Long.class, sid);
        long tid = jdbc.queryForObject("SELECT id FROM tag WHERE workspace_id = ?", Long.class, wid);

        mockMvc.perform(delete("/api/v1/workspaces/" + wid))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(0));

        // 级联：工作区及其导图/会话/条目/标签/关联表全部清空
        assertThat(count("workspace", "id", wid)).isZero();
        assertThat(count("mindmap", "workspace_id", wid)).isZero();
        assertThat(count("session", "workspace_id", wid)).isZero();
        assertThat(count("tag", "workspace_id", wid)).isZero();
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM entry WHERE session_id = ?", Long.class, sid)).isZero();
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM entry_tag WHERE entry_id = ?", Long.class, eid)).isZero();
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM entry_commit WHERE entry_id = ?", Long.class, eid)).isZero();
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM entry WHERE id = ?", Long.class, eid)).isZero();
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM tag WHERE id = ?", Long.class, tid)).isZero();
    }

    @Test
    void delete_not_found_returns_404() throws Exception {
        mockMvc.perform(delete("/api/v1/workspaces/999999"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(404));
    }

    /** 经 API 创建并返回自增 id。 */
    private long createWorkspace(String name) throws Exception {
        mockMvc.perform(post("/api/v1/workspaces")
                        .contentType("application/json")
                        .content("{\"name\":\"" + name + "\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(0));
        return mapper.selectOne(new LambdaQueryWrapper<Workspace>().eq(Workspace::getName, name)).getId();
    }

    /** 插入一张导图 + 一个会话 + 一条条目 + 一个标签及关联，用于级联删除验证。 */
    private void seedChildren(long wid) {
        jdbc.update("INSERT INTO mindmap(workspace_id, name, content_json, search_text, node_count) VALUES (?,?,?,?,?)",
                wid, "导图", "{}", "导图", 1);
        jdbc.update("INSERT INTO session(workspace_id, title, status) VALUES (?,?,?)", wid, "会话", "active");
        long sid = jdbc.queryForObject("SELECT id FROM session WHERE workspace_id = ?", Long.class, wid);
        jdbc.update("INSERT INTO entry(session_id, seq, type, content_md) VALUES (?,?,?,?)", sid, 1, "action", "正文");
        long eid = jdbc.queryForObject("SELECT id FROM entry WHERE session_id = ?", Long.class, sid);
        jdbc.update("INSERT INTO tag(workspace_id, name) VALUES (?,?)", wid, "标签");
        long tid = jdbc.queryForObject("SELECT id FROM tag WHERE workspace_id = ?", Long.class, wid);
        jdbc.update("INSERT INTO entry_tag(entry_id, tag_id) VALUES (?,?)", eid, tid);
        jdbc.update("INSERT INTO entry_commit(entry_id, commit_hash, repo_path) VALUES (?,?,?)", eid, "a".repeat(40), "D:/repo");
    }

    private long count(String table, String idColumn, long id) {
        return jdbc.queryForObject("SELECT COUNT(*) FROM " + table + " WHERE " + idColumn + " = ?", Long.class, id);
    }
}
