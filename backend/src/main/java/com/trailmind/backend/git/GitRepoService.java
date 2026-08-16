package com.trailmind.backend.git;

import com.trailmind.backend.common.BadRequestException;
import com.trailmind.backend.common.NotFoundException;
import org.eclipse.jgit.diff.DiffEntry;
import org.eclipse.jgit.diff.DiffFormatter;
import org.eclipse.jgit.diff.RawTextComparator;
import org.eclipse.jgit.errors.IncorrectObjectTypeException;
import org.eclipse.jgit.errors.MissingObjectException;
import org.eclipse.jgit.lib.ObjectId;
import org.eclipse.jgit.lib.ObjectReader;
import org.eclipse.jgit.lib.PersonIdent;
import org.eclipse.jgit.lib.Repository;
import org.eclipse.jgit.revwalk.RevCommit;
import org.eclipse.jgit.revwalk.RevWalk;
import org.eclipse.jgit.storage.file.FileRepositoryBuilder;
import org.eclipse.jgit.treewalk.AbstractTreeIterator;
import org.eclipse.jgit.treewalk.CanonicalTreeParser;
import org.eclipse.jgit.treewalk.EmptyTreeIterator;
import org.eclipse.jgit.treewalk.TreeWalk;
import org.eclipse.jgit.treewalk.filter.TreeFilter;
import org.springframework.stereotype.Component;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Path;
import java.time.LocalDateTime;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.List;

/**
 * Git 仓库只读服务（M3 任务三，07 §6 / PRD C3）：
 * 仓库校验（status）、提交历史读取（commits，带 since/until/limit 过滤，不读大仓库全量，08 §10.4）、
 * 提交存在性校验（hasCommit，绑定证据链防造假，08 §10.6）。
 * 语义：路径为空 → 400「仓库路径不能为空」；路径非法（非 Git 仓库）→ 400「路径不是有效的 Git 仓库」；
 * 空仓库（无提交）→ status.head=null、commits 为空列表。
 */
@Component
public class GitRepoService {

    /** 提交列表默认/上限条数（08 §10.4：JGit 不读大仓库全量历史）。 */
    public static final int DEFAULT_COMMIT_LIMIT = 50;
    public static final int MAX_COMMIT_LIMIT = 200;

    /** 单次提交变更文件列表上限（防止巨型 commit 拖垮响应）。 */
    private static final int MAX_FILES_PER_COMMIT = 500;

    /** diff 预览上限（PRD C3.5 P1 / 04 §5）：文件数与累计 diff 文本字节，超限截断并标记 truncated。 */
    private static final int MAX_DIFF_FILES = 100;
    private static final int MAX_DIFF_BYTES = 256 * 1024;

    /** 校验路径是否为 Git 仓库，返回 HEAD 信息（PRD C3.1 / 04 §5 GET /git/repo/status）。 */
    public RepoStatus status(String path) {
        try (Repository repo = open(path)) {
            ObjectId head = repo.resolve("HEAD");
            String branch = head == null ? null : repo.getBranch();
            return new RepoStatus(path.trim(), head == null ? null : head.getName(), branch);
        } catch (IOException | IllegalArgumentException e) {
            throw new BadRequestException("路径不是有效的 Git 仓库：" + path, e);
        }
    }

    /**
     * 提交历史（新→旧）：since/until 为完整 hash，语义与 04 §5 契约一致（since=会话 start_head 即「新提交感知」来源）。
     * since/until 不可解析时忽略该过滤条件（start_head 可能已不在仓库中），仅受 limit 约束。
     */
    public List<CommitInfo> commits(String path, String since, String until, Integer limit) {
        try (Repository repo = open(path)) {
            ObjectId head = repo.resolve("HEAD");
            if (head == null) {
                return List.of(); // 空仓库：无提交历史
            }
            int n = Math.min(Math.max(limit == null ? DEFAULT_COMMIT_LIMIT : limit, 1), MAX_COMMIT_LIMIT);
            try (RevWalk walk = new RevWalk(repo)) {
                walk.markStart(walk.parseCommit(head));
                markUninteresting(walk, repo, since);
                markUninteresting(walk, repo, until);
                List<CommitInfo> out = new ArrayList<>();
                for (RevCommit c : walk) {
                    if (out.size() >= n) {
                        break;
                    }
                    out.add(toCommitInfo(repo, c));
                }
                return out;
            }
        } catch (IOException | IllegalArgumentException e) {
            throw new BadRequestException("路径不是有效的 Git 仓库：" + path, e);
        }
    }

