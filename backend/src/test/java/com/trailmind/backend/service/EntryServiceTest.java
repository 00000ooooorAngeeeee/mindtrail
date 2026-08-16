package com.trailmind.backend.service;

import com.trailmind.backend.common.BadRequestException;
import com.trailmind.backend.common.NotFoundException;
import com.trailmind.backend.entity.Entry;
import com.trailmind.backend.entity.EntryCommit;
import com.trailmind.backend.entity.EntryTag;
import com.trailmind.backend.entity.Session;
import com.trailmind.backend.entity.Tag;
import com.trailmind.backend.git.GitRepoService;
import com.trailmind.backend.repository.EntryCommitMapper;
import com.trailmind.backend.repository.EntryMapper;
import com.trailmind.backend.repository.EntryTagMapper;
import com.trailmind.backend.repository.NodeEntryMapper;
import com.trailmind.backend.repository.SessionMapper;
import com.trailmind.backend.repository.TagMapper;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * 条目服务单测（docs/07 §6 任务一 + 任务三 + v1.1 C2.4/C2.5）：seq 事务分配（05 §5 MAX(seq)+1）、
 * 插入位置（afterSeq 重排：中间/最前/末尾等价/非法 400，PRD C2.5）、补记时间（createdAt 追加与编辑，PRD C2.4）、
 * 类型枚举校验、已结束会话仅可追加 review/note、编辑与标签重建、级联删除、分页标签/提交回填、
 * 绑定/解绑（hash 格式校验、仓库存在性校验、幂等去重、会话无仓库拒绝）。
 */
@ExtendWith(MockitoExtension.class)
class EntryServiceTest {

    private static final String H1 = "1".repeat(40);
    private static final String H2 = "2".repeat(40);

    @Mock
    private EntryMapper entryMapper;
    @Mock
    private SessionMapper sessionMapper;
    @Mock
    private TagMapper tagMapper;
    @Mock
    private EntryTagMapper entryTagMapper;
    @Mock
    private EntryCommitMapper entryCommitMapper;
    @Mock
    private NodeEntryMapper nodeEntryMapper;
    @Mock
    private GitRepoService gitRepoService;

    @InjectMocks
    private EntryService service;

    private Session session(String status) {
        Session s = new Session();
        s.setId(7L);
        s.setWorkspaceId(3L);
        s.setStatus(status);
        return s;
    }

    private Session sessionWithRepo(String status) {
        Session s = session(status);
        s.setRepoPath("D:/repo");
        return s;
    }

    private EntryTagMapper.TagName tagName(Long entryId, String name) {
        EntryTagMapper.TagName t = new EntryTagMapper.TagName();
        t.setEntryId(entryId);
        t.setName(name);
        return t;
    }

    private EntryCommitMapper.CommitRow commitRow(Long entryId, String hash) {
        EntryCommitMapper.CommitRow r = new EntryCommitMapper.CommitRow();
        r.setEntryId(entryId);
        r.setCommitHash(hash);
        r.setRepoPath("D:/repo");
        return r;
    }

    @Test
    void add_assigns_seq_and_links_deduped_trimmed_tags() {
        when(sessionMapper.selectById(7L)).thenReturn(session("active"));
        when(entryMapper.nextSeq(7L)).thenReturn(4);
        when(tagMapper.selectByWorkspaceAndName(3L, "技术选型")).thenReturn(null);
        when(tagMapper.selectByWorkspaceAndName(3L, "前端")).thenReturn(null);

        Entry e = service.add(7L, "action", "  做了 X  ", List.of("技术选型", " 技术选型 ", "  ", "前端"), List.of());

        assertEquals(4, e.getSeq());
        assertEquals("action", e.getType());
        assertEquals("  做了 X  ", e.getContentMd());
        assertEquals(List.of("技术选型", "前端"), e.getTags());
        verify(entryMapper).insert(any(Entry.class));
        verify(tagMapper, times(2)).insert(any(Tag.class));
        verify(entryTagMapper, times(2)).insert(any(EntryTag.class));
    }

    @Test
    void add_first_entry_gets_seq_1() {
        when(sessionMapper.selectById(7L)).thenReturn(session("active"));
        when(entryMapper.nextSeq(7L)).thenReturn(1);

        assertEquals(1, service.add(7L, "goal", "目标", null, List.of()).getSeq());
    }

