package com.trailmind.backend.git;

import com.trailmind.backend.common.BadRequestException;
import org.eclipse.jgit.lib.ObjectId;
import org.eclipse.jgit.lib.Repository;
import org.eclipse.jgit.storage.file.FileRepositoryBuilder;
import org.springframework.stereotype.Component;

import java.io.IOException;
import java.nio.file.Path;

/**
 * 读取仓库 HEAD 完整 hash（M3 会话 start_head/end_head 记录，07 §6 任务一）。
 * 仅做最小化读取：JGit 的任务三功能（提交历史/感知）继续在此基础上扩展，不在此实现。
 * 语义：路径为空 → null；空仓库（无提交）→ null；路径非法（非 Git 仓库）→ BadRequestException。
 */
@Component
public class GitHeadReader {

    public String readHead(String repoPath) {
        if (repoPath == null || repoPath.isBlank()) {
            return null;
        }
        try (Repository repo = new FileRepositoryBuilder()
                .findGitDir(Path.of(repoPath).toFile())
                .build()) {
            ObjectId head = repo.resolve("HEAD");
            return head == null ? null : head.getName();
        } catch (IllegalArgumentException | IOException e) {
            throw new BadRequestException("仓库路径无效：无法读取 Git 仓库");
        }
    }
}
