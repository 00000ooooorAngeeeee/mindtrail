package com.trailmind.backend.git;

import com.trailmind.backend.common.BadRequestException;
import org.eclipse.jgit.api.Git;
import org.eclipse.jgit.lib.PersonIdent;
import org.eclipse.jgit.revwalk.RevCommit;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.nio.file.Files;
import java.nio.file.Path;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * GitHeadReader 单测：用 JGit 在临时目录建真实仓库验证（docs/08 §6 关键逻辑：start_head/end_head 读取）。
 */
class GitHeadReaderTest {

    static {
        // 受限环境下 JGit 会异步写 ~/.config/jgit/config（文件属性缓存）；把 user.home 重定向到临时目录，避免写入失败告警。
        System.setProperty("user.home", System.getProperty("java.io.tmpdir"));
    }

    @TempDir
    Path tempDir;

    private final GitHeadReader reader = new GitHeadReader();

    @Test
    void readHead_blank_path_returns_null() {
        assertNull(reader.readHead(null));
        assertNull(reader.readHead("   "));
    }

    @Test
    void readHead_invalid_repo_throws() {
        assertThrows(BadRequestException.class,
                () -> reader.readHead(tempDir.resolve("not-a-repo").toString()));
    }

    @Test
    void readHead_empty_repo_returns_null() throws Exception {
        Path repo = Files.createDirectory(tempDir.resolve("empty"));
        try (Git ignored = Git.init().setDirectory(repo.toFile()).call()) {
            assertNull(reader.readHead(repo.toString()));
        }
    }

    @Test
    void readHead_with_commit_returns_full_hash() throws Exception {
        Path repo = Files.createDirectory(tempDir.resolve("with-commit"));
        String hash;
        try (Git git = Git.init().setDirectory(repo.toFile()).call()) {
            Files.writeString(repo.resolve("a.txt"), "hello");
            git.add().addFilepattern(".").call();
            PersonIdent ident = new PersonIdent("TrailMind", "test@trailmind.local");
            RevCommit commit = git.commit().setMessage("init")
                    .setAuthor(ident).setCommitter(ident).call();
            hash = commit.getId().name();
        }

        String head = reader.readHead(repo.toString());

        assertEquals(hash, head);
        assertTrue(head != null && head.matches("[0-9a-f]{40}"), "应为 40 位小写 sha1，实际：" + head);
    }
}
