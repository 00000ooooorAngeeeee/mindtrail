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
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * 时间线条目业务逻辑（docs/07 §6 任务一）：
 * 追加（seq 事务内 MAX(seq)+1，05 §5）、编辑（MVP 仅 contentMd/type/tags，04 §5）、删除（级联关联表）、分页。
 * 类型枚举见 docs/06 §2；会话结束后仅可追加 review/note（PRD C1.3）。
 * 标签：按需即时创建（PRD C2.6），每次写操作在事务内重建 entry_tag 关联。
 */
@Service
public class EntryService {

    /** 条目类型枚举（docs/06 §2，v1 不可扩展）。 */
    private static final Set<String> ENTRY_TYPES = Set.of(
            "goal", "context", "prompt", "action", "artifact",
            "decision", "error", "test", "review", "next", "note");

    /** 会话结束后仍可追加的类型（PRD C1.3）。 */
    private static final Set<String> POST_COMPLETE_TYPES = Set.of("review", "note");

    private static final int MAX_TAGS_PER_ENTRY = 20;
    private static final int MAX_TAG_NAME_LENGTH = 50;

    private final EntryMapper entryMapper;
    private final SessionMapper sessionMapper;
    private final TagMapper tagMapper;
    private final EntryTagMapper entryTagMapper;

    public EntryService(EntryMapper entryMapper, SessionMapper sessionMapper,
                        TagMapper tagMapper, EntryTagMapper entryTagMapper) {
        this.entryMapper = entryMapper;
        this.sessionMapper = sessionMapper;
        this.tagMapper = tagMapper;
        this.entryTagMapper = entryTagMapper;
    }

    @Transactional
    public Entry add(Long sessionId, String type, String contentMd, List<String> tags) {
        Session session = requireSession(sessionId);
        String t = validateType(type);
        if ("completed".equals(session.getStatus()) && !POST_COMPLETE_TYPES.contains(t)) {
            throw new BadRequestException("会话已结束，仅可追加 review 或 note 条目");
        }
        String content = validateContent(contentMd);
        List<String> names = normalizeTags(tags);

        Entry e = new Entry();
        e.setSessionId(sessionId);
        e.setSeq(entryMapper.nextSeq(sessionId)); // 事务内 MAX(seq)+1，保证时间线顺序（05 §5）
        e.setType(t);
        e.setContentMd(content);
        entryMapper.insert(e);
        linkTags(e.getId(), session.getWorkspaceId(), names);
        e.setTags(names);
        return e;
    }

    @Transactional
    public Entry update(Long entryId, String contentMd, String type, List<String> tags) {
        Entry e = entryMapper.selectById(entryId);
        if (e == null) {
            throw new NotFoundException("条目不存在");
        }
        if (contentMd != null) {
            e.setContentMd(validateContent(contentMd));
        }
        if (type != null) {
            e.setType(validateType(type));
        }
        if (tags != null) {
            Session session = requireSession(e.getSessionId());
            linkTags(entryId, session.getWorkspaceId(), normalizeTags(tags));
        }
        entryMapper.updateById(e);
        e.setTags(entryTagMapper.selectNamesByEntry(entryId));
        return e;
    }

    @Transactional
    public void delete(Long entryId) {
        if (entryMapper.selectById(entryId) == null) {
            throw new NotFoundException("条目不存在");
        }
        // 子先于父：先清关联表，再删条目（无物理外键，service 层显式处理，05 §3）
        entryMapper.deleteEntryTagsByEntry(entryId);
        entryMapper.deleteEntryCommitsByEntry(entryId);
        entryMapper.deleteById(entryId);
    }

    /** 分页读取会话条目（按 seq 正序），并批量回填标签（避免 N+1）。 */
    public EntryPage page(Long sessionId, int page, int size) {
        int offset = (page - 1) * size;
        List<Entry> entries = entryMapper.listBySession(sessionId, offset, size);
        long total = entryMapper.countBySession(sessionId);

        Map<Long, List<String>> tagsByEntry = new LinkedHashMap<>();
        for (EntryTagMapper.TagName t : entryTagMapper.selectTagNamesBySession(sessionId)) {
            tagsByEntry.computeIfAbsent(t.getEntryId(), k -> new ArrayList<>()).add(t.getName());
        }
        for (Entry e : entries) {
            e.setTags(tagsByEntry.getOrDefault(e.getId(), List.of()));
        }
        return new EntryPage(entries, total);
    }

    /** 分页结果（entries 已回填 tags）。 */
    public record EntryPage(List<Entry> entries, long total) {
    }

    private Session requireSession(Long sessionId) {
        Session s = sessionMapper.selectById(sessionId);
        if (s == null) {
            throw new NotFoundException("会话不存在");
        }
        return s;
    }

    private String validateType(String type) {
        if (type == null || type.isBlank()) {
            throw new BadRequestException("条目类型不能为空");
        }
        if (!ENTRY_TYPES.contains(type)) {
            throw new BadRequestException("无效的条目类型：" + type);
        }
        return type;
    }

    private String validateContent(String contentMd) {
        if (contentMd == null || contentMd.isBlank()) {
            throw new BadRequestException("条目内容不能为空");
        }
        return contentMd;
    }

    /** 去重去空白并裁剪；超长/超量抛 400。返回保持用户书写顺序。 */
    private List<String> normalizeTags(List<String> tags) {
        if (tags == null || tags.isEmpty()) {
            return List.of();
        }
        LinkedHashSet<String> seen = new LinkedHashSet<>();
        for (String raw : tags) {
            if (raw == null) {
                continue;
            }
            String name = raw.trim();
            if (name.isEmpty()) {
                continue;
            }
            if (name.length() > MAX_TAG_NAME_LENGTH) {
                throw new BadRequestException("标签名不能超过 " + MAX_TAG_NAME_LENGTH + " 字符");
            }
            seen.add(name);
            if (seen.size() > MAX_TAGS_PER_ENTRY) {
                throw new BadRequestException("每条目最多 " + MAX_TAGS_PER_ENTRY + " 个标签");
            }
        }
        return List.copyOf(seen);
    }

    /** 重建条目标签关联：标签不存在则即时创建（PRD C2.6），再写 entry_tag。 */
    private void linkTags(Long entryId, Long workspaceId, List<String> names) {
        entryTagMapper.deleteByEntry(entryId);
        for (String name : names) {
            Tag tag = tagMapper.selectByWorkspaceAndName(workspaceId, name);
            if (tag == null) {
                tag = new Tag();
                tag.setWorkspaceId(workspaceId);
                tag.setName(name);
                tagMapper.insert(tag);
            }
            entryTagMapper.insert(new EntryTag(entryId, tag.getId()));
        }
    }
}
