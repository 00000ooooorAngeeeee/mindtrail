package com.trailmind.backend.controller;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.trailmind.backend.entity.Workspace;
import com.trailmind.backend.repository.WorkspaceMapper;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.web.servlet.MockMvc;

import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertNull;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * 全量备份导入恢复 HTTP 全链路往返（v1.2 P2，PRD E5 / 04 §5 POST /backup/import）：
 * 导出当前全量 → 新建临时工作区（不在备份内）→ 导入恢复（事务原子全量替换）→ 临时工作区消失、已有数据 ID 不变；
 * 非法内容 / 空请求体 → 400 且不写库。
 *
 * <p>安全性：导入为 @Transactional 全量替换——先导出当前态（含全部已有数据），导入同款备份即「删除全部 + 按原 id 回填」，
 * 净效果对既有数据为零（仅本次创建的临时工作区被覆盖）；导入失败则事务回滚，DELETE 一并回滚，库不变。
 */
@SpringBootTest
@AutoConfigureMockMvc
class BackupControllerTest {

    private static final String JSON = "application/json";

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private WorkspaceMapper workspaceMapper;

    private final ObjectMapper om = new ObjectMapper();

    @Test
    void 导入恢复_全量替换_临时工作区消失且已有数据保留() throws Exception {
        // 1. 导出当前全量备份（导入后用于恢复到本态；既有数据被原样回填）
        String backupContent = exportBackup();

        long fixtureId = 0L;
        try {
            // 2. 新建临时工作区（不在备份内），用于验证「全量替换」语义
            fixtureId = createWorkspace("backup-import-fixture-" + System.nanoTime());

            // 3. 导入恢复：临时工作区应消失（备份早于它），摘要字段齐全
            mockMvc.perform(post("/api/v1/backup/import").contentType(JSON)
                            .content(om.writeValueAsString(Map.of("content", backupContent))))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.code").value(0))
                    .andExpect(jsonPath("$.data.total").exists())
                    .andExpect(jsonPath("$.data.exportedAt").exists());

            // 临时工作区已被备份覆盖（不在）
            assertNull(workspaceMapper.selectById(fixtureId), "导入恢复后临时工作区应被全量替换覆盖");

            // 4. 非法内容（合法 Base64 但非 zip）→ 400，不写库
            mockMvc.perform(post("/api/v1/backup/import").contentType(JSON)
                            .content(om.writeValueAsString(Map.of("content", "bm90LWEtemlw"))))
                    .andExpect(jsonPath("$.code").value(400));

            // 5. 空请求体（content 缺失）→ 400
            mockMvc.perform(post("/api/v1/backup/import").contentType(JSON)
                            .content("{}"))
                    .andExpect(jsonPath("$.code").value(400));
        } finally {
            // 清理：导入成功则临时工作区已被覆盖（不在）；失败则事务回滚仍存在 → 删除
            if (fixtureId != 0L) {
                Workspace leftover = workspaceMapper.selectById(fixtureId);
                if (leftover != null) {
                    mockMvc.perform(delete("/api/v1/workspaces/" + fixtureId));
                }
            }
        }
    }

    /** 导出全量备份，返回 Base64 zip 内容（data.content）。 */
    private String exportBackup() throws Exception {
        String body = mockMvc.perform(post("/api/v1/backup/export"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(0))
                .andReturn().getResponse().getContentAsString();
        return om.readTree(body).path("data").path("content").asText();
    }

    /** 新建工作区，返回 id。 */
    private long createWorkspace(String name) throws Exception {
        String body = mockMvc.perform(post("/api/v1/workspaces").contentType(JSON)
                        .content(om.writeValueAsString(Map.of("name", name))))
                .andExpect(jsonPath("$.code").value(0))
                .andReturn().getResponse().getContentAsString();
        return om.readTree(body).path("data").path("id").asLong();
    }
}
