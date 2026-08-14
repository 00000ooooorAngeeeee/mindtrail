package com.trailmind.backend.service;

import com.trailmind.backend.common.BadRequestException;
import com.trailmind.backend.common.NotFoundException;
import com.trailmind.backend.entity.Workspace;
import com.trailmind.backend.repository.WorkspaceMapper;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertSame;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class WorkspaceServiceTest {

    @Mock
    private WorkspaceMapper mapper;

    @InjectMocks
    private WorkspaceService service;

    @Test
    void create_success_trims_and_inserts() {
        Workspace created = service.create("  测试项目  ", "描述", null);

        assertEquals("测试项目", created.getName());
        verify(mapper).insert(any(Workspace.class));
    }

    @Test
    void create_blank_name_throws() {
        assertThrows(BadRequestException.class, () -> service.create("  ", null, null));
        assertThrows(BadRequestException.class, () -> service.create(null, null, null));
    }

    @Test
    void create_name_too_long_throws() {
        String longName = "a".repeat(101);
        assertThrows(BadRequestException.class, () -> service.create(longName, null, null));
    }

    @Test
    void create_invalid_repo_path_throws() {
        // 指向不存在 .git 的路径 → 校验失败
        assertThrows(BadRequestException.class,
                () -> service.create("项目", null, "Z:\\不存在的\\仓库"));
    }

    @Test
    void get_not_found_throws() {
        when(mapper.selectById(99L)).thenReturn(null);
        assertThrows(NotFoundException.class, () -> service.get(99L));
    }

    @Test
    void get_success_returns_workspace() {
        Workspace w = new Workspace();
        w.setId(1L);
        w.setName("项目");
        when(mapper.selectById(1L)).thenReturn(w);

        assertSame(w, service.get(1L));
    }

    @Test
    void update_not_found_throws() {
        when(mapper.selectById(9L)).thenReturn(null);
        assertThrows(NotFoundException.class, () -> service.update(9L, "新名", null, null));
        verify(mapper, never()).updateById(any(Workspace.class));
    }

    @Test
    void update_blank_name_throws_and_does_not_persist() {
        Workspace w = new Workspace();
        w.setId(1L);
        when(mapper.selectById(1L)).thenReturn(w);

        assertThrows(BadRequestException.class, () -> service.update(1L, "  ", null, null));
        verify(mapper, never()).updateById(any(Workspace.class));
    }

    @Test
    void update_success_trims_and_updates() {
        Workspace w = new Workspace();
        w.setId(1L);
        when(mapper.selectById(1L)).thenReturn(w);

        Workspace updated = service.update(1L, "  新名  ", "新描述", null);

        assertEquals("新名", updated.getName());
        assertEquals("新描述", updated.getDescription());
        verify(mapper).updateById(w);
    }

    @Test
    void delete_not_found_throws_and_skips_cascade() {
        when(mapper.selectById(7L)).thenReturn(null);

        assertThrows(NotFoundException.class, () -> service.delete(7L));
        verify(mapper, never()).deleteEntryTagsByWorkspace(anyLong());
        verify(mapper, never()).deleteById(anyLong());
    }

    @Test
    void delete_success_cascades_children_before_workspace() {
        when(mapper.selectById(1L)).thenReturn(new Workspace());

        service.delete(1L);

        // 级联顺序：关联表 → 业务表 → 工作区本身
        verify(mapper).deleteEntryTagsByWorkspace(1L);
        verify(mapper).deleteEntryCommitsByWorkspace(1L);
        verify(mapper).deleteEntriesByWorkspace(1L);
        verify(mapper).deleteSessionsByWorkspace(1L);
        verify(mapper).deleteMindmapsByWorkspace(1L);
        verify(mapper).deleteTagsByWorkspace(1L);
        verify(mapper).deleteById(1L);
    }
}