    /** 提交是否存在（hash 完整 40 位）；用于绑定时校验证据真实存在（08 §10.6）。仓库不可读 → 400。 */
    public boolean hasCommit(String path, String hash) {
        try (Repository repo = open(path)) {
            ObjectId id = repo.resolve(hash);
            if (id == null) {
                return false;
            }
            try (RevWalk walk = new RevWalk(repo)) {
                // parseCommit 对缺失对象抛 MissingObjectException、对非 commit 抛 IncorrectObjectTypeException → 均视为不存在
                walk.parseCommit(id);
                return true;
            } catch (MissingObjectException | IncorrectObjectTypeException e) {
                return false;
            }
        } catch (IOException | IllegalArgumentException e) {
            throw new BadRequestException("路径不是有效的 Git 仓库：" + path, e);
        }
    }

    /** 单个提交详情（M3 任务四 commit 详情弹层，PRD C3.5：hash/作者/时间/完整 message/变更文件列表）。 */
    public CommitInfo commitDetail(String path, String hash) {
        try (Repository repo = open(path)) {
            ObjectId id = repo.resolve(hash);
            if (id == null) {
                throw new NotFoundException("提交不存在：" + hash);
            }
            try (RevWalk walk = new RevWalk(repo)) {
                return toCommitInfo(repo, walk.parseCommit(id));
            } catch (MissingObjectException | IncorrectObjectTypeException e) {
                throw new NotFoundException("提交不存在：" + hash);
            }
        } catch (IOException | IllegalArgumentException e) {
            throw new BadRequestException("路径不是有效的 Git 仓库：" + path, e);
        }
    }

    /**
     * 提交 diff 预览（v1.1 P1，PRD C3.5「diff 预览 P1」/ 04 §5 GET /git/repo/commits/{hash}/diff）：
     * 相对首个父提交输出 unified diff（根提交 = 全部文件为新增，EmptyTreeIterator）。
     * 防巨型提交：文件数 > 100 或累计 diff 文本 > 256KB 时截断并标记 truncated（08 §10.4 不读大仓库全量）。
     */
    public CommitDiff diff(String path, String hash) {
        try (Repository repo = open(path)) {
            ObjectId id = repo.resolve(hash);
            if (id == null) {
                throw new NotFoundException("提交不存在：" + hash);
            }
            try (RevWalk walk = new RevWalk(repo)) {
                RevCommit c = walk.parseCommit(id);
                RevCommit parent = c.getParentCount() > 0 ? walk.parseCommit(c.getParent(0)) : null;

                List<FileDiff> files = new ArrayList<>();
                boolean truncated = false;
                int totalBytes = 0;
                List<DiffEntry> entries;
                try (ObjectReader reader = repo.newObjectReader();
                     DiffFormatter scanner = new DiffFormatter(new ByteArrayOutputStream())) {
                    scanner.setRepository(repo);
                    scanner.setDiffComparator(RawTextComparator.DEFAULT);
                    scanner.setDetectRenames(true);
                    AbstractTreeIterator oldTree = parent == null
                            ? new EmptyTreeIterator() // 根提交：全量新增
                            : new CanonicalTreeParser(null, reader, parent.getTree());
                    entries = scanner.scan(oldTree, new CanonicalTreeParser(null, reader, c.getTree()));
                }
                for (DiffEntry entry : entries) {
                    if (files.size() >= MAX_DIFF_FILES) {
                        truncated = true;
                        break;
                    }
                    ByteArrayOutputStream out = new ByteArrayOutputStream();
                    try (DiffFormatter f = new DiffFormatter(out)) {
                        f.setRepository(repo);
                        f.setDiffComparator(RawTextComparator.DEFAULT);
                        f.format(entry);
                    }
                    String text = out.toString(StandardCharsets.UTF_8);
                    if (totalBytes + text.length() > MAX_DIFF_BYTES) {
                        truncated = true;
                        break;
                    }
                    totalBytes += text.length();
                    LineCount lc = countDiffLines(text);
                    files.add(new FileDiff(entry.getNewPath(), text, lc.added(), lc.deleted()));
                }
                return new CommitDiff(hash, files, truncated);
            } catch (MissingObjectException | IncorrectObjectTypeException e) {
                throw new NotFoundException("提交不存在：" + hash);
            }
        } catch (IOException | IllegalArgumentException e) {
            throw new BadRequestException("路径不是有效的 Git 仓库：" + path, e);
        }
    }

