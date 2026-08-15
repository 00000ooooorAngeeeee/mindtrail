package com.trailmind.backend.service;

import com.trailmind.backend.common.BadRequestException;
import com.trailmind.backend.common.NotFoundException;
import com.trailmind.backend.entity.Entry;
import com.trailmind.backend.entity.EntryTag;
import com.trailmind.backend.entity.Session;
import com.trailmind.backend.entity.Tag;
import com.trailmind.backend.repository.EntryMapper;
import com.trailmind.backend.repository.EntryTagMapper;
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
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * 条目服务单测（docs/07 §6 任务一）：seq 事务分配（05 §5 MAX(seq)+1）、类型枚举校验、
 * 已结束会话仅可追加 review/note、编辑与标签重建、级联删除、分页标签回填。
 */
@ExtendWith(MockitoExtension.class)
class EntryServiceTest {

    @Mock
    private EntryMapper entryMapper;
    @Mock
    private SessionMapper sessionMapper;
    @Mock
    private TagMapper tagMapper;
    @Mock
    private EntryTagMapper entryTagMapper;

    @InjectMocks
    private EntryService service;

    private Session session(String status) {
        Session s = new Session();
        s.setId(7L);
        s.setWorkspaceId(3L);
        s.setStatus(status);
        return s;
    }

    private EntryTagMapper.TagName tagName(Long entryId, String name) {
        EntryTagMapper.TagName t = new EntryTagMapper.TagName();
        t.setEntryId(entryId);
        t.setName(name);
        return t;
    }

    @Test
    void add_assigns_seq_and_links_deduped_trimmed_tags() {
        when(sessionMapper.selectById(7L)).thenReturn(session("active"));
        when(entryMapper.nextSeq(7L)).thenReturn(4);
        when(tagMapper.selectByWorkspaceAndName(3L, "技术选型")).thenReturn(null);
        when(tagMapper.selectByWorkspaceAndName(3L, "前端")).thenReturn(null);

        Entry e = service.add(7L, "action", "  做了 X  ", List.of("技术选型", " 技术选型 ", "  ", "前端"));

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

        assertEquals(1, service.add(7L, "goal", "目标", null).getSeq());
    }

    @Test
    void add_session_not_found_throws() {
        when(sessionMapper.selectById(99L)).thenReturn(null);
        assertThrows(NotFoundException.class, () -> service.add(99L, "note", "内容", null));
        verify(entryMapper, never()).insert(any(Entry.class));
    }

    @Test
    void add_invalid_type_throws() {
        when(sessionMapper.selectById(7L)).thenReturn(session("active"));
        assertThrows(BadRequestException.class, () -> service.add(7L, "todo", "内容", null));
        verify(entryMapper, never()).insert(any(Entry.class));
    }

    @Test
    void add_blank_content_throws() {
        when(sessionMapper.selectById(7L)).thenReturn(session("active"));
        assertThrows(BadRequestException.class, () -> service.add(7L, "note", "   ", null));
    }

    @Test
    void add_completed_session_allows_review_and_note_only() {
        when(sessionMapper.selectById(7L)).thenReturn(session("completed"));
        when(entryMapper.nextSeq(7L)).thenReturn(5);

        assertThrows(BadRequestException.class, () -> service.add(7L, "action", "内容", null));
        assertEquals("review", service.add(7L, "review", "复盘", null).getType());
        assertEquals("note", service.add(7L, "note", "备注", null).getType());
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

        EntryService.EntryPage page = service.page(7L, 2, 50);

        assertEquals(95L, page.total());
        assertEquals(List.of("A", "B"), e1.getTags());
        assertEquals(List.of("C"), e2.getTags());
    }

    @Test
    void page_offset_is_calculated_from_page_and_size() {
        when(entryMapper.listBySession(7L, 150, 75)).thenReturn(List.of());
        when(entryMapper.countBySession(7L)).thenReturn(0L);
        when(entryTagMapper.selectTagNamesBySession(7L)).thenReturn(List.of());

        service.page(7L, 3, 75);

        verify(entryMapper).listBySession(7L, 150, 75);
    }
}
