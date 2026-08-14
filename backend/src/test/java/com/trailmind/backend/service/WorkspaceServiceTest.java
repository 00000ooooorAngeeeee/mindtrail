package com.trailmind.backend.service;

import com.trailmind.backend.common.BadRequestException;
import com.trailmind.backend.entity.Workspace;
import com.trailmind.backend.repository.WorkspaceMapper;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.verify;

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
}
