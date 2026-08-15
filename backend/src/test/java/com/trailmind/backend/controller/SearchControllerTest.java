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

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * 全局搜索真实 MySQL 全链路往返（M4 任务一验收，07 §7 + 09 风险「验收用例覆盖中文短词」）：
 * FULLTEXT ngram 命中（多字词、导图节点文本/条目正文）、会话标题 LIKE 命中、
 * 单字 LIKE 兜底、type/workspaceId 过滤、片段与节点定位回填、参数校验 400。
 * 关键词含时间戳保证唯一，规避服务层 30s 结果缓存跨用例串扰。
 */
@SpringBootTest
@AutoConfigureMockMvc
class SearchControllerTest {

    private static final String JSON = "application/json";

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private WorkspaceMapper workspaceMapper;

    @Autowired
    private JdbcTemplate jdbc;

    @Test
    void search_fulltext_like_and_filters_roundtrip() throws Exception {
        String kw = "验搜" + System.currentTimeMillis();
        String rareChar = "龘";

        String wsName = "smoke-search-" + System.currentTimeMillis();
        mockMvc.perform(post("/api/v1/workspaces").contentType(JSON).content("{\"name\":\"" + wsName + "\"}"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.code").value(0));
        long wid = workspaceMapper.selectOne(
                new LambdaQueryWrapper<Workspace>().eq(Workspace::getName, wsName)).getId();

        // 第二个空工作区（workspaceId 过滤负例）
        String otherName = "smoke-search-other-" + System.currentTimeMillis();
        mockMvc.perform(post("/api/v1/workspaces").contentType(JSON).content("{\"name\":\"" + otherName + "\"}"))
                .andExpect(status().isOk());
        long otherWid = workspaceMapper.selectOne(
                new LambdaQueryWrapper<Workspace>().eq(Workspace::getName, otherName)).getId();

        // 导图：n2 节点文本含关键词（search_text 含节点文本，FULLTEXT ngram 命中）
        String content = "{\"version\":1,\"rootNodeId\":\"n1\",\"nodes\":{"
                + "\"n1\":{\"id\":\"n1\",\"text\":\"根节点\",\"note\":\"\",\"style\":{\"color\":\"default\",\"bold\":false,\"shape\":\"rounded\"},\"tags\":[],\"parentId\":null,\"layout\":null,\"collapsed\":false},"
                + "\"n2\":{\"id\":\"n2\",\"text\":\"节点" + kw + "\",\"note\":\"\",\"style\":{\"color\":\"default\",\"bold\":false,\"shape\":\"rounded\"},\"tags\":[],\"parentId\":\"n1\",\"layout\":null,\"collapsed\":false}"
                + "},\"edges\":[]}";
        mockMvc.perform(post("/api/v1/workspaces/" + wid + "/mindmaps").contentType(JSON)
                        .content("{\"name\":\"搜索导图\",\"contentJson\":" + toJsonString(content) + "}"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.code").value(0));
        long mid = jdbc.queryForObject("SELECT id FROM mindmap WHERE workspace_id = ?", Long.class, wid);

        // 会话：标题含关键词（标题 LIKE 命中）
        mockMvc.perform(post("/api/v1/workspaces/" + wid + "/sessions").contentType(JSON)
                        .content("{\"title\":\"搜索会话 " + kw + "\"}"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.code").value(0));
        long sid = jdbc.queryForObject("SELECT id FROM session WHERE workspace_id = ?", Long.class, wid);

        // 条目：正文含关键词（content_md FULLTEXT 命中）+ 罕见单字（单字 LIKE 兜底命中）
        mockMvc.perform(post("/api/v1/sessions/" + sid + "/entries").contentType(JSON)
                        .content("{\"type\":\"action\",\"contentMd\":\"正文 " + kw + " 内容\"}"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.code").value(0));
        mockMvc.perform(post("/api/v1/sessions/" + sid + "/entries").contentType(JSON)
                        .content("{\"type\":\"note\",\"contentMd\":\"罕见字 " + rareChar + " 条目\"}"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.code").value(0));
        long entryId = jdbc.queryForObject(
                "SELECT id FROM entry WHERE session_id = ? AND content_md LIKE '%" + kw + "%'", Long.class, sid);

        // 1) 全局搜索（all + workspaceId 过滤）：三类命中 + 片段 + 节点定位
        mockMvc.perform(get("/api/v1/search").param("q", kw).param("workspaceId", String.valueOf(wid)))
                .andExpect(status().isOk()).andExpect(jsonPath("$.code").value(0))
                .andExpect(jsonPath("$.data.mindmaps.length()").value(1))
                .andExpect(jsonPath("$.data.mindmaps[0].id").value(mid))
                .andExpect(jsonPath("$.data.mindmaps[0].nodeId").value("n2"))
                .andExpect(jsonPath("$.data.mindmaps[0].snippet").value(org.hamcrest.Matchers.containsString(kw)))
                .andExpect(jsonPath("$.data.entries.length()").value(1))
                .andExpect(jsonPath("$.data.entries[0].id").value(entryId))
                .andExpect(jsonPath("$.data.entries[0].sessionId").value(sid))
                .andExpect(jsonPath("$.data.entries[0].snippet").value(org.hamcrest.Matchers.containsString(kw)))
                .andExpect(jsonPath("$.data.sessions.length()").value(1))
                .andExpect(jsonPath("$.data.sessions[0].id").value(sid));

        // 2) type=entry：只查条目类
        mockMvc.perform(get("/api/v1/search").param("q", kw).param("type", "entry").param("workspaceId", String.valueOf(wid)))
                .andExpect(status().isOk()).andExpect(jsonPath("$.code").value(0))
                .andExpect(jsonPath("$.data.entries.length()").value(1))
                .andExpect(jsonPath("$.data.mindmaps.length()").value(0))
                .andExpect(jsonPath("$.data.sessions.length()").value(0));

        // 3) 单字 LIKE 兜底（ngram 无法索引单字；workspaceId 圈定范围保证确定性）
        mockMvc.perform(get("/api/v1/search").param("q", rareChar).param("workspaceId", String.valueOf(wid)))
                .andExpect(status().isOk()).andExpect(jsonPath("$.code").value(0))
                .andExpect(jsonPath("$.data.entries.length()").value(1))
                .andExpect(jsonPath("$.data.entries[0].snippet").value(org.hamcrest.Matchers.containsString(rareChar)));

        // 4) workspaceId 过滤负例：其它工作区搜同词 → 空结果
        mockMvc.perform(get("/api/v1/search").param("q", kw).param("workspaceId", String.valueOf(otherWid)))
                .andExpect(status().isOk()).andExpect(jsonPath("$.code").value(0))
                .andExpect(jsonPath("$.data.mindmaps.length()").value(0))
                .andExpect(jsonPath("$.data.entries.length()").value(0))
                .andExpect(jsonPath("$.data.sessions.length()").value(0));

        // 5) 参数校验：空关键词 / 非法类型 → 400
        mockMvc.perform(get("/api/v1/search").param("q", "  "))
                .andExpect(status().isOk()).andExpect(jsonPath("$.code").value(400));
        mockMvc.perform(get("/api/v1/search").param("q", kw).param("type", "bogus"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.code").value(400));

        // 清理（走 API 删除，service 层级联清理导图/会话/条目）
        mockMvc.perform(delete("/api/v1/workspaces/" + wid))
                .andExpect(status().isOk()).andExpect(jsonPath("$.code").value(0));
        mockMvc.perform(delete("/api/v1/workspaces/" + otherWid))
                .andExpect(status().isOk()).andExpect(jsonPath("$.code").value(0));
    }

    private static String toJsonString(String s) {
        return "\"" + s.replace("\\", "\\\\").replace("\"", "\\\"") + "\"";
    }
}
