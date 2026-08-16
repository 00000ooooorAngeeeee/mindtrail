package com.trailmind.backend.controller;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.trailmind.backend.entity.Session;
import com.trailmind.backend.entity.Workspace;
import com.trailmind.backend.repository.SessionMapper;
import com.trailmind.backend.repository.WorkspaceMapper;
import org.eclipse.jgit.api.Git;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.web.servlet.MockMvc;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Comparator;
import java.util.Map;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * 设置页真实 MySQL 全链路往返（M4 任务四，07 §7「设置页：数据库连接信息展示、主题切换、仓库路径」）：
 * GET 数据库连接信息（只读展示）→ 主题非法值 400 / dark 往返 → 默认仓库路径非法 400 / 合法往返 →
 * 会话创建回退链（会话 → 工作区 → 全局默认仓库路径）→ 清除路径与主题还原（不污染其它测试）。
 */
@SpringBootTest
@AutoConfigureMockMvc
class SettingsControllerTest {

    private static final String JSON = "application/json";

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private WorkspaceMapper workspaceMapper;

    @Autowired
    private SessionMapper sessionMapper;

    private final ObjectMapper om = new ObjectMapper();

    @Test
    void settings_get_update_repo_fallback_roundtrip() throws Exception {
        // 记录初始主题，测试结束后还原
        String initial = om.readTree(
                mockMvc.perform(get("/api/v1/settings")).andReturn().getResponse().getContentAsString())
                .path("data").path("theme").asText("system");

        Path repoDir = Files.createTempDirectory("trailmind-settings-");
        // 真实空仓库（JGit init，无提交）：GitHeadReader 可正常读取（HEAD 为未出生分支 → null）
        try (Git ignored = Git.init().setDirectory(repoDir.toFile()).call()) {
            // 初始化即关闭，目录保留
        }
        String wsName = "smoke-settings-" + System.currentTimeMillis();
        Long wid = null;
        try {
            // 1. 数据库连接信息展示：只读回填 host/port/库名/用户名
            mockMvc.perform(get("/api/v1/settings"))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.code").value(0))
                    .andExpect(jsonPath("$.data.database.host").value("127.0.0.1"))
                    .andExpect(jsonPath("$.data.database.port").value(3306))
                    .andExpect(jsonPath("$.data.database.database").value("trailmind"));

            // 2. 主题切换：非法值 400；dark 往返生效
            mockMvc.perform(put("/api/v1/settings").contentType(JSON)
                            .content(om.writeValueAsString(Map.of("theme", "blue"))))
                    .andExpect(jsonPath("$.code").value(400));
            mockMvc.perform(put("/api/v1/settings").contentType(JSON)
                            .content(om.writeValueAsString(Map.of("theme", "dark"))))
                    .andExpect(jsonPath("$.code").value(0))
                    .andExpect(jsonPath("$.data.theme").value("dark"));
            mockMvc.perform(get("/api/v1/settings"))
                    .andExpect(jsonPath("$.data.theme").value("dark"));

            // 3. 默认仓库路径：无 .git 目录 400；合法路径往返
            mockMvc.perform(put("/api/v1/settings").contentType(JSON)
                            .content(om.writeValueAsString(Map.of("defaultRepoPath", "C:/__trailmind_missing__"))))
                    .andExpect(jsonPath("$.code").value(400));
            mockMvc.perform(put("/api/v1/settings").contentType(JSON)
                            .content(om.writeValueAsString(Map.of("defaultRepoPath", repoDir.toString()))))
                    .andExpect(jsonPath("$.code").value(0))
                    .andExpect(jsonPath("$.data.defaultRepoPath").value(repoDir.toString()));

            // 4. 回退链：无仓库工作区 + 无仓库会话 → 继承全局默认仓库路径（start_head 亦按该仓库读取）
            mockMvc.perform(post("/api/v1/workspaces").contentType(JSON)
                            .content("{\"name\":\"" + wsName + "\"}"))
                    .andExpect(jsonPath("$.code").value(0));
            wid = workspaceMapper.selectOne(
                    new LambdaQueryWrapper<Workspace>().eq(Workspace::getName, wsName)).getId();
            mockMvc.perform(post("/api/v1/workspaces/" + wid + "/sessions").contentType(JSON)
                            .content("{\"title\":\"默认仓库会话\"}"))
                    .andExpect(jsonPath("$.code").value(0))
                    .andExpect(jsonPath("$.data.repoPath").value(repoDir.toString()));
        } finally {
            // 清理：删会话/工作区；清除默认仓库路径；主题还原
            if (wid != null) {
                for (Session s : sessionMapper.selectList(
                        new LambdaQueryWrapper<Session>().eq(Session::getWorkspaceId, wid))) {
                    mockMvc.perform(delete("/api/v1/sessions/" + s.getId()));
                }
                mockMvc.perform(delete("/api/v1/workspaces/" + wid));
            }
            mockMvc.perform(put("/api/v1/settings").contentType(JSON)
                    .content(om.writeValueAsString(Map.of("theme", initial, "defaultRepoPath", " "))));
            try (var paths = Files.walk(repoDir)) {
                paths.sorted(Comparator.reverseOrder()).forEach((p) -> {
                    try {
                        Files.deleteIfExists(p);
                    } catch (IOException ignored) {
                        // 清理失败不影响断言
                    }
                });
            }
        }
    }
}
