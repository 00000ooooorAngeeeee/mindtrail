package com.trailmind.backend.service;

import com.trailmind.backend.common.BadRequestException;
import com.trailmind.backend.common.NotFoundException;
import com.trailmind.backend.entity.Tag;
import com.trailmind.backend.repository.EntryTagMapper;
import com.trailmind.backend.repository.TagMapper;
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
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * 标签管理服务单测（M4 任务二，08 §6「关键逻辑补单测」）：
 * 创建校验（空白/超长/工作区重复）、重命名（重复 400、同名幂等跳过写库）、
 * 合并（重挂条目 + 删源 + 自身/跨工作区 400）、删除（先关联后标签）、列表、按标签筛（404/批量回填）。
 */
@ExtendWith(MockitoExtension.class)
class TagServiceTest {

    @Mock
    private TagMapper tagMapper;
    @Mock
    private EntryTagMapper entryTagMapper;
    @Mock
    private WorkspaceMapper workspaceMapper;

    @InjectMocks
    private TagService service;

    private Tag tag(Long id, Long workspaceId, String name) {
        Tag t = new Tag();
        t.setId(id);
        t.setWorkspaceId(workspaceId);
        t.setName(name);
        t.setCreatedAt(LocalDateTime.of(2025, 6, 1, 9, 0));
        return t;
    }

    @Test
    void create_blank_or_tooLong_name_throws_400() {
        when(workspaceMapper.selectById(3L)).thenReturn(new com.trailmind.backend.entity.Workspace());
        assertThrows(BadRequestException.class, () -> service.create(3L, "  "));
        assertThrows(BadRequestException.class, () -> service.create(3L, null));
        assertThrows(BadRequestException.class, () -> service.create(3L, "长".repeat(51)));
        verify(tagMapper, never()).insert(any(Tag.class));
    }

    @Test
    void create_duplicate_name_throws_400() {
        when(workspaceMapper.selectById(3L)).thenReturn(new com.trailmind.backend.entity.Workspace());
        when(tagMapper.selectByWorkspaceAndName(3L, "前端")).thenReturn(tag(9L, 3L, "前端"));
        assertThrows(BadRequestException.class, () -> service.create(3L, "前端"));
        verify(tagMapper, never()).insert(any(Tag.class));
    }

    @Test
    void create_trims_and_inserts() {
        when(workspaceMapper.selectById(3L)).thenReturn(new com.trailmind.backend.entity.Workspace());
        when(tagMapper.selectByWorkspaceAndName(3L, "前端")).thenReturn(null);

        TagService.TagInfo info = service.create(3L, "  前端 ");

        assertEquals("前端", info.name());
        assertEquals(0L, info.entryCount());
        verify(tagMapper).insert(any(Tag.class));
    }

    @Test
    void rename_duplicate_name_throws_400() {
        when(tagMapper.selectById(1L)).thenReturn(tag(1L, 3L, "前端"));
        when(tagMapper.selectByWorkspaceAndName(3L, "后端")).thenReturn(tag(2L, 3L, "后端"));
        assertThrows(BadRequestException.class, () -> service.rename(1L, "后端"));
        verify(tagMapper, never()).updateById(any(Tag.class));
    }

    @Test
    void rename_sameName_is_idempotent_and_skips_write() {
        when(tagMapper.selectById(1L)).thenReturn(tag(1L, 3L, "前端"));
        when(entryTagMapper.countByTag(1L)).thenReturn(5L);

        TagService.TagInfo info = service.rename(1L, "前端");

        assertEquals("前端", info.name());
        assertEquals(5L, info.entryCount());
        verify(tagMapper, never()).updateById(any(Tag.class));
    }

    @Test
    void rename_updates_name_and_returns_count() {
        when(tagMapper.selectById(1L)).thenReturn(tag(1L, 3L, "前端"));
        when(tagMapper.selectByWorkspaceAndName(3L, "UI")).thenReturn(null);
        when(entryTagMapper.countByTag(1L)).thenReturn(2L);

        TagService.TagInfo info = service.rename(1L, " UI ");

        assertEquals("UI", info.name());
        assertEquals(2L, info.entryCount());
        verify(tagMapper).updateById(any(Tag.class));
    }