    @Test
    void add_session_not_found_throws() {
        when(sessionMapper.selectById(99L)).thenReturn(null);
        assertThrows(NotFoundException.class, () -> service.add(99L, "note", "内容", null, List.of()));
        verify(entryMapper, never()).insert(any(Entry.class));
    }

    @Test
    void add_invalid_type_throws() {
        when(sessionMapper.selectById(7L)).thenReturn(session("active"));
        assertThrows(BadRequestException.class, () -> service.add(7L, "todo", "内容", null, List.of()));
        verify(entryMapper, never()).insert(any(Entry.class));
    }

    @Test
    void add_blank_content_throws() {
        when(sessionMapper.selectById(7L)).thenReturn(session("active"));
        assertThrows(BadRequestException.class, () -> service.add(7L, "note", "   ", null, List.of()));
    }

    @Test
    void add_completed_session_allows_review_and_note_only() {
        when(sessionMapper.selectById(7L)).thenReturn(session("completed"));
        when(entryMapper.nextSeq(7L)).thenReturn(5);

        assertThrows(BadRequestException.class, () -> service.add(7L, "action", "内容", null, List.of()));
        assertEquals("review", service.add(7L, "review", "复盘", null, List.of()).getType());
        assertEquals("note", service.add(7L, "note", "备注", null, List.of()).getType());
        verify(entryMapper, times(2)).insert(any(Entry.class));
    }

    @Test
    void update_content_only_keeps_tags_untouched() {
        Entry e = new Entry();
        e.setId(5L);
        e.setSessionId(7L);
        e.setContentMd("旧内容");
        e.setType("note");
        when(entryMapper.selectById(5L)).thenReturn(e);
        when(entryTagMapper.selectNamesByEntry(5L)).thenReturn(List.of("前端"));

        Entry updated = service.update(5L, "新内容", null, null);

        assertEquals("新内容", updated.getContentMd());
        assertEquals(List.of("前端"), updated.getTags());
        verify(entryTagMapper, never()).deleteByEntry(anyLong());
        verify(entryMapper).updateById(e);
    }

    @Test
    void update_rebuilds_tags_and_creates_new_tag() {
        Entry e = new Entry();
        e.setId(5L);
        e.setSessionId(7L);
        when(entryMapper.selectById(5L)).thenReturn(e);
        when(sessionMapper.selectById(7L)).thenReturn(session("active"));
        when(tagMapper.selectByWorkspaceAndName(3L, "架构")).thenReturn(null);
        when(entryTagMapper.selectNamesByEntry(5L)).thenReturn(List.of("架构"));

        Entry updated = service.update(5L, null, null, List.of("架构"));

        assertEquals(List.of("架构"), updated.getTags());
        verify(entryTagMapper).deleteByEntry(5L);
        verify(tagMapper).insert(any(Tag.class));
        verify(entryTagMapper).insert(any(EntryTag.class));
    }

    @Test
    void update_not_found_throws() {
        when(entryMapper.selectById(9L)).thenReturn(null);
        assertThrows(NotFoundException.class, () -> service.update(9L, "内容", null, null));
    }

    @Test
    void update_invalid_type_throws_and_does_not_persist() {
        Entry e = new Entry();
        e.setId(5L);
        when(entryMapper.selectById(5L)).thenReturn(e);

        assertThrows(BadRequestException.class, () -> service.update(5L, null, "todo", null));
        verify(entryMapper, never()).updateById(any(Entry.class));
    }

    @Test
    void update_blank_content_throws_and_does_not_persist() {
        Entry e = new Entry();
        e.setId(5L);
        when(entryMapper.selectById(5L)).thenReturn(e);

        assertThrows(BadRequestException.class, () -> service.update(5L, "  ", null, null));
        verify(entryMapper, never()).updateById(any(Entry.class));
    }

    @Test
    void delete_cascades_links_before_entry() {
        when(entryMapper.selectById(5L)).thenReturn(new Entry());

        service.delete(5L);

        verify(entryMapper).deleteEntryTagsByEntry(5L);
        verify(entryMapper).deleteEntryCommitsByEntry(5L);
        verify(nodeEntryMapper).deleteByEntry(5L); // v1.1 联动级联：条目删除清其节点引用
        verify(entryMapper).deleteById(5L);
    }

    @Test
    void delete_not_found_throws_and_skips_cascade() {
        when(entryMapper.selectById(9L)).thenReturn(null);

        assertThrows(NotFoundException.class, () -> service.delete(9L));
        verify(entryMapper, never()).deleteEntryTagsByEntry(anyLong());
        verify(entryMapper, never()).deleteById(anyLong());
    }

