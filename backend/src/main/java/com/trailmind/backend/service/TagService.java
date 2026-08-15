package com.trailmind.backend.service;

import com.trailmind.backend.common.BadRequestException;
import com.trailmind.backend.common.NotFoundException;
import com.trailmind.backend.entity.Tag;
import com.trailmind.backend.repository.EntryTagMapper;
import com.trailmind.backend.repository.TagMapper;
import com.trailmind.backend.repository.WorkspaceMapper;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * 标签管理业务逻辑（M4 任务二，PRD D3/D4 + 04 §5 + 05 §5）：
 * 工作区级标签（tag 表，uk_tag_workspace_name）的创建/重命名/合并/删除与列表（含使用计数）；
 * 按标签筛条目（GET /entries?tagId=&sessionId=，D4「过滤即时」）。
 * 重命名「全局生效」：条目经 entry_tag 引用 tag.id，tag 表改名后所有关联条目读到的即新名（无需回写）。
 * 合并语义：源标签的全部条目重挂到目标标签（已含目标标签的条目去重跳过）后删除源标签——事务内完成。
 * 写操作事务化（08 §4.2）；删除级联显式处理（先清 entry_tag 再删 tag，05 §3）。
 */
@Service
public class TagService {

    /** 标签名上限（与 EntryService.MAX_TAG_NAME_LENGTH 一致，05 §3 tag.name VARCHAR(50)）。 */
    private static final int MAX_NAME_LENGTH = 50;
    /** 按标签筛条目的结果上限（防御性截断，防止无界列表；MVP 单库条目 2 万级）。 */
    private static final int MAX_FILTER_RESULTS = 500;

    private final TagMapper tagMapper;
    private final EntryTagMapper entryTagMapper;
    private final WorkspaceMapper workspaceMapper;

    public TagService(TagMapper tagMapper, EntryTagMapper entryTagMapper, WorkspaceMapper workspaceMapper) {
        this.tagMapper = tagMapper;
        this.entryTagMapper = entryTagMapper;
        this.workspaceMapper = workspaceMapper;
    }

    /** 标签信息（列表返回：含使用计数，供 UI 展示）。 */
    public record TagInfo(Long id, Long workspaceId, String name, LocalDateTime createdAt, Long entryCount) {
    }

    /** 按标签筛出的条目（含会话/工作区上下文与条目标签，供过滤视图与跳转定位）。 */
    public record FilteredEntry(Long id, Long sessionId, Integer seq, String type, String contentMd,
                                LocalDateTime createdAt, String sessionTitle, Long workspaceId,
                                String workspaceName, List<String> tags) {
    }

    /** 工作区标签列表（按名称排序，带使用计数）。 */
    public List<TagInfo> list(Long workspaceId) {
        ensureWorkspace(workspaceId);
        return tagMapper.listByWorkspaceWithCount(workspaceId).stream()
                .map(r -> new TagInfo(r.getId(), r.getWorkspaceId(), r.getName(), r.getCreatedAt(), r.getEntryCount()))
                .toList();
    }

    /** 创建标签：名称去空白、长度校验、工作区唯一（重复 → 400）。 */
    @Transactional
    public TagInfo create(Long workspaceId, String name) {
        ensureWorkspace(workspaceId);
        String n = validateName(name);
        if (tagMapper.selectByWorkspaceAndName(workspaceId, n) != null) {
            throw new BadRequestException("标签已存在：" + n);
        }
        Tag t = new Tag();
        t.setWorkspaceId(workspaceId);
        t.setName(n);
        tagMapper.insert(t);
        return new TagInfo(t.getId(), t.getWorkspaceId(), t.getName(), t.getCreatedAt(), 0L);
    }

    /** 重命名：同名跳自身幂等；与工作区内其它标签重名 → 400。关联条目经 tag.id 引用自动生效（PRD D3）。 */
    @Transactional
    public TagInfo rename(Long id, String name) {
        Tag t = requireTag(id);
        String n = validateName(name);
        if (!t.getName().equals(n)) {
            Tag dup = tagMapper.selectByWorkspaceAndName(t.getWorkspaceId(), n);
            if (dup != null) {
                throw new BadRequestException("标签已存在：" + n);
            }
            t.setName(n);
            tagMapper.updateById(t);
        }
        return info(t);
    }

    /**
     * 合并：源标签条目重挂目标标签（已含目标标签的条目跳过，避免主键冲突）后删除源标签；
     * 返回目标标签最新信息。自身合并 / 跨工作区合并 → 400。
     */
    @Transactional
    public TagInfo merge(Long sourceId, Long targetId) {
        if (sourceId.equals(targetId)) {
            throw new BadRequestException("不能合并到自身");
        }
        Tag source = requireTag(sourceId);
        Tag target = requireTag(targetId);
        if (!source.getWorkspaceId().equals(target.getWorkspaceId())) {
            throw new BadRequestException("只能合并同一工作区的标签");
        }
        entryTagMapper.retagEntries(sourceId, targetId);
        entryTagMapper.deleteByTag(sourceId);
        tagMapper.deleteById(sourceId);
        return info(target);
    }

    /** 删除标签：先清 entry_tag 关联再删标签（无物理外键，service 层显式级联，05 §3）。 */
    @Transactional
    public void delete(Long id) {
        requireTag(id);
        entryTagMapper.deleteByTag(id);
        tagMapper.deleteById(id);
    }

    /**
     * 按标签筛条目（PRD D4）：tagId 必传（404 保护）；sessionId 可选（会话内过滤）。
     * 排序：会话开始时间倒序、会话内 seq 正序；批量回填各条目标签。
     */
    public List<FilteredEntry> filterEntries(Long tagId, Long sessionId) {
        requireTag(tagId);
        List<EntryTagMapper.FilteredRow> rows = entryTagMapper.selectByTag(tagId, sessionId);

        Map<Long, List<String>> tagsByEntry = new LinkedHashMap<>();
        if (!rows.isEmpty()) {
            List<Long> ids = rows.stream().map(EntryTagMapper.FilteredRow::getId).toList();
            for (EntryTagMapper.TagName tn : entryTagMapper.selectTagNamesByEntries(ids)) {
                tagsByEntry.computeIfAbsent(tn.getEntryId(), k -> new ArrayList<>()).add(tn.getName());
            }
        }
        return rows.stream()
                .map(r -> new FilteredEntry(r.getId(), r.getSessionId(), r.getSeq(), r.getType(), r.getContentMd(),
                        r.getCreatedAt(), r.getSessionTitle(), r.getWorkspaceId(), r.getWorkspaceName(),
                        List.copyOf(tagsByEntry.getOrDefault(r.getId(), List.of()))))
                .toList();
    }

    private TagInfo info(Tag t) {
        Long count = entryTagMapper.countByTag(t.getId());
        return new TagInfo(t.getId(), t.getWorkspaceId(), t.getName(), t.getCreatedAt(), count);
    }

    private Tag requireTag(Long id) {
        Tag t = tagMapper.selectById(id);
        if (t == null) {
            throw new NotFoundException("标签不存在");
        }
        return t;
    }

    private void ensureWorkspace(Long workspaceId) {
        if (workspaceId == null || workspaceMapper.selectById(workspaceId) == null) {
            throw new NotFoundException("工作区不存在");
        }
    }

    private String validateName(String name) {
        if (name == null || name.isBlank()) {
            throw new BadRequestException("标签名不能为空");
        }
        String n = name.trim();
        if (n.length() > MAX_NAME_LENGTH) {
            throw new BadRequestException("标签名不能超过 " + MAX_NAME_LENGTH + " 字符");
        }
        return n;
    }
}