    @Test
    void merge_self_or_cross_workspace_throws_400() {
        when(tagMapper.selectById(1L)).thenReturn(tag(1L, 3L, "A"));
        assertThrows(BadRequestException.class, () -> service.merge(1L, 1L));

        when(tagMapper.selectById(2L)).thenReturn(tag(2L, 4L, "B"));
        assertThrows(BadRequestException.class, () -> service.merge(1L, 2L));
        verify(entryTagMapper, never()).retagEntries(anyLong(), anyLong());
    }

    @Test
    void merge_retags_then_deletes_source() {
        when(tagMapper.selectById(1L)).thenReturn(tag(1L, 3L, "旧标签"));
        when(tagMapper.selectById(2L)).thenReturn(tag(2L, 3L, "新标签"));
        when(entryTagMapper.countByTag(2L)).thenReturn(7L);

        TagService.TagInfo info = service.merge(1L, 2L);

        assertEquals(2L, info.id());
        assertEquals(7L, info.entryCount());
        verify(entryTagMapper).retagEntries(1L, 2L);
        verify(entryTagMapper).deleteByTag(1L);
        verify(tagMapper).deleteById(1L);
    }

    @Test
    void delete_clears_links_before_tag() {
        when(tagMapper.selectById(1L)).thenReturn(tag(1L, 3L, "A"));
        service.delete(1L);
        verify(entryTagMapper).deleteByTag(1L);
        verify(tagMapper).deleteById(1L);
    }

    @Test
    void delete_notFound_throws_404() {
        when(tagMapper.selectById(99L)).thenReturn(null);
        assertThrows(NotFoundException.class, () -> service.delete(99L));
        verify(entryTagMapper, never()).deleteByTag(anyLong());
    }

    @Test
    void list_requires_workspace_and_delegates() {
        when(workspaceMapper.selectById(3L)).thenReturn(new com.trailmind.backend.entity.Workspace());
        TagMapper.TagRow row = new TagMapper.TagRow();
        row.setId(1L);
        row.setWorkspaceId(3L);
        row.setName("前端");
        row.setEntryCount(4L);
        when(tagMapper.listByWorkspaceWithCount(3L)).thenReturn(List.of(row));

        List<TagService.TagInfo> list = service.list(3L);

        assertEquals(1, list.size());
        assertEquals("前端", list.get(0).name());
        assertEquals(4L, list.get(0).entryCount());
    }

    @Test
    void filterEntries_missing_tag_throws_404() {
        when(tagMapper.selectById(99L)).thenReturn(null);
        assertThrows(NotFoundException.class, () -> service.filterEntries(99L, null));
    }

    @Test
    void filterEntries_backfills_tags_in_batch() {
        when(tagMapper.selectById(1L)).thenReturn(tag(1L, 3L, "前端"));
        EntryTagMapper.FilteredRow row = new EntryTagMapper.FilteredRow();
        row.setId(10L);
        row.setSessionId(7L);
        row.setSeq(2);
        row.setType("action");
        row.setContentMd("内容");
        row.setSessionTitle("会话A");
        row.setWorkspaceId(3L);
        row.setWorkspaceName("项目");
        when(entryTagMapper.selectByTag(1L, 7L)).thenReturn(List.of(row));
        EntryTagMapper.TagName tn = new EntryTagMapper.TagName();
        tn.setEntryId(10L);
        tn.setName("前端");
        when(entryTagMapper.selectTagNamesByEntries(eq(List.of(10L)))).thenReturn(List.of(tn));

        List<TagService.FilteredEntry> entries = service.filterEntries(1L, 7L);

        assertEquals(1, entries.size());
        assertEquals(List.of("前端"), entries.get(0).tags());
        assertEquals("会话A", entries.get(0).sessionTitle());
    }

    @Test
    void filterEntries_empty_result_skips_batch_backfill() {
        when(tagMapper.selectById(1L)).thenReturn(tag(1L, 3L, "前端"));
        when(entryTagMapper.selectByTag(1L, null)).thenReturn(List.of());

        List<TagService.FilteredEntry> entries = service.filterEntries(1L, null);

        assertEquals(0, entries.size());
        verify(entryTagMapper, never()).selectTagNamesByEntries(any());
    }

    // ---------- 批量删除（04 §5 POST /tags/batch-delete） ----------