    @Test
    void page_groups_tags_by_entry_and_counts_total() {
        Entry e1 = new Entry();
        e1.setId(11L);
        Entry e2 = new Entry();
        e2.setId(12L);
        when(entryMapper.listBySession(7L, 50, 50)).thenReturn(List.of(e1, e2));
        when(entryMapper.countBySession(7L)).thenReturn(95L);
        when(entryTagMapper.selectTagNamesBySession(7L))
                .thenReturn(List.of(tagName(11L, "A"), tagName(11L, "B"), tagName(12L, "C")));
        when(entryCommitMapper.selectBySession(7L)).thenReturn(List.of());

        EntryService.EntryPage page = service.page(7L, 2, 50);

        assertEquals(95L, page.total());
        assertEquals(List.of("A", "B"), e1.getTags());
        assertEquals(List.of("C"), e2.getTags());
    }

    @Test
    void page_backfills_bound_commits_by_entry() {
        Entry e1 = new Entry();
        e1.setId(11L);
        when(entryMapper.listBySession(7L, 0, 50)).thenReturn(List.of(e1));
        when(entryMapper.countBySession(7L)).thenReturn(1L);
        when(entryTagMapper.selectTagNamesBySession(7L)).thenReturn(List.of());
        when(entryCommitMapper.selectBySession(7L))
                .thenReturn(List.of(commitRow(11L, H1), commitRow(11L, H2)));

        EntryService.EntryPage page = service.page(7L, 1, 50);

        assertEquals(List.of(H1, H2), page.entries().get(0).getCommits());
    }

    @Test
    void page_offset_is_calculated_from_page_and_size() {
        when(entryMapper.listBySession(7L, 150, 75)).thenReturn(List.of());
        when(entryMapper.countBySession(7L)).thenReturn(0L);
        when(entryTagMapper.selectTagNamesBySession(7L)).thenReturn(List.of());
        when(entryCommitMapper.selectBySession(7L)).thenReturn(List.of());

        service.page(7L, 3, 75);

        verify(entryMapper).listBySession(7L, 150, 75);
    }

    // ---------- 插入位置与补记时间（v1.1 P1，PRD C2.5 / C2.4） ----------

    /** 捕获 insert 参数并回填自增 id 的 Answer。 */
    private org.mockito.stubbing.Answer<Integer> insertWithId(Long id) {
        return inv -> {
            ((Entry) inv.getArgument(0)).setId(id);
            return 1;
        };
    }

    private void mockActiveSession() {
        when(sessionMapper.selectById(7L)).thenReturn(session("active"));
    }

    @Test
    void add_insert_after_seq_shifts_subsequent_entries() {
        mockActiveSession();
        when(entryMapper.maxSeq(7L)).thenReturn(3);
        org.mockito.Mockito.doAnswer(insertWithId(9L)).when(entryMapper).insert(any(Entry.class));

        Entry e = service.add(7L, "test", "插入的验证", List.of(), List.of(), 1, null);

        assertEquals(2, e.getSeq()); // 插入到 seq 1 之后 → 新条目 seq=2
        verify(entryMapper).shiftSeq(7L, 1); // 原 seq 2/3 → 3/4
        verify(entryMapper).insert(any(Entry.class));
    }

    @Test
    void add_insert_at_top_shifts_all_entries() {
        mockActiveSession();
        when(entryMapper.maxSeq(7L)).thenReturn(3);
        org.mockito.Mockito.doAnswer(insertWithId(9L)).when(entryMapper).insert(any(Entry.class));

        Entry e = service.add(7L, "note", "补在最前", List.of(), List.of(), 0, null);

        assertEquals(1, e.getSeq()); // afterSeq=0 → 最前
        verify(entryMapper).shiftSeq(7L, 0);
    }

    @Test
    void add_insert_after_last_is_append_equivalent() {
        mockActiveSession();
        when(entryMapper.maxSeq(7L)).thenReturn(3);

        Entry e = service.add(7L, "note", "末尾插入", List.of(), List.of(), 3, null);

        assertEquals(4, e.getSeq()); // afterSeq == max → 追加效果
        verify(entryMapper).shiftSeq(7L, 3); // 无 seq>3 的条目，重排为空操作
        verify(entryMapper, never()).nextSeq(anyLong());
    }

