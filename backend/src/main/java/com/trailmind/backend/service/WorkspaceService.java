package com.trailmind.backend.service;

import com.trailmind.backend.common.BadRequestException;
import com.trailmind.backend.common.NotFoundException;
import com.trailmind.backend.entity.Workspace;
import com.trailmind.backend.repository.WorkspaceMapper;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;

/**
 * 工作区业务逻辑：创建/详情/更新/删除。
 * repoPath 仅做 .git 目录存在性检查（深度校验 M1 后续再议）。
 * 删除走事务 + 显式级联（无物理外键，见 docs/05 §3：删工作区 → 删导图/会话/条目/标签及其关联）。
 */
@Service
public class WorkspaceService {

    private final WorkspaceMapper mapper;

    public WorkspaceService(WorkspaceMapper mapper) {
        this.mapper = mapper;
    }

    public Workspace create(String name, String description, String repoPath) {
        String trimmed = validateName(name);
        String repo = validateRepoPath(repoPath);

        Workspace w = new Workspace();
        w.setName(trimmed);
        w.setDescription(description);
        w.setRepoPath(repo);
        mapper.insert(w);
        return w;
    }

    public Workspace get(Long id) {
        Workspace w = mapper.selectById(id);
        if (w == null) {
            throw new NotFoundException("工作区不存在");
        }
        return w;
    }

    public Workspace update(Long id, String name, String description, String repoPath) {
        Workspace w = get(id);
        w.setName(validateName(name));
        w.setDescription(description);
        w.setRepoPath(validateRepoPath(repoPath));
        mapper.updateById(w);
        // 重命名不影响计数，但响应需带计数：selectById 不填充 mindmapCount/sessionCount（@TableField(exist=false)），
        // 直接返回 w 会让前端列表项计数归零（07 §17 修复二遗留的重命名路径）。改回带计数的单行查询。
        return mapper.selectWithCounts(id);
    }

    @Transactional
    public void delete(Long id) {
        get(id); // 不存在则抛 404，避免对空 id 做级联
        // 子先于父：先清关联表，再清业务表，最后删工作区
        mapper.deleteEntryTagsByWorkspace(id);
        mapper.deleteEntryCommitsByWorkspace(id);
        mapper.deleteNodeEntriesByWorkspace(id); // v1.1 联动：导图/条目两侧挂接一并清理
        mapper.deleteEntriesByWorkspace(id);
        mapper.deleteSessionsByWorkspace(id);
        mapper.deleteMindmapsByWorkspace(id);
        mapper.deleteTagsByWorkspace(id);
        mapper.deleteById(id);
    }

    /**
     * 批量删除工作区（04 §5 POST /workspaces/batch-delete）：事务内逐个级联删除（复用 {@link #delete(Long)}），
     * 任一 id 不存在抛 404 并整体回滚；空集合幂等无操作。前端选中项来自已加载列表，正常路径下均存在。
     */
    @Transactional
    public void deleteBatch(List<Long> ids) {
        if (ids == null || ids.isEmpty()) return;
        for (Long id : ids) {
            delete(id);
        }
    }

    public List<Workspace> list() {
        return mapper.listWithCounts();
    }

    private String validateName(String name) {
        if (name == null || name.isBlank()) {
            throw new BadRequestException("工作区名称不能为空");
        }
        String trimmed = name.trim();
        if (trimmed.length() > 100) {
            throw new BadRequestException("工作区名称不能超过 100 字符");
        }
        return trimmed;
    }

    private String validateRepoPath(String repoPath) {
        if (repoPath != null && !repoPath.isBlank() && !Files.isDirectory(Path.of(repoPath, ".git"))) {
            throw new BadRequestException("仓库路径无效：未找到 .git 目录");
        }
        return repoPath;
    }
}
