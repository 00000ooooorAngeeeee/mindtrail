package com.trailmind.backend.service;

import com.trailmind.backend.common.NotFoundException;
import com.trailmind.backend.entity.Entry;
import com.trailmind.backend.entity.Session;
import com.trailmind.backend.entity.Workspace;
import com.trailmind.backend.repository.SessionMapper;
import com.trailmind.backend.repository.WorkspaceMapper;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.time.LocalDateTime;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.Mockito.when;

/**
 * 会话 Markdown 导出单测（docs/06 §4 协议，M3 任务四）：
 * frontmatter 字段与引号转义、条目分隔符「## [type] HH:mm · 类型名」、git/标签元数据行、空值语义。
 * 完整「导出→解析→比对」往返由 scripts 解析器 + verify.mjs 实机断言覆盖（06 §9 导出一致性）。
 */
@ExtendWith(MockitoExtension.class)
class SessionExportServiceTest {

    private static final String H1 = "1".repeat(40);
    private static final String H2 = "2".repeat(40);

    @Mock
    private SessionMapper sessionMapper;
    @Mock
    private WorkspaceMapper workspaceMapper;
    @Mock
    private EntryService entryService;

    @InjectMocks
    private SessionExportService service;

    private Session session() {
        Session s = new Session();
        s.setId(7L);
        s.setWorkspaceId(3L);
        s.setTitle("从 0 到 1 搭建 TrailMind 骨架");
        s.setStatus("completed");
        s.setRepoPath("D:/projects/trailmind");
        s.setStartHead(H1);
        s.setEndHead(H2);
        s.setStartedAt(LocalDateTime.of(2025, 6, 1, 9, 0, 0));
        s.setEndedAt(LocalDateTime.of(2025, 6, 1, 11, 30, 0));
        return s;
    }

    private Entry entry(Long id, int seq, String type, String content, List<String> tags, List<String> commits) {
        Entry e = new Entry();
        e.setId(id);
        e.setSessionId(7L);
        e.setSeq(seq);
        e.setType(type);
        e.setContentMd(content);
        e.setTags(tags);
        e.setCommits(commits);
        e.setCreatedAt(LocalDateTime.of(2025, 6, 1, 9, seq * 5, 0));
        return e;
    }

    @Test
    void export_frontmatter_and_entries_follow_protocol() {
        when(sessionMapper.selectById(7L)).thenReturn(session());
        when(workspaceMapper.selectById(3L)).thenAnswer(inv -> {
            Workspace ws = new Workspace();
            ws.setId(3L);
            ws.setName("TrailMind");
            return ws;
        });
        when(entryService.page(7L, 1, 100_000)).thenReturn(new EntryService.EntryPage(List.of(
                entry(11L, 1, "goal", "搭建可运行的前后端骨架", List.of(), List.of()),
                entry(12L, 2, "action", "初始化 Spring Boot 工程", List.of("技术选型", "后端"), List.of(H1)),
                entry(13L, 3, "decision", "选 React Flow 而非自研 canvas", List.of(), List.of(H1, H2))), 3));

        String md = service.exportMarkdown(7L);

        // frontmatter：格式标识 + 字段 + 完整 hash（06 §4 解析规则 1/5）
        assertTrue(md.startsWith("---\nformat: trailmind-session\nversion: 1\nsession:\n"), "frontmatter 头应为协议格式");
        assertTrue(md.contains("  title: \"从 0 到 1 搭建 TrailMind 骨架\"\n"));
        assertTrue(md.contains("  status: completed\n"));
        assertTrue(md.contains("  workspace: \"TrailMind\"\n"));
        assertTrue(md.contains("  startedAt: \"2025-06-01T09:00\"\n"));
        assertTrue(md.contains("  endedAt: \"2025-06-01T11:30\"\n"));
        assertTrue(md.contains("  repoPath: \"D:/projects/trailmind\"\n"));
        assertTrue(md.contains("  gitRange: [\"" + H1 + "\", \"" + H2 + "\"]\n"));
        assertTrue(md.contains("entries: 3\n---\n\n# 会话：从 0 到 1 搭建 TrailMind 骨架\n"));

        // 条目分隔符 + 类型名（解析规则 2）
        assertTrue(md.contains("## [goal] 09:05 · 目标\n搭建可运行的前后端骨架\n"));
        assertTrue(md.contains("## [action] 09:10 · 操作\n初始化 Spring Boot 工程\n"));
        assertTrue(md.contains("## [decision] 09:15 · 决策\n选 React Flow 而非自研 canvas\n"));

        // 元数据行（解析规则 3）：git 行 + 标签行；多 commit 一行一条
        assertTrue(md.contains("> git: `" + H1 + "`\n"));
        assertTrue(md.contains("> git: `" + H2 + "`\n"));
        assertTrue(md.contains("> 标签：`技术选型` `后端`\n"));
    }

    @Test
    void export_nullable_fields_emit_null_and_content_newline_normalized() {
        Session s = session();
        s.setRepoPath(null);
        s.setStartHead(null);
        s.setEndHead(null);
        s.setEndedAt(null);
        when(sessionMapper.selectById(7L)).thenReturn(s);
        when(workspaceMapper.selectById(3L)).thenReturn(null);
        when(entryService.page(7L, 1, 100_000)).thenReturn(new EntryService.EntryPage(List.of(
                entry(11L, 1, "note", "无换行结尾", List.of(), List.of()),
                entry(12L, 2, "note", "带换行结尾\n", List.of(), List.of())), 2));

        String md = service.exportMarkdown(7L);

        assertTrue(md.contains("  workspace: null\n"));
        assertTrue(md.contains("  endedAt: null\n"));
        assertTrue(md.contains("  repoPath: null\n"));
        assertTrue(md.contains("  gitRange: [null, null]\n"));
        // 内容无换行结尾时补一个换行，避免与元数据行粘连
        assertTrue(md.contains("## [note] 09:05 · 备注\n无换行结尾\n\n"));
        assertTrue(md.contains("## [note] 09:10 · 备注\n带换行结尾\n\n"));
    }

    @Test
    void export_escapes_yaml_special_chars() {
        Session s = session();
        s.setTitle("标题含 \"引号\" 与 \\ 反斜杠");
        when(sessionMapper.selectById(7L)).thenReturn(s);
        when(workspaceMapper.selectById(3L)).thenReturn(null);
        when(entryService.page(7L, 1, 100_000)).thenReturn(new EntryService.EntryPage(List.of(), 0));

        String md = service.exportMarkdown(7L);

        assertTrue(md.contains("  title: \"标题含 \\\"引号\\\" 与 \\\\ 反斜杠\"\n"));
        assertTrue(md.contains("entries: 0\n"));
    }

    @Test
    void export_session_not_found_throws() {
        when(sessionMapper.selectById(99L)).thenReturn(null);
        assertThrows(NotFoundException.class, () -> service.exportMarkdown(99L));
    }

    @Test
    void export_unknown_type_label_falls_back_to_raw_type() {
        when(sessionMapper.selectById(7L)).thenReturn(session());
        when(workspaceMapper.selectById(3L)).thenReturn(null);
        Entry weird = entry(11L, 1, "todo", "内容", List.of(), List.of());
        when(entryService.page(7L, 1, 100_000)).thenReturn(new EntryService.EntryPage(List.of(weird), 1));

        assertEquals(true, service.exportMarkdown(7L).contains("## [todo] 09:05 · todo\n"));
    }
}