    @Test
    void add_insert_invalid_after_seq_throws_without_mutation() {
        mockActiveSession();
        when(entryMapper.maxSeq(7L)).thenReturn(3);

        assertThrows(BadRequestException.class, () -> service.add(7L, "note", "x", null, List.of(), -1, null));
        assertThrows(BadRequestException.class, () -> service.add(7L, "note", "x", null, List.of(), 5, null));

        verify(entryMapper, never()).shiftSeq(anyLong(), anyInt());
        verify(entryMapper, never()).insert(any(Entry.class));
    }

    @Test
    void add_with_created_at_backfills_time() {
        mockActiveSession();
        when(entryMapper.nextSeq(7L)).thenReturn(4);
        org.mockito.Mockito.doAnswer(insertWithId(9L)).when(entryMapper).insert(any(Entry.class));

        Entry e = service.add(7L, "action", "补录动作", List.of(), List.of(), null,
                java.time.LocalDateTime.of(2026, 1, 2, 3, 4, 5));

        assertEquals(java.time.LocalDateTime.of(2026, 1, 2, 3, 4, 5), e.getCreatedAt());
    }

    @Test
    void add_without_created_at_keeps_null_for_db_default() {
        mockActiveSession();
        when(entryMapper.nextSeq(7L)).thenReturn(1);
        org.mockito.Mockito.doAnswer(insertWithId(9L)).when(entryMapper).insert(any(Entry.class));

        Entry e = service.add(7L, "goal", "目标", null, List.of());

        assertEquals(null, e.getCreatedAt()); // 入库走 DEFAULT CURRENT_TIMESTAMP
    }

    @Test
    void update_with_created_at_backfills_time() {
        Entry e = new Entry();
        e.setId(5L);
        e.setSessionId(7L);
        e.setContentMd("旧内容");
        when(entryMapper.selectById(5L)).thenReturn(e);
        when(entryTagMapper.selectNamesByEntry(5L)).thenReturn(List.of());

        Entry updated = service.update(5L, null, null, null, java.time.LocalDateTime.of(2026, 2, 3, 4, 5, 6));

        assertEquals(java.time.LocalDateTime.of(2026, 2, 3, 4, 5, 6), updated.getCreatedAt());
        verify(entryMapper).updateById(e);
    }

    @Test
    void update_without_created_at_keeps_original_time() {
        Entry e = new Entry();
        e.setId(5L);
        e.setSessionId(7L);
        e.setCreatedAt(java.time.LocalDateTime.of(2026, 1, 1, 0, 0, 0));
        when(entryMapper.selectById(5L)).thenReturn(e);
        when(entryTagMapper.selectNamesByEntry(5L)).thenReturn(List.of());

        Entry updated = service.update(5L, "新内容", null, null);

        assertEquals(java.time.LocalDateTime.of(2026, 1, 1, 0, 0, 0), updated.getCreatedAt()); // 未传 createdAt 不改时间
        verify(entryMapper).updateById(e);
    }

    // ---------- Git 绑定（M3 任务三） ----------

    @Test
    void add_with_commit_hashes_binds_and_backfills() {
        when(sessionMapper.selectById(7L)).thenReturn(sessionWithRepo("active"));
        when(entryMapper.nextSeq(7L)).thenReturn(3);
        // 模拟 MyBatis-Plus insert 回填自增 id（keyProperty 行为）
        org.mockito.stubbing.Answer<Integer> fillId = inv -> {
            ((Entry) inv.getArgument(0)).setId(5L);
            return 1;
        };
        org.mockito.Mockito.doAnswer(fillId).when(entryMapper).insert(any(Entry.class));
        when(entryMapper.selectById(5L)).thenAnswer(inv -> {
            Entry e = new Entry();
            e.setId(5L);
            e.setSessionId(7L);
            return e;
        });
        when(entryCommitMapper.selectHashesByEntry(5L)).thenReturn(List.of());
        when(gitRepoService.hasCommit("D:/repo", H1)).thenReturn(true);

        Entry e = service.add(7L, "artifact", "产出", List.of(), List.of(H1));

        assertEquals(List.of(H1), e.getCommits());
        verify(entryCommitMapper).insert(any(EntryCommit.class));
    }

