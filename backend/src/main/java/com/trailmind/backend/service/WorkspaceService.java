package com.trailmind.backend.service;

import com.trailmind.backend.common.BadRequestException;
import com.trailmind.backend.entity.Workspace;
import com.trailmind.backend.repository.WorkspaceMapper;
import org.springframework.stereotype.Service;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;

/**
 * 工作区业务逻辑：创建校验 + 列表统计。
 * repoPath 仅做 .git 目录存在性检查（深度校验 M1 再做）。
 */
@Service
public class WorkspaceService {

    private final WorkspaceMapper mapper;

    public WorkspaceService(WorkspaceMapper mapper) {
        this.mapper = mapper;
    }

    public Workspace create(String name, String description, String repoPath) {
        if (name == null || name.isBlank()) {
            throw new BadRequestException("工作区名称不能为空");
        }
        String trimmed = name.trim();
        if (trimmed.length() > 100) {
            throw new BadRequestException("工作区名称不能超过 100 字符");
        }
        if (repoPath != null && !repoPath.isBlank() && !Files.isDirectory(Path.of(repoPath, ".git"))) {
            throw new BadRequestException("仓库路径无效：未找到 .git 目录");
        }

        Workspace w = new Workspace();
        w.setName(trimmed);
        w.setDescription(description);
        w.setRepoPath(repoPath);
        mapper.insert(w);
        return w;
    }

    public List<Workspace> list() {
        return mapper.listWithCounts();
    }
}
