package com.trailmind.backend.service;

import com.trailmind.backend.common.BadRequestException;
import com.trailmind.backend.common.ConflictException;
import com.trailmind.backend.common.NotFoundException;
import com.trailmind.backend.entity.Entry;
import com.trailmind.backend.entity.Session;
import com.trailmind.backend.entity.Workspace;
import com.trailmind.backend.git.GitHeadReader;
import com.trailmind.backend.repository.EntryMapper;
import com.trailmind.backend.repository.SessionMapper;
import com.trailmind.backend.repository.WorkspaceMapper;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertSame;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * 会话服务单测（docs/07 §6 任务一）：创建（默认继承工作区仓库 + start_head）、结束（end_head + review 条目）、
 * 更新校验、级联删除、详情分页。
 */
@ExtendWith(MockitoExtension.class)
class SessionServiceTest {

    @Mock
    private SessionMapper sessionMapper;
    @Mock
    private WorkspaceMapper workspaceMapper;
    @Mock
    private EntryMapper entryMapper;
    @Mock
    private EntryService entryService;
    @Mock
    private GitHeadReader gitHeadReader;

    @InjectMocks
    private SessionService service;

    private Workspace workspaceWithRepo() {
        Workspace w = new Workspace();
        w.setId(1L);
        w.setRepoPath("D:/repo");
        return w;
    }

    private Session activeSession() {
        Session s = new Session();
        s.setId(10L);
        s.setWorkspaceId(1L);
        s.setTitle("会话");
        s.setStatus("active");
        s.setRepoPath("D:/repo");
        return s;
    }

    @Test
    void create_uses_workspace_repo_and_records_start_head() {
        when(workspaceMapper.selectById(1L)).thenReturn(workspaceWithRepo());
        when(gitHeadReader.readHead("D:/repo")).thenReturn("a".repeat(40));

        Session created = service.create(1L, "  新会话  ", null);

        assertEquals("新会话", created.getTitle());
        assertEquals("D:/repo", created.getRepoPath());
        assertEquals("a".repeat(40), created.getStartHead());
        assertEquals("active", created.getStatus());
        verify(sessionMapper).insert(any(Session.class));
    }

    @Test
    void create_explicit_repo_overrides_workspace_repo() {
        when(workspaceMapper.selectById(1L)).thenReturn(workspaceWithRepo());
        when(gitHeadReader.readHead("E:/other")).thenReturn(null);

        Session created = service.create(1L, "会话", "E:/other");

        assertEquals("E:/other", created.getRepoPath());
        assertNull(created.getStartHead());
    }

    @Test
    void create_without_repo_has_null_start_head() {
        Workspace w = new Workspace();
        w.setId(1L);
        when(workspaceMapper.selectById(1L)).thenReturn(w);

        Session created = service.create(1L, "会话", null);

        assertNull(created.getRepoPath());
        assertNull(created.getStartHead());
        verify(gitHeadReader, never()).readHead(anyString());
    }

    @Test
    void create_workspace_not_found_throws() {
        when(workspaceMapper.selectById(99L)).thenReturn(null);
        assertThrows(NotFoundException.class, () -> service.create(99L, "会话", null));
        verify(sessionMapper, never()).insert(any(Session.class));
    }

    @Test
    void create_blank_title_throws() {
        when(workspaceMapper.selectById(1L)).thenReturn(workspaceWithRepo());
        assertThrows(BadRequestException.class, () -> service.create(1L, "  ", null));
    }

    @Test
    void create_title_too_long_throws() {
        when(workspaceMapper.selectById(1L)).thenReturn(workspaceWithRepo());
        assertThrows(BadRequestException.class, () -> service.create(1L, "a".repeat(201), null));
    }

    @Test
    void create_invalid_repo_throws_and_does_not_insert() {
        when(workspaceMapper.selectById(1L)).thenReturn(workspaceWithRepo());
        when(gitHeadReader.readHead("D:/repo")).thenThrow(new BadRequestException("仓库路径无效"));

        assertThrows(BadRequestException.class, () -> service.create(1L, "会话", null));
        verify(sessionMapper, never()).insert(any(Session.class));
    }

    @Test
    void get_not_found_throws() {
        when(sessionMapper.selectById(9L)).thenReturn(null);
        assertThrows(NotFoundException.class, () -> service.get(9L));
    }