    @Test
    void bind_validates_hash_format_and_repo() {
        when(entryMapper.selectById(5L)).thenAnswer(inv -> {
            Entry e = new Entry();
            e.setId(5L);
            e.setSessionId(7L);
            return e;
        });

        // 会话无仓库 → 400
        when(sessionMapper.selectById(7L)).thenReturn(session("active"));
        assertThrows(BadRequestException.class, () -> service.bind(5L, List.of(H1)));

        // 非法 hash 格式 → 400
        when(sessionMapper.selectById(7L)).thenReturn(sessionWithRepo("active"));
        assertThrows(BadRequestException.class, () -> service.bind(5L, List.of("xyz")));

        // 仓库中不存在的提交 → 400（08 §10.6 防造假）
        when(gitRepoService.hasCommit("D:/repo", H1)).thenReturn(false);
        assertThrows(BadRequestException.class, () -> service.bind(5L, List.of(H1)));
        verify(entryCommitMapper, never()).insert(any(EntryCommit.class));
    }

    @Test
    void bind_normalizes_dedupes_and_skips_existing() {
        when(entryMapper.selectById(5L)).thenAnswer(inv -> {
            Entry e = new Entry();
            e.setId(5L);
            e.setSessionId(7L);
            return e;
        });
        when(sessionMapper.selectById(7L)).thenReturn(sessionWithRepo("active"));
        when(entryCommitMapper.selectHashesByEntry(5L)).thenReturn(List.of(H1)); // 已绑定 H1
        when(gitRepoService.hasCommit("D:/repo", H2)).thenReturn(true);

        List<String> bound = service.bind(5L, List.of(H1, "  " + H2 + "  ", H2));

        assertEquals(List.of(H2), bound); // H1 幂等跳过，H2 去重一次
        verify(entryCommitMapper, times(1)).insert(any(EntryCommit.class));
    }

    @Test
    void bind_skips_verification_when_repo_unreadable() {
        when(entryMapper.selectById(5L)).thenAnswer(inv -> {
            Entry e = new Entry();
            e.setId(5L);
            e.setSessionId(7L);
            return e;
        });
        when(sessionMapper.selectById(7L)).thenReturn(sessionWithRepo("active"));
        when(entryCommitMapper.selectHashesByEntry(5L)).thenReturn(List.of());
        when(gitRepoService.hasCommit("D:/repo", H1))
                .thenThrow(new BadRequestException("路径不是有效的 Git 仓库")); // 仓库已移动

        assertEquals(List.of(H1), service.bind(5L, List.of(H1))); // 无法校验 → 放行（记录不因仓库移动而丢失）
    }

    @Test
    void bind_entry_or_session_not_found_throws() {
        when(entryMapper.selectById(9L)).thenReturn(null);
        assertThrows(NotFoundException.class, () -> service.bind(9L, List.of(H1)));

        when(entryMapper.selectById(5L)).thenAnswer(inv -> {
            Entry e = new Entry();
            e.setId(5L);
            e.setSessionId(7L);
            return e;
        });
        when(sessionMapper.selectById(7L)).thenReturn(null);
        assertThrows(NotFoundException.class, () -> service.bind(5L, List.of(H1)));
    }

    @Test
    void unbind_removes_relation_or_404() {
        when(entryMapper.selectById(5L)).thenReturn(new Entry());
        when(entryCommitMapper.deleteByEntryAndHash(5L, H1)).thenReturn(1);

        service.unbind(5L, "  " + H1 + "  "); // 归一化后删除

        verify(entryCommitMapper).deleteByEntryAndHash(5L, H1);

        when(entryCommitMapper.deleteByEntryAndHash(5L, H2)).thenReturn(0);
        assertThrows(NotFoundException.class, () -> service.unbind(5L, H2));
    }

    @Test
    void unbind_invalid_hash_format_throws() {
        when(entryMapper.selectById(5L)).thenReturn(new Entry());
        assertThrows(BadRequestException.class, () -> service.unbind(5L, "abc"));
        verify(entryCommitMapper, never()).deleteByEntryAndHash(anyLong(), any());
    }

    @Test
    void session_commits_lists_bound_rows() {
        when(sessionMapper.selectById(7L)).thenReturn(session("active"));
        when(entryCommitMapper.selectBySession(7L))
                .thenReturn(List.of(commitRow(11L, H1), commitRow(12L, H2)));

        List<EntryService.BoundCommit> list = service.sessionCommits(7L);

        assertEquals(2, list.size());
        assertEquals(11L, list.get(0).entryId());
        assertEquals(H2, list.get(1).commitHash());
        assertEquals("D:/repo", list.get(1).repoPath());
    }
}
