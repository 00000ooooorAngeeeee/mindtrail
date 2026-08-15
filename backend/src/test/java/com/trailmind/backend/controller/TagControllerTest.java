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
 * 标签管理真实 MySQL 全链路往返（M4 任务二验收，07 §7「标签重命名后所有关联条目生效；标签过滤即时」）：
 * 创建（重复 400）→ 条目打标签（即时创建复用）→ 列表计数 → 重命名（条目读回新名 = 全局生效）→
 * 按标签筛（含会话内过滤）→ 合并（条目重挂目标、源删除、自身合并 400）→ 删除（entry_tag 级联清理）。
 */
@SpringBootTest
@AutoConfigureMockMvc
class TagControllerTest {

    private static final String JSON = "application/json";

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private WorkspaceMapper workspaceMapper;

    @Autowired
    private JdbcTemplate jdbc;

    @Test
    void tag_crud_rename_merge_filter_roundtrip() throws Exception {
        String wsName = "smoke-tag-" + System.currentTimeMillis();
        mockMvc.perform(post("/api/v1/workspaces").contentType(JSON).content("{\"name\":\"" + wsName + "\"}"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.code").value(0));
        long wid = workspaceMapper.selectOne(
                new LambdaQueryWrapper<Workspace>().eq(Workspace::getName, wsName)).getId();

        // 创建标签：空白/超长/重复 → 400
        mockMvc.perform(post("/api/v1/tags").contentType(JSON)
                        .content("{\"workspaceId\":" + wid + ",\"name\":\"前端\"}"))
                .andExpect(jsonPath("$.code").value(0)).andExpect(jsonPath("$.data.name").value("前端"));
        mockMvc.perform(post("/api/v1/tags").contentType(JSON)
                        .content("{\"workspaceId\":" + wid + ",\"name\":\"前端\"}"))
                .andExpect(jsonPath("$.code").value(400));
        mockMvc.perform(post("/api/v1/tags").contentType(JSON)
                        .content("{\"workspaceId\":" + wid + ",\"name\":\" \"}"))
                .andExpect(jsonPath("$.code").value(400));
        mockMvc.perform(post("/api/v1/tags").contentType(JSON)
                        .content("{\"workspaceId\":" + wid + ",\"name\":\"后端\"}"))
                .andExpect(jsonPath("$.code").value(0));
        long tagFront = jdbc.queryForObject("SELECT id FROM tag WHERE workspace_id = ? AND name = '前端'", Long.class, wid);
        long tagBack = jdbc.queryForObject("SELECT id FROM tag WHERE workspace_id = ? AND name = '后端'", Long.class, wid);

        // 会话 + 条目打标签（复用 M3 即时创建路径）
        mockMvc.perform(post("/api/v1/workspaces/" + wid + "/sessions").contentType(JSON)
                        .content("{\"title\":\"标签会话\"}"))
                .andExpect(jsonPath("$.code").value(0));
        long sid = jdbc.queryForObject("SELECT id FROM session WHERE workspace_id = ?", Long.class, wid);
        mockMvc.perform(post("/api/v1/sessions/" + sid + "/entries").contentType(JSON)
                        .content("{\"type\":\"action\",\"contentMd\":\"条目一\",\"tags\":[\"前端\",\"后端\"]}"))
                .andExpect(jsonPath("$.code").value(0));
        long eid = jdbc.queryForObject("SELECT id FROM entry WHERE session_id = ?", Long.class, sid);

        // 列表计数：前端 1 条、后端 1 条
        mockMvc.perform(get("/api/v1/tags").param("workspaceId", String.valueOf(wid)))
                .andExpect(jsonPath("$.code").value(0))
                .andExpect(jsonPath("$.data.length()").value(2))
                .andExpect(jsonPath("$.data[?(@.name == '前端')]").isNotEmpty());
        assertThat(jdbc.queryForObject(
                "SELECT COUNT(*) FROM entry_tag et JOIN tag t ON t.id = et.tag_id WHERE t.workspace_id = ? AND t.name = '前端'",
                Long.class, wid)).isEqualTo(1);

        // 重命名：全局生效——条目读回即新名
        mockMvc.perform(put("/api/v1/tags/" + tagFront).contentType(JSON).content("{\"name\":\"前端UI\"}"))
                .andExpect(jsonPath("$.code").value(0)).andExpect(jsonPath("$.data.name").value("前端UI"));
        mockMvc.perform(get("/api/v1/sessions/" + sid))
                .andExpect(jsonPath("$.data.entries[0].tags[?(@ == '前端UI')]").isNotEmpty());

        // 按标签筛：tagId 必传；会话内过滤（条目一同时含两标签 → 各命中 1 条）
        mockMvc.perform(get("/api/v1/entries").param("tagId", String.valueOf(tagBack)).param("sessionId", String.valueOf(sid)))
                .andExpect(jsonPath("$.code").value(0))
                .andExpect(jsonPath("$.data.length()").value(1))
                .andExpect(jsonPath("$.data[0].id").value(eid))
                .andExpect(jsonPath("$.data[0].sessionTitle").value("标签会话"))
                .andExpect(jsonPath("$.data[0].tags[?(@ == '后端')]").isNotEmpty());
        mockMvc.perform(get("/api/v1/entries").param("tagId", String.valueOf(tagBack)))
                .andExpect(jsonPath("$.data.length()").value(1));
        mockMvc.perform(get("/api/v1/entries").param("tagId", "999999"))
                .andExpect(jsonPath("$.code").value(404));

        // 合并：后端合并进前端UI → 源删除、条目标签归入目标、计数更新
        mockMvc.perform(post("/api/v1/tags/" + tagBack + "/merge").contentType(JSON)
                        .content("{\"targetId\":" + tagFront + "}"))
                .andExpect(jsonPath("$.code").value(0)).andExpect(jsonPath("$.data.id").value(tagFront));
        mockMvc.perform(get("/api/v1/tags").param("workspaceId", String.valueOf(wid)))
                .andExpect(jsonPath("$.data.length()").value(1))
                .andExpect(jsonPath("$.data[0].entryCount").value(1));
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM entry_tag WHERE tag_id = ?", Long.class, tagBack)).isZero();
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM tag WHERE id = ?", Long.class, tagBack)).isZero();
        // 条目现在只有前端UI一个标签
        mockMvc.perform(get("/api/v1/entries").param("tagId", String.valueOf(tagFront)))
                .andExpect(jsonPath("$.data[0].tags.length()").value(1))
                .andExpect(jsonPath("$.data[0].tags[0]").value("前端UI"));

        // 自身合并 → 400
        mockMvc.perform(post("/api/v1/tags/" + tagFront + "/merge").contentType(JSON)
                        .content("{\"targetId\":" + tagFront + "}"))
                .andExpect(jsonPath("$.code").value(400));

        // 删除标签 → entry_tag 级联清理，条目无标签
        mockMvc.perform(delete("/api/v1/tags/" + tagFront))
                .andExpect(jsonPath("$.code").value(0));
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM entry_tag WHERE entry_id = ?", Long.class, eid)).isZero();
        mockMvc.perform(get("/api/v1/tags").param("workspaceId", String.valueOf(wid)))
                .andExpect(jsonPath("$.data.length()").value(0));

        // 清理（API 删除级联）
        mockMvc.perform(delete("/api/v1/workspaces/" + wid))
                .andExpect(jsonPath("$.code").value(0));
    }
}
