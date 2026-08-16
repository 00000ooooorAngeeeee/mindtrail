package com.trailmind.backend.service;

import com.trailmind.backend.entity.Entry;
import com.trailmind.backend.entity.EntryCommit;
import com.trailmind.backend.entity.EntryTag;
import com.trailmind.backend.entity.Mindmap;
import com.trailmind.backend.entity.Session;
import com.trailmind.backend.entity.Setting;
import com.trailmind.backend.entity.Tag;
import com.trailmind.backend.entity.Workspace;
import com.trailmind.backend.repository.EntryCommitMapper;
import com.trailmind.backend.repository.EntryMapper;
import com.trailmind.backend.repository.EntryTagMapper;
import com.trailmind.backend.repository.MindmapMapper;
import com.trailmind.backend.repository.SessionMapper;
import com.trailmind.backend.repository.SettingMapper;
import com.trailmind.backend.repository.TagMapper;
import com.trailmind.backend.repository.WorkspaceMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.time.LocalDateTime;
import java.util.Base64;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.Mockito.when;

/**
 * 全量备份导出单测（M4 任务六，PRD E5）：
 * 8 张表数据全部进入备份（zip 内 trailmind-backup.json），format/version/exportedAt 协议字段正确，
 * 时间固定到秒（06 §4A 机器协议形态稳定）、Base64 zip 可解压还原、空库导出不报错。
 */
@ExtendWith(MockitoExtension.class)
class BackupExportServiceTest {

    @Mock
    private WorkspaceMapper workspaceMapper;
    @Mock
    private MindmapMapper mindmapMapper;
    @Mock
    private SessionMapper sessionMapper;
    @Mock
    private EntryMapper entryMapper;
    @Mock
    private TagMapper tagMapper;
    @Mock
    private EntryTagMapper entryTagMapper;
    @Mock
    private EntryCommitMapper entryCommitMapper;
    @Mock
    private SettingMapper settingMapper;

    private BackupExportService service;

    @BeforeEach
    void setUp() {
        service = new BackupExportService(workspaceMapper, mindmapMapper, sessionMapper, entryMapper,
                tagMapper, entryTagMapper, entryCommitMapper, settingMapper);
    }

    private void mockAll(List<Workspace> ws, List<Mindmap> mm, List<Session> ss, List<Entry> es,
                         List<Tag> ts, List<EntryTag> ets, List<EntryCommit> ecs, List<Setting> st) {
        when(workspaceMapper.selectList(null)).thenReturn(ws);
        when(mindmapMapper.selectList(null)).thenReturn(mm);
        when(sessionMapper.selectList(null)).thenReturn(ss);
        when(entryMapper.selectList(null)).thenReturn(es);
        when(tagMapper.selectList(null)).thenReturn(ts);
        when(entryTagMapper.selectList(null)).thenReturn(ets);
        when(entryCommitMapper.selectList(null)).thenReturn(ecs);
        when(settingMapper.selectList(null)).thenReturn(st);
    }

