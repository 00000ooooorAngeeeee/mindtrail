package com.trailmind.backend.entity;

import com.baomidou.mybatisplus.annotation.TableName;

import java.time.LocalDateTime;

/**
 * 条目-Git 提交绑定（映射 entry_commit 表，docs/05 §3）。
 * commit 本身不落库，仅记录 hash 与来源仓库（05 §6 ADR「commit 存储」），元数据实时从仓库读取。
 * 一条 commit 可绑定多个条目（共享提交，06 §5）；同一 (entry_id, commit_hash) 唯一（主键）。
 */
@TableName("entry_commit")
public class EntryCommit {

    private Long entryId;
    private String commitHash;
    private String repoPath;
    private LocalDateTime boundAt;

    public Long getEntryId() {
        return entryId;
    }

    public void setEntryId(Long entryId) {
        this.entryId = entryId;
    }

    public String getCommitHash() {
        return commitHash;
    }

    public void setCommitHash(String commitHash) {
        this.commitHash = commitHash;
    }

    public String getRepoPath() {
        return repoPath;
    }

    public void setRepoPath(String repoPath) {
        this.repoPath = repoPath;
    }

    public LocalDateTime getBoundAt() {
        return boundAt;
    }

    public void setBoundAt(LocalDateTime boundAt) {
        this.boundAt = boundAt;
    }
}
