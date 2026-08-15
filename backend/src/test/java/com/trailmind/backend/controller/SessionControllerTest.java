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
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * 会话 + 条目真实 MySQL 全链路往返（07 §6 任务一验收）：
 * 开始会话（start_head）→ 列表 → 条目追加（seq 1/2/3 + 标签）→ 详情分页 → 编辑 → 非法类型 400 →
 * 重命名 → 结束（review 条目 + summary）→ 结束后追加限制 → 删除条目（级联关联表）→ 删除会话（级联）。
 */
@SpringBootTest
@AutoConfigureMockMvc
class SessionControllerTest {

    private static final String JSON = "application/json";

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private WorkspaceMapper workspaceMapper;

    @Autowired
    private JdbcTemplate jdbc;

    @Test
    void session_and_entry_roundtrip() throws Exception {
        String wsName = "smoke-session-" + System.currentTimeMillis();
        mockMvc.perform(post("/api/v1/workspaces").contentType(JSON).content("{\"name\":\"" + wsName + "\"}"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.code").value(0));
        long wid = workspaceMapper.selectOne(
                new LambdaQueryWrapper<Workspace>().eq(Workspace::getName, wsName)).getId();

        // 开始会话：无仓库 → repo_path/start_head 为空（jdbc 断言 NULL）
        mockMvc.perform(post("/api/v1/workspaces/" + wid + "/sessions")
                        .contentType(JSON).content("{\"title\":\"验收会话\"}"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.code").value(0))
                .andExpect(jsonPath("$.data.status").value("active"))
                .andExpect(jsonPath("$.data.title").value("验收会话"));
        long sid = jdbc.queryForObject("SELECT id FROM session WHERE workspace_id = ?", Long.class, wid);
        assertThat(jdbc.queryForObject("SELECT start_head IS NULL FROM session WHERE id = ?", Boolean.class, sid)).isTrue();

        // 列表可见 + 条目数统计
        mockMvc.perform(get("/api/v1/workspaces/" + wid + "/sessions"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.code").value(0))
                .andExpect(jsonPath("$.data[?(@.title == '验收会话')]").isNotEmpty())
                .andExpect(jsonPath("$.data[0].entryCount").value(0));

        // 追加 3 条：seq 按 1/2/3 递增；首条带标签
        mockMvc.perform(post("/api/v1/sessions/" + sid + "/entries").contentType(JSON)
                        .content("{\"type\":\"goal\",\"contentMd\":\"目标\",\"tags\":[\"验收标签\"]}"))
                .andExpect(jsonPath("$.code").value(0))
                .andExpect(jsonPath("$.data.seq").value(1))
                .andExpect(jsonPath("$.data.tags[0]").value("验收标签"));
        mockMvc.perform(post("/api/v1/sessions/" + sid + "/entries").contentType(JSON)
                        .content("{\"type\":\"action\",\"contentMd\":\"动作\"}"))
                .andExpect(jsonPath("$.code").value(0)).andExpect(jsonPath("$.data.seq").value(2));
        mockMvc.perform(post("/api/v1/sessions/" + sid + "/entries").contentType(JSON)
                        .content("{\"type\":\"test\",\"contentMd\":\"验证\"}"))
                .andExpect(jsonPath("$.code").value(0)).andExpect(jsonPath("$.data.seq").value(3));

        // 详情分页：第 1 页 2 条（含标签回填），第 2 页 1 条
        mockMvc.perform(get("/api/v1/sessions/" + sid + "?page=1&size=2"))
                .andExpect(jsonPath("$.code").value(0))
                .andExpect(jsonPath("$.data.entries.length()").value(2))
                .andExpect(jsonPath("$.data.entryTotal").value(3))
                .andExpect(jsonPath("$.data.entries[0].seq").value(1))
                .andExpect(jsonPath("$.data.entries[0].tags[0]").value("验收标签"));
        mockMvc.perform(get("/api/v1/sessions/" + sid + "?page=2&size=2"))
                .andExpect(jsonPath("$.data.entries.length()").value(1))
                .andExpect(jsonPath("$.data.entries[0].seq").value(3));

        // 编辑条目（MVP 仅 contentMd）
        long eid2 = jdbc.queryForObject("SELECT id FROM entry WHERE session_id = ? AND seq = 2", Long.class, sid);
        mockMvc.perform(put("/api/v1/entries/" + eid2).contentType(JSON).content("{\"contentMd\":\"改后的内容\"}"))
                .andExpect(jsonPath("$.code").value(0))
                .andExpect(jsonPath("$.data.contentMd").value("改后的内容"));

        // 非法类型 → 400
        mockMvc.perform(post("/api/v1/sessions/" + sid + "/entries").contentType(JSON)
                        .content("{\"type\":\"todo\",\"contentMd\":\"x\"}"))
                .andExpect(jsonPath("$.code").value(400));

        // PATCH 重命名
        mockMvc.perform(patch("/api/v1/sessions/" + sid).contentType(JSON).content("{\"title\":\"改名后的会话\"}"))
                .andExpect(jsonPath("$.code").value(0))
                .andExpect(jsonPath("$.data.title").value("改名后的会话"));

        // 结束会话：status/ended_at/summary + 总结写入 review 条目（seq=4）
        mockMvc.perform(patch("/api/v1/sessions/" + sid).contentType(JSON)
                        .content("{\"status\":\"completed\",\"summary\":\"验收总结\"}"))
                .andExpect(jsonPath("$.code").value(0))
                .andExpect(jsonPath("$.data.status").value("completed"))
                .andExpect(jsonPath("$.data.summary").value("验收总结"))
                .andExpect(jsonPath("$.data.endedAt").isNotEmpty());
        mockMvc.perform(get("/api/v1/sessions/" + sid))
                .andExpect(jsonPath("$.data.entryTotal").value(4))
                .andExpect(jsonPath("$.data.entries[3].type").value("review"))
                .andExpect(jsonPath("$.data.entries[3].contentMd").value("验收总结"));

        // 结束后仅可追加 review/note
        mockMvc.perform(post("/api/v1/sessions/" + sid + "/entries").contentType(JSON)
                        .content("{\"type\":\"action\",\"contentMd\":\"x\"}"))
                .andExpect(jsonPath("$.code").value(400));
        mockMvc.perform(post("/api/v1/sessions/" + sid + "/entries").contentType(JSON)
                        .content("{\"type\":\"note\",\"contentMd\":\"备注\"}"))
                .andExpect(jsonPath("$.code").value(0));

        // 删除条目：entry_tag 随之清理
        long eid1 = jdbc.queryForObject("SELECT id FROM entry WHERE session_id = ? AND seq = 1", Long.class, sid);
        mockMvc.perform(delete("/api/v1/entries/" + eid1))
                .andExpect(status().isOk()).andExpect(jsonPath("$.code").value(0));
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM entry_tag WHERE entry_id = ?", Long.class, eid1)).isZero();

        // 删除会话：条目级联清空
        mockMvc.perform(delete("/api/v1/sessions/" + sid))
                .andExpect(status().isOk()).andExpect(jsonPath("$.code").value(0));
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM session WHERE id = ?", Long.class, sid)).isZero();
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM entry WHERE session_id = ?", Long.class, sid)).isZero();

        // 清理工作区（级联删除会话期创建的标签）
        mockMvc.perform(delete("/api/v1/workspaces/" + wid))
                .andExpect(status().isOk()).andExpect(jsonPath("$.code").value(0));
    }

    /**
     * Git 绑定真实链路（07 §6 任务三）：临时真实仓库 → 带仓库会话（start_head）→
     * /git/repo/status 与 /git/repo/commits（since=start_head 感知新提交）→
     * 绑定（含追加携带 commitHashes 与单独绑定）→ 会话绑定列表 → 详情回填 → 防造假 400 → 解绑 → 级联清理。
     */
    @Test
    void git_commit_binding_roundtrip(@org.junit.jupiter.api.io.TempDir java.nio.file.Path tempDir) throws Exception {
        System.setProperty("user.home", System.getProperty("java.io.tmpdir")); // JGit 配置写临时目录
        java.nio.file.Path repo = java.nio.file.Files.createDirectory(tempDir.resolve("repo"));
        String repoPath = repo.toString();
        try (org.eclipse.jgit.api.Git git = org.eclipse.jgit.api.Git.init().setDirectory(repo.toFile()).call()) {
            java.nio.file.Files.writeString(repo.resolve("a.txt"), "one");
            git.add().addFilepattern(".").call();
            git.commit().setMessage("c1").setAuthor("T", "t@trailmind.local").setCommitter("T", "t@trailmind.local").call();
        }
        String head = new com.trailmind.backend.git.GitHeadReader().readHead(repoPath);
        assertThat(head).isNotBlank();

        // 仓库校验：status 与 HEAD 一致；非法路径 400（无 .git 的空目录，findGitDir 向上寻不到仓库）
        mockMvc.perform(get("/api/v1/git/repo/status").param("path", repoPath))
                .andExpect(jsonPath("$.code").value(0))
                .andExpect(jsonPath("$.data.head").value(head));
        mockMvc.perform(get("/api/v1/git/repo/status").param("path", tempDir.resolve("not-a-repo").toString()))
                .andExpect(jsonPath("$.code").value(400));

        // 带仓库会话：start_head = 当前 HEAD
        String wsName = "smoke-git-" + System.currentTimeMillis();
        mockMvc.perform(post("/api/v1/workspaces").contentType(JSON).content("{\"name\":\"" + wsName + "\"}"))
                .andExpect(jsonPath("$.code").value(0));
        long wid = workspaceMapper.selectOne(
                new LambdaQueryWrapper<Workspace>().eq(Workspace::getName, wsName)).getId();
        mockMvc.perform(post("/api/v1/workspaces/" + wid + "/sessions").contentType(JSON)
                        .content("{\"title\":\"Git 会话\",\"repoPath\":\"" + repoPath.replace("\\", "\\\\") + "\"}"))
                .andExpect(jsonPath("$.code").value(0))
                .andExpect(jsonPath("$.data.startHead").value(head));
        long sid = jdbc.queryForObject("SELECT id FROM session WHERE workspace_id = ?", Long.class, wid);

        // 新提交感知：追加 c2 后 since=start_head 仅返回 c2
        String c2;
        try (org.eclipse.jgit.api.Git git = org.eclipse.jgit.api.Git.open(repo.toFile())) {
            java.nio.file.Files.writeString(repo.resolve("b.txt"), "two");
            git.add().addFilepattern(".").call();
            c2 = git.commit().setMessage("c2").setAuthor("T", "t@trailmind.local").setCommitter("T", "t@trailmind.local")
                    .call().getId().name();
        }
        mockMvc.perform(get("/api/v1/git/repo/commits").param("path", repoPath).param("since", head))
                .andExpect(jsonPath("$.code").value(0))
                .andExpect(jsonPath("$.data.length()").value(1))
                .andExpect(jsonPath("$.data[0].hash").value(c2))
                .andExpect(jsonPath("$.data[0].files[0]").value("b.txt"));

        // 绑定：追加条目携带 commitHashes（详情回填 commits）
        mockMvc.perform(post("/api/v1/sessions/" + sid + "/entries").contentType(JSON)
                        .content("{\"type\":\"artifact\",\"contentMd\":\"c2 产出\",\"commitHashes\":[\"" + c2 + "\"]}"))
                .andExpect(jsonPath("$.code").value(0))
                .andExpect(jsonPath("$.data.commits[0]").value(c2));
        long eid = jdbc.queryForObject("SELECT id FROM entry WHERE session_id = ?", Long.class, sid);

        // 会话绑定列表 + 详情回填
        mockMvc.perform(get("/api/v1/sessions/" + sid + "/commits"))
                .andExpect(jsonPath("$.code").value(0))
                .andExpect(jsonPath("$.data.length()").value(1))
                .andExpect(jsonPath("$.data[0].entryId").value(eid))
                .andExpect(jsonPath("$.data[0].commitHash").value(c2));
        mockMvc.perform(get("/api/v1/sessions/" + sid))
                .andExpect(jsonPath("$.data.entries[0].commits[0]").value(c2));

        // 防造假：仓库不存在的 hash 绑定 → 400；非法格式 → 400
        mockMvc.perform(post("/api/v1/entries/" + eid + "/commits").contentType(JSON)
                        .content("{\"commitHashes\":[\"" + "0".repeat(40) + "\"]}"))
                .andExpect(jsonPath("$.code").value(400));
        mockMvc.perform(post("/api/v1/entries/" + eid + "/commits").contentType(JSON)
                        .content("{\"commitHashes\":[\"xyz\"]}"))
                .andExpect(jsonPath("$.code").value(400));

        // 解绑 → 绑定列表清空；再次解绑 → 404
        mockMvc.perform(delete("/api/v1/entries/" + eid + "/commits/" + c2))
                .andExpect(jsonPath("$.code").value(0));
        mockMvc.perform(get("/api/v1/sessions/" + sid + "/commits"))
                .andExpect(jsonPath("$.data.length()").value(0));
        mockMvc.perform(delete("/api/v1/entries/" + eid + "/commits/" + c2))
                .andExpect(jsonPath("$.code").value(404));

        // 重新绑定后删除会话：entry_commit 级联清理
        mockMvc.perform(post("/api/v1/entries/" + eid + "/commits").contentType(JSON)
                        .content("{\"commitHashes\":[\"" + c2 + "\"]}"))
                .andExpect(jsonPath("$.code").value(0));
        mockMvc.perform(delete("/api/v1/sessions/" + sid))
                .andExpect(jsonPath("$.code").value(0));
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM entry_commit WHERE entry_id = ?", Long.class, eid)).isZero();
        mockMvc.perform(delete("/api/v1/workspaces/" + wid))
                .andExpect(jsonPath("$.code").value(0));
    }
}
