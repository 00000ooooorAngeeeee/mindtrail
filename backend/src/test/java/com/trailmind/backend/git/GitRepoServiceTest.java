package com.trailmind.backend.git;

import com.trailmind.backend.common.BadRequestException;
import org.eclipse.jgit.api.Git;
import org.eclipse.jgit.lib.PersonIdent;
import org.eclipse.jgit.revwalk.RevCommit;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * GitRepoService 单测（docs/08 §6 关键逻辑：仓库校验、提交历史读取）：
 * 用 JGit 在临时目录建真实仓库逐项验证，不依赖外部 git 命令。
 */
class GitRepoServiceTest {

    static {
        // 受限环境下 JGit 会异步写 ~/.config/jgit/config（文件属性缓存）；把 user.home 重定向到临时目录，避免写入失败告警。
        System.setProperty("user.home", System.getProperty("java.io.tmpdir"));
    }

    @TempDir
    Path tempDir;

    private final GitRepoService service = new GitRepoService();

    private static final PersonIdent IDENT = new PersonIdent("验证者", "verify@trailmind.local");

    /** 建一个带 count 次提交的仓库，每次提交写入 fileN.txt；返回仓库路径与各提交 hash（新→旧）。 */
    private List<String> initRepoWithCommits(String name, int count) throws Exception {
        Path repo = Files.createDirectory(tempDir.resolve(name));
        List<String> hashes = new java.util.ArrayList<>();
        try (Git git = Git.init().setDirectory(repo.toFile()).call()) {
            for (int i = 1; i <= count; i++) {
                Files.writeString(repo.resolve("file" + i + ".txt"), "内容 " + i);
                git.add().addFilepattern(".").call();
                RevCommit c = git.commit().setMessage("提交 " + i)
                        .setAuthor(IDENT).setCommitter(IDENT).call();
                hashes.add(0, c.getId().name());
            }
        }
        return hashes;
    }

    // ---------- status ----------

    @Test
    void status_blank_path_throws() {
        assertThrows(BadRequestException.class, () -> service.status(null));
        assertThrows(BadRequestException.class, () -> service.status("   "));
    }

    @Test
    void status_invalid_path_throws() {
        BadRequestException e = assertThrows(BadRequestException.class,
                () -> service.status(tempDir.resolve("not-a-repo").toString()));
        assertTrue(e.getMessage().contains("不是有效的 Git 仓库"));
    }

    @Test
    void status_empty_repo_head_null() throws Exception {
        Path repo = Files.createDirectory(tempDir.resolve("empty"));
        try (Git ignored = Git.init().setDirectory(repo.toFile()).call()) {
            GitRepoService.RepoStatus status = service.status(repo.toString());
            assertNull(status.head());
        }
    }

    @Test
    void status_with_commit_returns_full_hash_and_branch() throws Exception {
        List<String> hashes = initRepoWithCommits("status-repo", 1);
        String path = tempDir.resolve("status-repo").toString();

        GitRepoService.RepoStatus status = service.status(path);

        assertEquals(hashes.get(0), status.head());
        assertTrue(status.head() != null && status.head().matches("[0-9a-f]{40}"));
        assertNotNull(status.branch());
        assertEquals(path, status.path());
    }

    // ---------- commits ----------

    @Test
    void commits_blank_or_invalid_path_throws() {
        assertThrows(BadRequestException.class, () -> service.commits("", null, null, null));
        assertThrows(BadRequestException.class,
                () -> service.commits(tempDir.resolve("no-repo").toString(), null, null, null));
    }

    @Test
    void commits_empty_repo_returns_empty_list() throws Exception {
        Path repo = Files.createDirectory(tempDir.resolve("empty2"));
        try (Git ignored = Git.init().setDirectory(repo.toFile()).call()) {
            assertTrue(service.commits(repo.toString(), null, null, null).isEmpty());
        }
    }