    @Test
    void 导出全部表数据_格式协议正确且可还原() throws Exception {
        Workspace ws = new Workspace();
        ws.setId(1L);
        ws.setName("项目A");
        ws.setDescription("描述");
        ws.setRepoPath("D:/repo");
        ws.setCreatedAt(LocalDateTime.of(2025, 6, 1, 9, 0, 0));
        ws.setUpdatedAt(LocalDateTime.of(2025, 6, 1, 9, 30, 5));

        Mindmap mm = new Mindmap();
        mm.setId(10L);
        mm.setWorkspaceId(1L);
        mm.setName("架构图");
        mm.setContentJson("{\"version\":1,\"nodes\":{}}");
        mm.setSearchText("架构 图");
        mm.setNodeCount(3);
        mm.setCreatedAt(LocalDateTime.of(2025, 6, 1, 9, 10, 0));

        Session s = new Session();
        s.setId(7L);
        s.setWorkspaceId(1L);
        s.setTitle("会话甲");
        s.setStatus("completed");
        s.setRepoPath("D:/repo");
        s.setStartHead("a".repeat(40));
        s.setEndHead("b".repeat(40));
        s.setSummary("总结");
        s.setStartedAt(LocalDateTime.of(2025, 6, 1, 9, 0, 0));
        s.setEndedAt(LocalDateTime.of(2025, 6, 1, 11, 30, 0));
        s.setCreatedAt(LocalDateTime.of(2025, 6, 1, 9, 0, 0));
        s.setUpdatedAt(LocalDateTime.of(2025, 6, 1, 11, 30, 0));

        Entry e = new Entry();
        e.setId(11L);
        e.setSessionId(7L);
        e.setSeq(1);
        e.setType("goal");
        e.setContentMd("目标");
        e.setCreatedAt(LocalDateTime.of(2025, 6, 1, 9, 2, 0));
        e.setUpdatedAt(LocalDateTime.of(2025, 6, 1, 9, 2, 0));

        Tag t = new Tag();
        t.setId(3L);
        t.setWorkspaceId(1L);
        t.setName("验收");
        t.setCreatedAt(LocalDateTime.of(2025, 6, 1, 9, 5, 0));

        EntryTag et = new EntryTag(11L, 3L);
        EntryCommit ec = new EntryCommit();
        ec.setEntryId(11L);
        ec.setCommitHash("c".repeat(40));
        ec.setRepoPath("D:/repo");
        ec.setBoundAt(LocalDateTime.of(2025, 6, 1, 9, 20, 0));

        Setting st = new Setting();
        st.setK("theme");
        st.setV("dark");
        st.setUpdatedAt(LocalDateTime.of(2025, 6, 1, 8, 0, 0));

        mockAll(List.of(ws), List.of(mm), List.of(s), List.of(e), List.of(t), List.of(et), List.of(ec), List.of(st));

        BackupExportService.ExportFile file = service.export();

        // 产物元信息：zip 文件名带时间戳、MIME 正确、Base64 可解码
        assertNotNull(file.filename());
        assertTrue(file.filename().startsWith("trailmind-backup-"));
        assertTrue(file.filename().endsWith(".zip"));
        assertEquals("application/zip", file.contentType());
        byte[] zip = Base64.getDecoder().decode(file.content());
        assertTrue(zip.length > 0);

        // 解压还原 JSON 并断言协议与全表数据
        String jsonStr = BackupExportService.unzipJson(zip);
        Map<String, Object> root = BackupExportService.parseBackup(jsonStr);
        assertEquals("trailmind-backup", root.get("format"));
        assertEquals(1, root.get("version"));
        assertNotNull(root.get("exportedAt"));
        // 时间固定到秒的 ISO-8601（无毫秒/无秒省略）
        String exportedAt = (String) root.get("exportedAt");
        assertTrue(exportedAt.matches("\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}"));

        @SuppressWarnings("unchecked")
        Map<String, Object> tables = (Map<String, Object>) root.get("tables");
        assertEquals(8, tables.size());
        assertEquals(1, ((List<?>) tables.get("workspace")).size());
        assertEquals(1, ((List<?>) tables.get("mindmap")).size());
        assertEquals(1, ((List<?>) tables.get("session")).size());
        assertEquals(1, ((List<?>) tables.get("entry")).size());
        assertEquals(1, ((List<?>) tables.get("tag")).size());
        assertEquals(1, ((List<?>) tables.get("entry_tag")).size());
        assertEquals(1, ((List<?>) tables.get("entry_commit")).size());
        assertEquals(1, ((List<?>) tables.get("setting")).size());

        // 关键字段往返（名称/正文/hash/时间格式）
        Map<String, Object> wsJson = (Map<String, Object>) ((List<?>) tables.get("workspace")).get(0);
        assertEquals("项目A", wsJson.get("name"));
        Map<String, Object> entryJson = (Map<String, Object>) ((List<?>) tables.get("entry")).get(0);
        assertEquals("目标", entryJson.get("contentMd"));
        assertEquals("2025-06-01T09:02:00", entryJson.get("createdAt"));
        Map<String, Object> ecJson = (Map<String, Object>) ((List<?>) tables.get("entry_commit")).get(0);
        assertEquals("c".repeat(40), ecJson.get("commitHash"));
    }

    @Test
    void 空库导出_返回合法zip且各表为空数组() throws Exception {
        mockAll(List.of(), List.of(), List.of(), List.of(), List.of(), List.of(), List.of(), List.of());

        BackupExportService.ExportFile file = service.export();
        String jsonStr = BackupExportService.unzipJson(Base64.getDecoder().decode(file.content()));
        Map<String, Object> root = BackupExportService.parseBackup(jsonStr);
        @SuppressWarnings("unchecked")
        Map<String, Object> tables = (Map<String, Object>) root.get("tables");
        for (Map.Entry<String, Object> t : tables.entrySet()) {
            assertTrue(((List<?>) t.getValue()).isEmpty(), "空库表应导出为空数组：" + t.getKey());
        }
        // Jackson 序列化后反序列化可解析（无类型错误）
        assertEquals(root.get("format"), BackupExportService.BACKUP_FORMAT);
    }

    @Test
    void 实体中非表字段不进入备份() throws Exception {
        Session s = new Session();
        s.setId(7L);
        s.setWorkspaceId(1L);
        s.setTitle("会话");
        s.setStatus("active");
        s.setStartedAt(LocalDateTime.of(2025, 6, 1, 9, 0, 0));
        // 备份走 mapper.selectList 全量查询：非表字段（entries/entryTotal/entryCount/mindmapCount 等）
        // 在查询结果中恒为 null，经全局 NON_NULL 配置不进入备份 JSON（避免与真实列混淆、协议形态稳定）。

        mockAll(List.of(), List.of(), List.of(s), List.of(), List.of(), List.of(), List.of(), List.of());

        String jsonStr = BackupExportService.unzipJson(Base64.getDecoder().decode(service.export().content()));
        Map<String, Object> root = BackupExportService.parseBackup(jsonStr);
        @SuppressWarnings("unchecked")
        Map<String, Object> sessionJson = (Map<String, Object>) ((List<?>) ((Map<String, Object>) root.get("tables")).get("session")).get(0);
        assertEquals("会话", sessionJson.get("title"));
        assertTrue(!sessionJson.containsKey("entries"), "非表字段 entries 不应进入备份");
        assertTrue(!sessionJson.containsKey("entryTotal"), "非表字段 entryTotal 不应进入备份");
        assertTrue(!sessionJson.containsKey("entryCount"), "非表字段 entryCount 不应进入备份");
    }
}