    @Test
    void list_delegates_to_mapper() {
        when(sessionMapper.listByWorkspace(1L)).thenReturn(List.of(activeSession()));
        assertEquals(1, service.list(1L).size());
    }

    @Test
    void complete_records_end_head_appends_review_and_summary() {
        Session s = activeSession();
        when(sessionMapper.selectById(10L)).thenReturn(s);
        when(gitHeadReader.readHead("D:/repo")).thenReturn("b".repeat(40));

        Session result = service.update(10L, null, "completed", " 总结 ");

        assertEquals("completed", s.getStatus());
        assertEquals("b".repeat(40), s.getEndHead());
        assertNotNull(s.getEndedAt());
        assertEquals("总结", s.getSummary());
        verify(entryService).add(10L, "review", "总结", List.of(), List.of());
        verify(sessionMapper).updateById(s);
        assertSame(s, result);
    }

    @Test
    void complete_without_summary_skips_review_entry() {
        Session s = activeSession();
        when(sessionMapper.selectById(10L)).thenReturn(s);
        when(gitHeadReader.readHead("D:/repo")).thenReturn(null);

        service.update(10L, null, "completed", null);

        assertEquals("completed", s.getStatus());
        assertNull(s.getEndHead());
        assertNull(s.getSummary());
        verify(entryService, never()).add(anyLong(), anyString(), anyString(), anyList(), anyList());
    }

    @Test
    void complete_already_completed_throws() {
        Session s = activeSession();
        s.setStatus("completed");
        when(sessionMapper.selectById(10L)).thenReturn(s);

        assertThrows(ConflictException.class, () -> service.update(10L, null, "completed", null));
        verify(sessionMapper, never()).updateById(any(Session.class));
    }

    @Test
    void update_invalid_status_throws() {
        Session s = activeSession();
        when(sessionMapper.selectById(10L)).thenReturn(s);
        assertThrows(BadRequestException.class, () -> service.update(10L, null, "deleted", null));
    }

    @Test
    void update_rename_trims_and_validates_title() {
        Session s = activeSession();
        when(sessionMapper.selectById(10L)).thenReturn(s);

        service.update(10L, "  新标题 ", null, null);

        assertEquals("新标题", s.getTitle());
        verify(sessionMapper).updateById(s);
    }

    @Test
    void update_blank_title_throws_and_does_not_persist() {
        Session s = activeSession();
        when(sessionMapper.selectById(10L)).thenReturn(s);

        assertThrows(BadRequestException.class, () -> service.update(10L, "  ", null, null));
        verify(sessionMapper, never()).updateById(any(Session.class));
    }

    @Test
    void delete_cascades_entries_before_session() {
        when(sessionMapper.selectById(10L)).thenReturn(activeSession());

        service.delete(10L);

        // 级联顺序：关联表 → 条目 → 会话本身（05 §3 service 层显式处理）
        verify(entryMapper).deleteEntryTagsBySession(10L);
        verify(entryMapper).deleteEntryCommitsBySession(10L);
        verify(entryMapper).deleteBySession(10L);
        verify(sessionMapper).deleteById(10L);
    }

    @Test
    void delete_not_found_throws_and_skips_cascade() {
        when(sessionMapper.selectById(9L)).thenReturn(null);

        assertThrows(NotFoundException.class, () -> service.delete(9L));
        verify(entryMapper, never()).deleteBySession(anyLong());
        verify(sessionMapper, never()).deleteById(anyLong());
    }

    @Test
    void detail_loads_paged_entries() {
        when(sessionMapper.selectById(10L)).thenReturn(activeSession());
        List<Entry> entries = List.of(new Entry());
        when(entryService.page(10L, 2, 50)).thenReturn(new EntryService.EntryPage(entries, 120L));

        Session detail = service.detail(10L, 2, 50);

        assertSame(entries, detail.getEntries());
        assertEquals(120L, detail.getEntryTotal());
    }

    @Test
    void detail_clamps_page_and_size() {
        when(sessionMapper.selectById(10L)).thenReturn(activeSession());
        when(entryService.page(10L, 1, 100)).thenReturn(new EntryService.EntryPage(List.of(), 0L));

        service.detail(10L, -3, 999);

        verify(entryService).page(10L, 1, 100);
    }
}