    @Test
    void commits_returns_newest_first_with_author_time_message_files() throws Exception {
        List<String> hashes = initRepoWithCommits("hist-repo", 3);
        String path = tempDir.resolve("hist-repo").toString();

        List<GitRepoService.CommitInfo> list = service.commits(path, null, null, null);

        assertEquals(3, list.size());
        assertEquals(hashes.get(0), list.get(0).hash()); // 新→旧
        assertEquals(hashes.get(2), list.get(2).hash());
        GitRepoService.CommitInfo newest = list.get(0);
        assertEquals("提交 3", newest.message());
        assertEquals("验证者", newest.author());
        assertEquals("verify@trailmind.local", newest.authorEmail());
        assertNotNull(newest.time());
        assertEquals(List.of("file3.txt"), newest.files());
        assertTrue(list.get(1).time().isBefore(newest.time()) || list.get(1).time().equals(newest.time()),
                "历史顺序时间应非递增");
    }

    @Test
    void commits_multi_file_change_lists_all_files() throws Exception {
        Path repo = Files.createDirectory(tempDir.resolve("files-repo"));
        try (Git git = Git.init().setDirectory(repo.toFile()).call()) {
            Files.writeString(repo.resolve("a.txt"), "a");
            Files.createDirectory(repo.resolve("sub"));
            Files.writeString(repo.resolve("sub/b.txt"), "b");
            git.add().addFilepattern(".").call();
            git.commit().setMessage("双文件").setAuthor(IDENT).setCommitter(IDENT).call();
        }

        GitRepoService.CommitInfo c = service.commits(repo.toString(), null, null, null).get(0);

        assertEquals(List.of("a.txt", "sub/b.txt"), c.files());
    }

    @Test
    void commits_since_filters_to_newer_commits() throws Exception {
        List<String> hashes = initRepoWithCommits("since-repo", 3);
        String path = tempDir.resolve("since-repo").toString();

        List<GitRepoService.CommitInfo> list = service.commits(path, hashes.get(1), null, null);

        // since=第 2 个提交 → 只剩比它更新的第 1 个（最新）
        assertEquals(1, list.size());
        assertEquals(hashes.get(0), list.get(0).hash());
    }

    @Test
    void commits_until_excludes_commit_and_ancestors() throws Exception {
        List<String> hashes = initRepoWithCommits("until-repo", 3);
        String path = tempDir.resolve("until-repo").toString();

        List<GitRepoService.CommitInfo> list = service.commits(path, null, hashes.get(2), null);

        // until=最早提交 → 其后所有提交都可见
        assertEquals(2, list.size());
        assertEquals(hashes.get(0), list.get(0).hash());
        assertEquals(hashes.get(1), list.get(1).hash());
    }

    @Test
    void commits_limit_caps_and_clamps_range() throws Exception {
        initRepoWithCommits("limit-repo", 5);
        String path = tempDir.resolve("limit-repo").toString();

        assertEquals(2, service.commits(path, null, null, 2).size());
        assertEquals(1, service.commits(path, null, null, 0).size()); // 下限收敛为 1
        assertEquals(5, service.commits(path, null, null, 9999).size()); // 上限 200 > 仓库 5 条 → 全量
        assertEquals(5, service.commits(path, null, null, null).size()); // 默认 50 > 仓库 5 条 → 全量
    }

    @Test
    void commits_unresolvable_since_falls_back_to_latest() throws Exception {
        List<String> hashes = initRepoWithCommits("fallback-repo", 2);
        String path = tempDir.resolve("fallback-repo").toString();

        // since 用不存在的 hash（模拟 start_head 已被历史清理）→ 忽略过滤，返回最新 N 条
        List<GitRepoService.CommitInfo> list = service.commits(path, "0".repeat(40), null, null);

        assertEquals(2, list.size());
        assertEquals(hashes.get(0), list.get(0).hash());
    }

    // ---------- hasCommit ----------

    @Test
    void hasCommit_returns_true_for_existing_commit() throws Exception {
        List<String> hashes = initRepoWithCommits("has-repo", 2);
        assertTrue(service.hasCommit(tempDir.resolve("has-repo").toString(), hashes.get(1)));
    }

    @Test
    void hasCommit_returns_false_for_unknown_hash() throws Exception {
        initRepoWithCommits("has2-repo", 1);
        assertFalse(service.hasCommit(tempDir.resolve("has2-repo").toString(), "a".repeat(40)));
    }

    @Test
    void hasCommit_invalid_repo_throws() {
        assertThrows(BadRequestException.class,
                () -> service.hasCommit(tempDir.resolve("no-repo2").toString(), "a".repeat(40)));
    }
}
