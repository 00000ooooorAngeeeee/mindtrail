package com.trailmind.backend.service;

import com.trailmind.backend.common.BadRequestException;
import com.trailmind.backend.common.ConflictException;
import com.trailmind.backend.common.NotFoundException;
import com.trailmind.backend.entity.Mindmap;
import com.trailmind.backend.repository.MindmapMapper;
import com.trailmind.backend.repository.WorkspaceMapper;
import org.springframework.stereotype.Service;

import java.time.LocalDateTime;
import java.util.List;

/**
 * 导图业务逻辑：新建（默认单根节点）、详情、列表（摘要）、整图保存（乐观锁）、删除。
 * 保存整图时由 {@link MindmapContentUtil} 同步维护 search_text 与 node_count（05 §4 保存语义）。
 */
@Service
public class MindmapService {

    private final MindmapMapper mapper;
    private final WorkspaceMapper workspaceMapper;

    public MindmapService(MindmapMapper mapper, WorkspaceMapper workspaceMapper) {
        this.mapper = mapper;
        this.workspaceMapper = workspaceMapper;
    }

    public Mindmap create(Long workspaceId, String name, String contentJson) {
        ensureWorkspaceExists(workspaceId);
        String trimmedName = validateName(name);
        String json = (contentJson == null || contentJson.isBlank())
                ? MindmapContentUtil.defaultContentJson()
                : contentJson;
        MindmapContentUtil.Summary summary = MindmapContentUtil.analyze(trimmedName, json);

        Mindmap m = new Mindmap();
        m.setWorkspaceId(workspaceId);
        m.setName(trimmedName);
        m.setContentJson(json);
        m.setSearchText(summary.searchText());
        m.setNodeCount(summary.nodeCount());
        mapper.insert(m);
        return m; // id 由 MyBatis-Plus 回填；createdAt/updatedAt 由 DB 默认值填充，返回时为 null（与 workspace 一致，前端经 GET 取全量）
    }

    public Mindmap get(Long id) {
        Mindmap m = mapper.selectById(id);
        if (m == null) {
            throw new NotFoundException("导图不存在");
        }
        return m;
    }

    public List<Mindmap> list(Long workspaceId) {
        return mapper.listSummaryByWorkspace(workspaceId);
    }

    public Mindmap save(Long id, String contentJson, LocalDateTime updatedAt) {
        Mindmap existing = get(id);
        // 乐观锁：客户端携带的 updatedAt 与当前不一致 → 冲突（04 §6.1，单机防御性实现）
        if (updatedAt != null && !updatedAt.equals(existing.getUpdatedAt())) {
            throw new ConflictException("导图已在别处修改，请刷新后重试");
        }
        MindmapContentUtil.Summary summary = MindmapContentUtil.analyze(existing.getName(), contentJson);
        mapper.updateContent(id, contentJson, summary.searchText(), summary.nodeCount());
        return get(id); // 回查，拿到 MySQL ON UPDATE 推进后的 updatedAt
    }

    /** 导图重命名（PRD B4）：同步重算 search_text 的 name 部分（05 §4 保存语义，搜索可命中新名）。 */
    public Mindmap rename(Long id, String name) {
        Mindmap existing = get(id);
        String trimmedName = validateName(name);
        MindmapContentUtil.Summary summary = MindmapContentUtil.analyze(trimmedName, existing.getContentJson());
        mapper.updateName(id, trimmedName, summary.searchText());
        return get(id); // 回查，拿到更新后的 name 与 updatedAt
    }

    public void delete(Long id) {
        get(id); // 不存在则抛 404
        mapper.deleteById(id);
    }

    private void ensureWorkspaceExists(Long workspaceId) {
        if (workspaceId == null || workspaceMapper.selectById(workspaceId) == null) {
            throw new NotFoundException("工作区不存在");
        }
    }

    private String validateName(String name) {
        if (name == null || name.isBlank()) {
            throw new BadRequestException("导图名称不能为空");
        }
        String trimmed = name.trim();
        if (trimmed.length() > 100) {
            throw new BadRequestException("导图名称不能超过 100 字符");
        }
        return trimmed;
    }
}
