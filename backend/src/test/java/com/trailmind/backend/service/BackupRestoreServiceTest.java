package com.trailmind.backend.service;

import com.trailmind.backend.common.BadRequestException;
import com.trailmind.backend.entity.Entry;
import com.trailmind.backend.entity.EntryCommit;
import com.trailmind.backend.entity.EntryTag;
import com.trailmind.backend.entity.Mindmap;
import com.trailmind.backend.entity.NodeEntry;
import com.trailmind.backend.entity.Session;
import com.trailmind.backend.entity.Setting;
import com.trailmind.backend.entity.Tag;
import com.trailmind.backend.entity.Workspace;
import com.trailmind.backend.repository.EntryCommitMapper;
import com.trailmind.backend.repository.EntryMapper;
import com.trailmind.backend.repository.EntryTagMapper;
import com.trailmind.backend.repository.MindmapMapper;
import com.trailmind.backend.repository.NodeEntryMapper;
import com.trailmind.backend.repository.SessionMapper;
import com.trailmind.backend.repository.SettingMapper;
import com.trailmind.backend.repository.TagMapper;
import com.trailmind.backend.repository.WorkspaceMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.nio.charset.StandardCharsets;
import java.time.LocalDateTime;
import java.util.Base64;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * 全量备份导入恢复单测（v1.2 P2，PRD E5「导入恢复」/ 04 §5 POST /backup/import / 05 §8）：
 * 校验链路（空/非法 zip/格式/版本/JSON → 400 且不写库）+ 全量替换往返（导出 zip → 导入 → DELETE 9 表 + 按原 id 回填 + 计数正确）。
 * 与 {@link BackupExportServiceTest} 对称：同一份夹具经 export → restore 全程被 mock，断言调用与 id 保留。
 *
 * <p>注意 MockitoExtension 严格模式：只在需要触发 export 的用例里挂 selectList 桩（否则 UnnecessaryStubbingException）；
 * 校验失败用例不读库，不挂任何桩。
 */
@ExtendWith(MockitoExtension.class)
class BackupRestoreServiceTest {

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
    private NodeEntryMapper nodeEntryMapper;
    @Mock
    private SettingMapper settingMapper;

    private BackupExportService exportService;
    private BackupRestoreService restoreService;

    @BeforeEach
    void setUp() {
        exportService = new BackupExportService(workspaceMapper, mindmapMapper, sessionMapper, entryMapper,
                tagMapper, entryTagMapper, entryCommitMapper, nodeEntryMapper, settingMapper);
        restoreService = new BackupRestoreService(workspaceMapper, mindmapMapper, sessionMapper, entryMapper,
                tagMapper, entryTagMapper, entryCommitMapper, nodeEntryMapper, settingMapper);
    }

    /** 仅在 export 往返用例挂 selectList 桩（严格模式下未用会报错）。 */
    @SuppressWarnings("unused")
    private void stubExportData() {
        Workspace ws = new Workspace();
        ws.setId(1L);
        ws.setName("项目A");
        ws.setCreatedAt(LocalDateTime.of(2025, 6, 1, 9, 0, 0));
        ws.setUpdatedAt(LocalDateTime.of(2025, 6, 1, 9, 30, 5));

        Mindmap mm = new Mindmap();
        mm.setId(10L);
        mm.setWorkspaceId(1L);
        mm.setName("架构图");
        mm.setContentJson("{\"version\":1,\"nodes\":{}}");
        mm.setSearchText("架构");
        mm.setNodeCount(0);
        mm.setCreatedAt(LocalDateTime.of(2025, 6, 1, 9, 10, 0));

        Session s = new Session();
        s.setId(7L);
        s.setWorkspaceId(1L);
        s.setTitle("会话甲");
        s.setStatus("completed");
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
        NodeEntry ne = new NodeEntry(10L, "n1", 11L);

        Setting st = new Setting();
        st.setK("theme");
        st.setV("dark");
        st.setUpdatedAt(LocalDateTime.of(2025, 6, 1, 8, 0, 0));

        when(workspaceMapper.selectList(null)).thenReturn(List.of(ws));
        when(mindmapMapper.selectList(null)).thenReturn(List.of(mm));
        when(sessionMapper.selectList(null)).thenReturn(List.of(s));
        when(entryMapper.selectList(null)).thenReturn(List.of(e));
        when(tagMapper.selectList(null)).thenReturn(List.of(t));
        when(entryTagMapper.selectList(null)).thenReturn(List.of(et));
        when(entryCommitMapper.selectList(null)).thenReturn(List.of(ec));
        when(nodeEntryMapper.selectList(null)).thenReturn(List.of(ne));
        when(settingMapper.selectList(null)).thenReturn(List.of(st));
    }