    @Test
    void deleteBatch_empty_or_null_is_noop() {
        service.deleteBatch(null);
        service.deleteBatch(List.of());
        verify(entryTagMapper, never()).deleteByTag(anyLong());
        verify(tagMapper, never()).deleteById(anyLong());
    }

    @Test
    void deleteBatch_all_exist_clears_links_then_deletes_each() {
        when(tagMapper.selectById(1L)).thenReturn(tag(1L, 3L, "A"));
        when(tagMapper.selectById(2L)).thenReturn(tag(2L, 3L, "B"));

        service.deleteBatch(List.of(1L, 2L));

        // 每个标签先清 entry_tag 关联再删自身（05 §3 显式级联）
        verify(entryTagMapper).deleteByTag(1L);
        verify(entryTagMapper).deleteByTag(2L);
        verify(tagMapper).deleteById(1L);
        verify(tagMapper).deleteById(2L);
    }

    @Test
    void deleteBatch_missing_id_throws_404_and_skips_that_delete() {
        when(tagMapper.selectById(1L)).thenReturn(tag(1L, 3L, "A"));
        when(tagMapper.selectById(2L)).thenReturn(null); // 第二个不存在

        assertThrows(NotFoundException.class, () -> service.deleteBatch(List.of(1L, 2L)));

        verify(entryTagMapper, never()).deleteByTag(2L);
        verify(tagMapper, never()).deleteById(2L);
    }

    @Test
    void mergeBatch_merges_each_source_into_target_and_deletes_sources() {
        // 目标 3 被每次 merge 的 requireTag(targetId) 重取，故对同一 id 多次 when
        when(tagMapper.selectById(3L)).thenReturn(tag(3L, 3L, "目标"));
        when(tagMapper.selectById(1L)).thenReturn(tag(1L, 3L, "源甲"));
        when(tagMapper.selectById(2L)).thenReturn(tag(2L, 3L, "源乙"));
        when(entryTagMapper.countByTag(3L)).thenReturn(5L);

        TagService.TagInfo info = service.mergeBatch(List.of(1L, 2L), 3L);

        assertEquals(3L, info.id());
        assertEquals(5L, info.entryCount());
        verify(entryTagMapper).retagEntries(1L, 3L);
        verify(entryTagMapper).retagEntries(2L, 3L);
        verify(entryTagMapper).deleteByTag(1L);
        verify(entryTagMapper).deleteByTag(2L);
        verify(tagMapper).deleteById(1L);
        verify(tagMapper).deleteById(2L);
        verify(tagMapper, never()).deleteById(3L); // 目标保留
    }

    @Test
    void mergeBatch_null_target_throws_400() {
        assertThrows(BadRequestException.class, () -> service.mergeBatch(List.of(1L), null));
        verify(tagMapper, never()).deleteById(anyLong());
        verify(entryTagMapper, never()).retagEntries(anyLong(), anyLong());
    }

    @Test
    void mergeBatch_empty_ids_is_noop_returns_target() {
        when(tagMapper.selectById(3L)).thenReturn(tag(3L, 3L, "目标"));
        when(entryTagMapper.countByTag(3L)).thenReturn(2L);

        TagService.TagInfo info = service.mergeBatch(List.of(), 3L);

        assertEquals(3L, info.id());
        assertEquals(2L, info.entryCount());
        verify(entryTagMapper, never()).retagEntries(anyLong(), anyLong());
        verify(tagMapper, never()).deleteById(anyLong());
    }

    @Test
    void mergeBatch_source_not_found_throws_404_and_skips_remaining() {
        when(tagMapper.selectById(3L)).thenReturn(tag(3L, 3L, "目标"));
        when(tagMapper.selectById(1L)).thenReturn(tag(1L, 3L, "源甲"));
        when(tagMapper.selectById(2L)).thenReturn(null); // 第二个源不存在

        assertThrows(NotFoundException.class, () -> service.mergeBatch(List.of(1L, 2L), 3L));

        // 第一个源已合并完成，第二个源因不存在抛 404（未 retag/删除）
        verify(entryTagMapper).retagEntries(1L, 3L);
        verify(tagMapper).deleteById(1L);
        verify(entryTagMapper, never()).retagEntries(2L, 3L);
        verify(tagMapper, never()).deleteById(2L);
    }
}
