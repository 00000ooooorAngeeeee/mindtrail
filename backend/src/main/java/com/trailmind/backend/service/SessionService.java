package com.trailmind.backend.service;

import com.trailmind.backend.common.BadRequestException;
import com.trailmind.backend.common.ConflictException;
import com.trailmind.backend.common.NotFoundException;
import com.trailmind.backend.entity.Session;
import com.trailmind.backend.entity.Workspace;
import com.trailmind.backend.git.GitHeadReader;
import com.trailmind.backend.repository.EntryMapper;
import com.trailmind.backend.repository.SessionMapper;
import com.trailmind.backend.repository.WorkspaceMapper;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDateTime;
import java.util.List;

/**
 * 记录会话业务逻辑（docs/07 §6 任务一）：
 * 开始（标题 + 仓库默认继承工作区 + start_head 记录，PRD C1.1）、列表、详情（含条目分页）、
 * 结束（status/ended_at/end_head/总结写入 review 条目，PRD C1.3）、删除（显式级联，05 §3）。
 */
@Service
public class SessionService {

    private static final int MAX_TITLE_LENGTH = 200;

    private final SessionMapper sessionMapper;
    private final WorkspaceMapper workspaceMapper;
    private final EntryMapper entryMapper;
    private final EntryService entryService;
    private final GitHeadReader gitHeadReader;

    public SessionService(SessionMapper sessionMapper, WorkspaceMapper workspaceMapper,
                          EntryMapper entryMapper, EntryService entryService, GitHeadReader gitHeadReader) {
        this.sessionMapper = sessionMapper;
        this.workspaceMapper = workspaceMapper;
        this.entryMapper = entryMapper;
        this.entryService = entryService;
        this.gitHeadReader = gitHeadReader;
    }

    @Transactional
    public Session create(Long workspaceId, String title, String repoPath) {
        Workspace ws = workspaceMapper.selectById(workspaceId);
        if (ws == null) {
            throw new NotFoundException("工作区不存在");
        }
        String t = validateTitle(title);
        // 会话级仓库覆盖工作区设置；未指定则继承工作区仓库（PRD C1.1）
        String repo = (repoPath != null && !repoPath.isBlank()) ? repoPath : ws.getRepoPath();
        String startHead = (repo == null) ? null : gitHeadReader.readHead(repo);

        Session s = new Session();
        s.setWorkspaceId(workspaceId);
        s.setTitle(t);
        s.setStatus("active");
        s.setRepoPath(repo);
        s.setStartHead(startHead);
        sessionMapper.insert(s);
        return s; // started_at 由 DB 默认值填充，返回时为空（与 workspace/mindmap 一致，前端经 GET 取全量）
    }

    public Session get(Long id) {
        Session s = sessionMapper.selectById(id);
        if (s == null) {
            throw new NotFoundException("会话不存在");
        }
        return s;
    }

    public List<Session> list(Long workspaceId) {
        return sessionMapper.listByWorkspace(workspaceId);
    }

    /** PATCH 语义（04 §5）：title 重命名；status=completed 结束会话（记录 end_head，总结写入 review 条目）。 */
    @Transactional
    public Session update(Long id, String title, String status, String summary) {
        Session s = get(id);
        if (title != null) {
            s.setTitle(validateTitle(title));
        }
        if ("completed".equals(status)) {
            if ("completed".equals(s.getStatus())) {
                throw new ConflictException("会话已结束");
            }
            s.setStatus("completed");
            s.setEndedAt(LocalDateTime.now());
            s.setEndHead(gitHeadReader.readHead(s.getRepoPath()));
            String sum = (summary == null || summary.isBlank()) ? null : summary.trim();
            if (sum != null) {
                s.setSummary(sum);
                entryService.add(s.getId(), "review", sum, List.of(), List.of()); // C1.3：结束总结写入 review 条目
            }
        } else if (status != null && !"active".equals(status)) {
            throw new BadRequestException("无效的会话状态");
        }
        sessionMapper.updateById(s);
        return s;
    }

    /** 详情：会话 + 条目分页（每页默认 50，05 §5）。page/size 越界时收敛。 */
    public Session detail(Long id, int page, int size) {
        Session s = get(id);
        int p = Math.max(page, 1);
        int z = Math.min(Math.max(size, 1), 100);
        EntryService.EntryPage ep = entryService.page(id, p, z);
        s.setEntries(ep.entries());
        s.setEntryTotal(ep.total());
        return s;
    }

    @Transactional
    public void delete(Long id) {
        get(id); // 不存在则抛 404，避免对空 id 做级联
        // 子先于父：关联表 → 条目 → 会话（无物理外键，service 层显式处理，05 §3）
        entryMapper.deleteEntryTagsBySession(id);
        entryMapper.deleteEntryCommitsBySession(id);
        entryMapper.deleteBySession(id);
        sessionMapper.deleteById(id);
    }

    private String validateTitle(String title) {
        if (title == null || title.isBlank()) {
            throw new BadRequestException("会话标题不能为空");
        }
        String trimmed = title.trim();
        if (trimmed.length() > MAX_TITLE_LENGTH) {
            throw new BadRequestException("会话标题不能超过 " + MAX_TITLE_LENGTH + " 字符");
        }
        return trimmed;
    }
}