    @Test
    void 导入恢复_全量替换_保留原id并返回正确计数() {
        stubExportData();
        // 导出 → 拿到真实 zip（Base64），再喂给 restore（同一组 mock 既供 export 读又供 restore 写）
        String content = exportService.export().content();

        BackupRestoreService.RestoreSummary summary = restoreService.restore(content);

        // 摘要：9 表计数与夹具一致，总计 9，导出时间回填
        assertEquals(1, summary.workspace());
        assertEquals(1, summary.mindmap());
        assertEquals(1, summary.session());
        assertEquals(1, summary.entry());
        assertEquals(1, summary.tag());
        assertEquals(1, summary.entryTag());
        assertEquals(1, summary.entryCommit());
        assertEquals(1, summary.nodeEntry());
        assertEquals(1, summary.setting());
        assertEquals(9, summary.total());
        assertTrue(summary.exportedAt() != null && !summary.exportedAt().isBlank());

        // 全量替换：9 张表各 deleteAll 一次
        verify(workspaceMapper).deleteAll();
        verify(mindmapMapper).deleteAll();
        verify(sessionMapper).deleteAll();
        verify(entryMapper).deleteAll();
        verify(tagMapper).deleteAll();
        verify(entryTagMapper).deleteAll();
        verify(entryCommitMapper).deleteAll();
        verify(nodeEntryMapper).deleteAll();
        verify(settingMapper).deleteAll();

        // 按原 id 回填：捕获插入实体，断言主键保留（引用完整性的根）
        ArgumentCaptor<Workspace> wsCap = ArgumentCaptor.forClass(Workspace.class);
        verify(workspaceMapper).insert(wsCap.capture());
        assertEquals(1L, wsCap.getValue().getId());
        assertEquals("项目A", wsCap.getValue().getName());

        ArgumentCaptor<Entry> eCap = ArgumentCaptor.forClass(Entry.class);
        verify(entryMapper).insert(eCap.capture());
        assertEquals(11L, eCap.getValue().getId());
        assertEquals(7L, eCap.getValue().getSessionId());
        assertEquals("goal", eCap.getValue().getType());

        // 复合主键表同样回填（NodeEntry 三元组完整）
        ArgumentCaptor<NodeEntry> neCap = ArgumentCaptor.forClass(NodeEntry.class);
        verify(nodeEntryMapper).insert(neCap.capture());
        assertEquals(10L, neCap.getValue().getMindmapId());
        assertEquals("n1", neCap.getValue().getNodeId());
        assertEquals(11L, neCap.getValue().getEntryId());
    }

    @Test
    void 空备份_各表空数组_成功deleteAll但不调insert() {
        // 空备份：所有表为空数组（合法 v1 备份），restore 不读 selectList，无需挂桩
        String content = zipBase64("{\"format\":\"trailmind-backup\",\"version\":1,"
                + "\"exportedAt\":\"2025-08-16T12:00:00\","
                + "\"tables\":{\"workspace\":[],\"mindmap\":[],\"session\":[],\"entry\":[],\"tag\":[],"
                + "\"entry_tag\":[],\"entry_commit\":[],\"node_entry\":[],\"setting\":[]}}");

        BackupRestoreService.RestoreSummary summary = restoreService.restore(content);

        assertEquals(0, summary.total());
        // 仍清空 9 表（全量替换语义），但不插入任何行
        verify(workspaceMapper).deleteAll();
        verify(entryMapper, never()).insert(any(Entry.class));
        verify(nodeEntryMapper, never()).insert(any(NodeEntry.class));
    }

    @Test
    void 空内容_400且不写库() {
        BadRequestException e = assertThrows(BadRequestException.class, () -> restoreService.restore(""));
        assertTrue(e.getMessage().contains("为空"));
        assertNoDelete();
    }

    @Test
    void 非法base64_400且不写库() {
        BadRequestException e = assertThrows(BadRequestException.class,
                () -> restoreService.restore("!!!不是base64!!!"));
        assertTrue(e.getMessage().contains("Base64"));
        assertNoDelete();
    }

    @Test
    void 非zip内容_400且不写库() {
        // 合法 Base64 但内容不是 zip
        String content = Base64.getEncoder().encodeToString("not a zip".getBytes(StandardCharsets.UTF_8));
        BadRequestException e = assertThrows(BadRequestException.class, () -> restoreService.restore(content));
        assertTrue(e.getMessage().contains("zip"));
        assertNoDelete();
    }

    @Test
    void 格式不匹配_400且不写库() {
        String content = zipBase64("{\"format\":\"other-format\",\"version\":1,\"exportedAt\":\"2025-08-16T12:00:00\","
                + "\"tables\":{}}");
        BadRequestException e = assertThrows(BadRequestException.class, () -> restoreService.restore(content));
        assertTrue(e.getMessage().contains("格式不匹配"));
        assertNoDelete();
    }

    @Test
    void 版本不支持_400且不写库() {
        String content = zipBase64("{\"format\":\"trailmind-backup\",\"version\":2,\"exportedAt\":\"2025-08-16T12:00:00\","
                + "\"tables\":{}}");
        BadRequestException e = assertThrows(BadRequestException.class, () -> restoreService.restore(content));
        assertTrue(e.getMessage().contains("版本不支持"));
        assertNoDelete();
    }

    @Test
    void 备份json解析失败_400且不写库() {
        String content = zipBase64("{这不是合法json");
        BadRequestException e = assertThrows(BadRequestException.class, () -> restoreService.restore(content));
        assertTrue(e.getMessage().contains("JSON 解析失败"));
        assertNoDelete();
    }

    // --- 辅助 ---

    /** 用 BackupExportService.zip 构造一份自定义 JSON 的 zip 并 Base64（同包可见 package-private zip）。 */
    private String zipBase64(String json) {
        return Base64.getEncoder().encodeToString(
                BackupExportService.zip(json.getBytes(StandardCharsets.UTF_8)));
    }

    /** 校验失败链路：不应调用任何 deleteAll（库不变）。 */
    private void assertNoDelete() {
        verify(workspaceMapper, never()).deleteAll();
        verify(mindmapMapper, never()).deleteAll();
        verify(sessionMapper, never()).deleteAll();
        verify(entryMapper, never()).deleteAll();
        verify(tagMapper, never()).deleteAll();
        verify(entryTagMapper, never()).deleteAll();
        verify(entryCommitMapper, never()).deleteAll();
        verify(nodeEntryMapper, never()).deleteAll();
        verify(settingMapper, never()).deleteAll();
    }
}