    /**
     * unified diff 文本行统计（纯函数）：'+'/'−' 开头行计数，排除文件头（---/+++）与 hunk 头（@@）。
     * 供前端展示每个文件的增删行数徽标。
     */
    public static LineCount countDiffLines(String diffText) {
        int added = 0;
        int deleted = 0;
        for (String line : diffText.split("\n", -1)) {
            if (line.startsWith("+++") || line.startsWith("---") || line.startsWith("@@")) {
                continue;
            }
            if (line.startsWith("+")) {
                added++;
            } else if (line.startsWith("-")) {
                deleted++;
            }
        }
        return new LineCount(added, deleted);
    }

    private Repository open(String path) throws IOException {
        if (path == null || path.isBlank()) {
            throw new BadRequestException("仓库路径不能为空");
        }
        return new FileRepositoryBuilder()
                .findGitDir(Path.of(path.trim()).toFile())
                .build();
    }

    /** 把 since/until 标记为「不感兴趣」；引用不可解析时静默忽略（会话 start_head 可能已随历史清理）。 */
    private void markUninteresting(RevWalk walk, Repository repo, String rev) {
        if (rev == null || rev.isBlank()) {
            return;
        }
        try {
            ObjectId id = repo.resolve(rev);
            if (id != null) {
                walk.markUninteresting(walk.parseCommit(id));
            }
        } catch (IOException | RuntimeException ignored) {
            // 忽略无法解析的历史引用，退化为「返回最新 N 条」
        }
    }

    private CommitInfo toCommitInfo(Repository repo, RevCommit c) throws IOException {
        PersonIdent author = c.getAuthorIdent();
        LocalDateTime time = author == null || author.getWhen() == null
                ? null
                : LocalDateTime.ofInstant(author.getWhen().toInstant(), ZoneId.systemDefault());
        return new CommitInfo(
                c.getId().getName(),
                author == null ? "" : author.getName(),
                author == null ? null : author.getEmailAddress(),
                time,
                c.getFullMessage().trim(),
                changedFiles(repo, c));
    }

    /** 相对首个父提交的变更文件列表（根提交 = 全部文件）；按路径排序稳定输出。 */
    private List<String> changedFiles(Repository repo, RevCommit c) throws IOException {
        List<String> files = new ArrayList<>();
        try (TreeWalk tw = new TreeWalk(repo)) {
            tw.setRecursive(true);
            tw.addTree(c.getTree());
            if (c.getParentCount() > 0) {
                try (RevWalk rw = new RevWalk(repo)) {
                    tw.addTree(rw.parseCommit(c.getParent(0)).getTree());
                }
                tw.setFilter(TreeFilter.ANY_DIFF);
            }
            while (tw.next() && files.size() < MAX_FILES_PER_COMMIT) {
                files.add(tw.getPathString());
            }
        }
        return files;
    }

    /** 仓库校验结果：head 为完整 40 位 hash（空仓库为 null），branch 为当前分支（detached HEAD 时为 null）。 */
    public record RepoStatus(String path, String head, String branch) {
    }

    /** 提交元信息（04 §5：hash/author/time/message/files；不读 diff，性能可忽略，04 §6.2）。 */
    public record CommitInfo(String hash, String author, String authorEmail,
                             LocalDateTime time, String message, List<String> files) {
    }

    /** 提交 diff 预览（v1.1 P1）：files 为相对首父的统一 diff（根提交全新增），truncated 表示超限截断。 */
    public record CommitDiff(String hash, List<FileDiff> files, boolean truncated) {
    }

    /** 单个文件 diff：path 为变更后路径，diff 为 unified diff 文本（含文件头与 hunk 头），added/deleted 为行统计。 */
    public record FileDiff(String path, String diff, int added, int deleted) {
    }

    /** 增删行统计（countDiffLines 返回值）。 */
    public record LineCount(int added, int deleted) {
    }
}
