package com.trailmind.backend.service;

import com.trailmind.backend.common.BadRequestException;
import com.trailmind.backend.common.ConflictException;
import com.trailmind.backend.common.NotFoundException;
import com.trailmind.backend.entity.Mindmap;
import com.trailmind.backend.entity.Workspace;
import com.trailmind.backend.repository.MindmapMapper;
import com.trailmind.backend.repository.WorkspaceMapper;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.time.LocalDateTime;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertSame;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class MindmapServiceTest {

    @Mock
    private MindmapMapper mapper;

    @Mock
    private WorkspaceMapper workspaceMapper;

    @InjectMocks
    private MindmapService service;

    @Test
    void create_uses_default_content_and_computes_summary() {
        when(workspaceMapper.selectById(1L)).thenReturn(new Workspace());

        Mindmap created = service.create(1L, "  我的导图  ", null);

        assertEquals("我的导图", created.getName());
        assertEquals(1, created.getNodeCount());
        assertNotNull(created.getContentJson());
        assertTrue(created.getSearchText().contains("中心主题"));
        verify(mapper).insert(any(Mindmap.class));
    }

    @Test
    void create_with_provided_content_computes_node_count_and_search_text() {
        when(workspaceMapper.selectById(1L)).thenReturn(new Workspace());
        String json = "{\"version\":1,\"nodes\":{\"n1\":{\"text\":\"A\"},\"n2\":{\"text\":\"B\"}},\"edges\":[]}";

        Mindmap created = service.create(1L, "导图", json);

        assertEquals(2, created.getNodeCount());
        assertTrue(created.getSearchText().contains("导图"));
        assertTrue(created.getSearchText().contains("A"));
        assertTrue(created.getSearchText().contains("B"));
    }

    @Test
    void create_workspace_not_found_throws() {
        when(workspaceMapper.selectById(99L)).thenReturn(null);
        assertThrows(NotFoundException.class, () -> service.create(99L, "导图", null));
        verify(mapper, never()).insert(any(Mindmap.class));
    }

    @Test
    void create_blank_name_throws() {
        when(workspaceMapper.selectById(1L)).thenReturn(new Workspace());
        assertThrows(BadRequestException.class, () -> service.create(1L, "  ", null));
        assertThrows(BadRequestException.class, () -> service.create(1L, null, null));
    }

    @Test
    void create_name_too_long_throws() {
        when(workspaceMapper.selectById(1L)).thenReturn(new Workspace());
        assertThrows(BadRequestException.class, () -> service.create(1L, "a".repeat(101), null));
    }

    @Test
    void get_not_found_throws() {
        when(mapper.selectById(1L)).thenReturn(null);
        assertThrows(NotFoundException.class, () -> service.get(1L));
    }

    @Test
    void get_success_returns() {
        Mindmap m = new Mindmap();
        m.setId(1L);
        when(mapper.selectById(1L)).thenReturn(m);
        assertSame(m, service.get(1L));
    }

    @Test
    void save_not_found_throws() {
        when(mapper.selectById(1L)).thenReturn(null);
        assertThrows(NotFoundException.class, () -> service.save(1L, "{\"version\":1,\"nodes\":{},\"edges\":[]}", null));
    }

    @Test
    void save_conflict_throws_when_updatedAt_mismatch() {
        Mindmap existing = new Mindmap();
        existing.setId(1L);
        existing.setName("导图");
        existing.setUpdatedAt(LocalDateTime.of(2026, 8, 14, 10, 0, 0));
        when(mapper.selectById(1L)).thenReturn(existing);

        assertThrows(ConflictException.class,
                () -> service.save(1L, "{\"version\":1,\"nodes\":{},\"edges\":[]}",
                        LocalDateTime.of(2026, 8, 14, 9, 0, 0)));
        verify(mapper, never()).updateContent(anyLong(), anyString(), anyString(), anyInt());
    }

    @Test
    void save_success_updates_content_and_reselects() {
        Mindmap existing = new Mindmap();
        existing.setId(1L);
        existing.setName("导图");
        existing.setUpdatedAt(LocalDateTime.of(2026, 8, 14, 10, 0, 0));
        Mindmap fresh = new Mindmap();
        fresh.setId(1L);
        fresh.setUpdatedAt(LocalDateTime.of(2026, 8, 14, 10, 0, 1));
        when(mapper.selectById(1L)).thenReturn(existing, fresh);

        String json = "{\"version\":1,\"nodes\":{\"n1\":{\"text\":\"根\"}},\"edges\":[]}";
        Mindmap saved = service.save(1L, json, LocalDateTime.of(2026, 8, 14, 10, 0, 0));

        verify(mapper).updateContent(eq(1L), eq(json), anyString(), eq(1));
        assertSame(fresh, saved);
    }

    @Test
    void delete_not_found_throws() {
        when(mapper.selectById(1L)).thenReturn(null);
        assertThrows(NotFoundException.class, () -> service.delete(1L));
        verify(mapper, never()).deleteById(anyLong());
    }

    @Test
    void delete_success() {
        Mindmap m = new Mindmap();
        m.setId(1L);
        when(mapper.selectById(1L)).thenReturn(m);
        service.delete(1L);
        verify(mapper).deleteById(1L);
    }
}
