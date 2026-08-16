package com.trailmind.backend.service;

import com.trailmind.backend.common.BadRequestException;
import com.trailmind.backend.common.NotFoundException;
import com.trailmind.backend.entity.Entry;
import com.trailmind.backend.entity.EntryCommit;
import com.trailmind.backend.entity.EntryTag;
import com.trailmind.backend.entity.Session;
import com.trailmind.backend.entity.Tag;
import com.trailmind.backend.git.GitRepoService;
import com.trailmind.backend.repository.EntryCommitMapper;
import com.trailmind.backend.repository.EntryMapper;
import com.trailmind.backend.repository.EntryTagMapper;
import com.trailmind.backend.repository.NodeEntryMapper;
import com.trailmind.backend.repository.SessionMapper;
import com.trailmind.backend.repository.TagMapper;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.regex.Pattern;

/**
 * 时间线条目业务逻辑（docs/07 §6 任务一 + 任务三）：
 * 追加（seq 事务内 MAX(seq)+1，05 §5）、编辑（MVP 仅 contentMd/type/tags，04 §5）、删除（级联关联表）、分页。
 * Git 绑定（任务三）：追加/绑定（entry_commit，校验 hash 格式与仓库存在性，08 §10.6）、解绑、会话绑定列表、
 * 分页回填 commits（与 tags 同法，避免 N+1）。
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
    private static final int MAX_COMMITS_PER_ENTRY = 20;

    /** Git commit 完整 hash：40 位小写十六进制（entry_commit.commit_hash CHAR(40)，05 §3）。 */
    private static final Pattern COMMIT_HASH_PATTERN = Pattern.compile("[0-9a-f]{40}");

    private final EntryMapper entryMapper;
    private final SessionMapper sessionMapper;
    private final TagMapper tagMapper;
    private final EntryTagMapper entryTagMapper;
    private final EntryCommitMapper entryCommitMapper;
    private final NodeEntryMapper nodeEntryMapper;
    private final GitRepoService gitRepoService;

    public EntryService(EntryMapper entryMapper, SessionMapper sessionMapper,
                        TagMapper tagMapper, EntryTagMapper entryTagMapper,
                        EntryCommitMapper entryCommitMapper, NodeEntryMapper nodeEntryMapper,
                        GitRepoService gitRepoService) {
        this.entryMapper = entryMapper;
        this.sessionMapper = sessionMapper;
        this.tagMapper = tagMapper;
        this.entryTagMapper = entryTagMapper;
        this.entryCommitMapper = entryCommitMapper;
        this.nodeEntryMapper = nodeEntryMapper;
        this.gitRepoService = gitRepoService;
    }

    @Transactional
    public Entry add(Long sessionId, String type, String contentMd, List<String> tags, List<String> commitHashes) {
        return add(sessionId, type, contentMd, tags, commitHashes, null, null);
    }

    /**
     * 追加条目（04 §5 POST /sessions/{id}/entries）。
     * afterSeq（PRD C2.5 插入位置）：非空时插入到该 seq 之后（0=最前，须 ≤ 会话内最大 seq），其后条目 seq +1 重排；
     * 缺省追加末尾（MAX(seq)+1，05 §5）。createdAt（PRD C2.4 补记时间）：非空时手动指定创建时间（精确到秒），缺省当前时间。
     */
    @Transactional
    public Entry add(Long sessionId, String type, String contentMd, List<String> tags, List<String> commitHashes,
                     Integer afterSeq, LocalDateTime createdAt) {
        Session session = requireSession(sessionId);
        String t = validateType(type);
        if ("completed".equals(session.getStatus()) && !POST_COMPLETE_TYPES.contains(t)) {
            throw new BadRequestException("会话已结束，仅可追加 review 或 note 条目");
        }
        String content = validateContent(contentMd);
        List<String> names = normalizeTags(tags);

        Entry e = new Entry();
        e.setSessionId(sessionId);
        e.setSeq(resolveSeq(sessionId, afterSeq)); // 事务内分配：追加 MAX(seq)+1 / 插入 afterSeq+1 并重排（05 §5）
        e.setType(t);
        e.setContentMd(content);
        e.setCreatedAt(createdAt); // C2.4 补记时间（可空：入库走 DEFAULT CURRENT_TIMESTAMP）
        entryMapper.insert(e);
        linkTags(e.getId(), session.getWorkspaceId(), names);
        if (commitHashes != null && !commitHashes.isEmpty()) {
            e.setCommits(bind(e.getId(), commitHashes)); // 04 §5：追加条目可携带 commitHashes
        }
        e.setTags(names);
        return e;
    }

    /** 解析 seq：缺省追加末尾；afterSeq 非空时校验范围（0 ≤ afterSeq ≤ 最大 seq）并重排其后条目（PRD C2.5）。 */
    private int resolveSeq(Long sessionId, Integer afterSeq) {
        if (afterSeq == null) {
            return entryMapper.nextSeq(sessionId); // 追加：MAX(seq)+1
        }
        if (afterSeq < 0) {
            throw new BadRequestException("插入位置无效：afterSeq 不能为负数");
        }
        int max = entryMapper.maxSeq(sessionId);
        if (afterSeq > max) {
            throw new BadRequestException("插入位置无效：会话内最大序号为 " + max);
        }
        entryMapper.shiftSeq(sessionId, afterSeq); // 其后条目 seq+1（降序更新，无唯一约束冲突）
        return afterSeq + 1;
    }

    @Transactional
    public Entry update(Long entryId, String contentMd, String type, List<String> tags) {
        return update(entryId, contentMd, type, tags, null);
    }

    /** 编辑条目（04 §5 PUT /entries/{id}）；createdAt 为 PRD C2.4 补记时间（非空时重写创建时间，精确到秒）。 */
    @Transactional
    public Entry update(Long entryId, String contentMd, String type, List<String> tags, LocalDateTime createdAt) {
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
        if (createdAt != null) {
            e.setCreatedAt(createdAt); // C2.4 补记时间（updated_at 由 DB ON UPDATE 推进）
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
        nodeEntryMapper.deleteByEntry(entryId); // v1.1 联动：条目删除级联清理其节点引用
        entryMapper.deleteById(entryId);
    }

    /**
     * 绑定提交（04 §5 POST /entries/{id}/commits）：hash 格式校验 + 仓库存在性校验（08 §10.6 防造假）、
     * 去重后写入 entry_commit；返回本次新增绑定的 hash 列表。已绑定过的 hash 静默跳过（幂等）。
     */
    @Transactional
    public List<String> bind(Long entryId, List<String> commitHashes) {
        Entry e = entryMapper.selectById(entryId);
        if (e == null) {
            throw new NotFoundException("条目不存在");
        }
        Session session = requireSession(e.getSessionId());
        List<String> hashes = normalizeHashes(commitHashes);
        if (hashes.isEmpty()) {
            return List.of();
        }
        String repoPath = session.getRepoPath();
        if (repoPath == null || repoPath.isBlank()) {
            throw new BadRequestException("会话未关联 Git 仓库，无法绑定提交");
        }
        // 先按现有绑定去重，再校验存在性：已绑定的 hash 幂等跳过，不因仓库状态变化而拒绝重绑
        Set<String> done = new HashSet<>(entryCommitMapper.selectHashesByEntry(entryId));
        List<String> toAdd = new ArrayList<>();
        for (String hash : hashes) {
            if (done.add(hash)) {
                toAdd.add(hash);
            }
        }
        for (String hash : toAdd) {
            verifyCommitExists(repoPath, hash);
        }
        List<String> bound = new ArrayList<>();
        for (String hash : toAdd) {
            EntryCommit ec = new EntryCommit();
            ec.setEntryId(entryId);
            ec.setCommitHash(hash);
            ec.setRepoPath(repoPath);
            entryCommitMapper.insert(ec);
            bound.add(hash);
        }
        return bound;
    }

    /** 解绑（04 §5 DELETE /entries/{id}/commits/{hash}）；关系不存在 → 404。 */
    @Transactional
    public void unbind(Long entryId, String commitHash) {
        if (entryMapper.selectById(entryId) == null) {
            throw new NotFoundException("条目不存在");
        }
        String hash = normalizeHash(commitHash);
        if (entryCommitMapper.deleteByEntryAndHash(entryId, hash) == 0) {
            throw new NotFoundException("该提交未绑定到此条目");
        }
    }

    /** 会话内全部绑定关系（Git 面板与「未绑定缓冲」计算用，06 §5）。 */
    public List<BoundCommit> sessionCommits(Long sessionId) {
        requireSession(sessionId);
        return entryCommitMapper.selectBySession(sessionId).stream()
                .map(r -> new BoundCommit(r.getEntryId(), r.getCommitHash(), r.getRepoPath(), r.getBoundAt()))
                .toList();
    }

    /** 会话绑定投影（对外响应结构）。 */
    public record BoundCommit(Long entryId, String commitHash, String repoPath, LocalDateTime boundAt) {
    }

    /** 分页读取会话条目（按 seq 正序），并批量回填标签与绑定提交（避免 N+1）。 */
    public EntryPage page(Long sessionId, int page, int size) {
        int offset = (page - 1) * size;
        List<Entry> entries = entryMapper.listBySession(sessionId, offset, size);
        long total = entryMapper.countBySession(sessionId);

        Map<Long, List<String>> tagsByEntry = new LinkedHashMap<>();
        for (EntryTagMapper.TagName t : entryTagMapper.selectTagNamesBySession(sessionId)) {
            tagsByEntry.computeIfAbsent(t.getEntryId(), k -> new ArrayList<>()).add(t.getName());
        }
        Map<Long, List<String>> commitsByEntry = new LinkedHashMap<>();
        for (EntryCommitMapper.CommitRow row : entryCommitMapper.selectBySession(sessionId)) {
            commitsByEntry.computeIfAbsent(row.getEntryId(), k -> new ArrayList<>()).add(row.getCommitHash());
        }
        for (Entry e : entries) {
            e.setTags(tagsByEntry.getOrDefault(e.getId(), List.of()));
            e.setCommits(commitsByEntry.getOrDefault(e.getId(), List.of()));
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

    /** 绑定提交列表归一化：trim + 小写 + 去重 + 40 位十六进制格式校验 + 数量上限。保持书写顺序。 */
    private List<String> normalizeHashes(List<String> hashes) {
        if (hashes == null || hashes.isEmpty()) {
            return List.of();
        }
        LinkedHashSet<String> seen = new LinkedHashSet<>();
        for (String raw : hashes) {
            if (raw == null) {
                continue;
            }
            seen.add(normalizeHash(raw));
            if (seen.size() > MAX_COMMITS_PER_ENTRY) {
                throw new BadRequestException("每条目最多绑定 " + MAX_COMMITS_PER_ENTRY + " 个提交");
            }
        }
        return List.copyOf(seen);
    }

    /** 单个 hash 归一化：trim + 小写 + 格式校验（40 位十六进制）。 */
    private String normalizeHash(String raw) {
        String hash = raw == null ? "" : raw.trim().toLowerCase();
        if (!COMMIT_HASH_PATTERN.matcher(hash).matches()) {
            throw new BadRequestException("无效的提交 hash：" + raw);
        }
        return hash;
    }

    /** 绑定的提交必须在关联仓库真实存在（08 §10.6「artifact 绑定 commit 必须真实存在」）；
     *  仓库当前不可读时跳过校验（记录不应因仓库移动而无法补绑）。 */
    private void verifyCommitExists(String repoPath, String hash) {
        boolean exists;
        try {
            exists = gitRepoService.hasCommit(repoPath, hash);
        } catch (BadRequestException e) {
            return; // 仓库不可读：无法校验，放行
        }
        if (!exists) {
            throw new BadRequestException("提交不存在于关联仓库：" + hash);
        }
    }
}
