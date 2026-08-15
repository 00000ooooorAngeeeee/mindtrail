package com.trailmind.backend.entity;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableField;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;

import java.time.LocalDateTime;
import java.util.List;

/**
 * 时间线条目（映射 entry 表，docs/05 §3）。
 * seq 为会话内序号（时间线顺序），service 层事务内 MAX(seq)+1 分配（05 §5）。
 * type 枚举见 docs/06 §2；tags 为经 entry_tag 关联的标签名（非表字段，service 层回填）。
 * 同时用作请求体（type/contentMd/tags 可写），与现有 Workspace/Mindmap 实体风格一致。
 */
@TableName("entry")
public class Entry {

    @TableId(type = IdType.AUTO)
    private Long id;

    private Long sessionId;
    private Integer seq;
    private String type;
    private String contentMd;
    private LocalDateTime createdAt;
    private LocalDateTime updatedAt;

    @TableField(exist = false)
    private List<String> tags;

    @TableField(exist = false)
    private List<String> commits;

    /** 仅请求体字段（04 §5：追加条目可携带 commitHashes 一次性绑定）；响应侧回填用 commits。 */
    @TableField(exist = false)
    private List<String> commitHashes;

    public Long getId() {
        return id;
    }

    public void setId(Long id) {
        this.id = id;
    }

    public Long getSessionId() {
        return sessionId;
    }

    public void setSessionId(Long sessionId) {
        this.sessionId = sessionId;
    }

    public Integer getSeq() {
        return seq;
    }

    public void setSeq(Integer seq) {
        this.seq = seq;
    }

    public String getType() {
        return type;
    }

    public void setType(String type) {
        this.type = type;
    }

    public String getContentMd() {
        return contentMd;
    }

    public void setContentMd(String contentMd) {
        this.contentMd = contentMd;
    }

    public LocalDateTime getCreatedAt() {
        return createdAt;
    }

    public void setCreatedAt(LocalDateTime createdAt) {
        this.createdAt = createdAt;
    }

    public LocalDateTime getUpdatedAt() {
        return updatedAt;
    }

    public void setUpdatedAt(LocalDateTime updatedAt) {
        this.updatedAt = updatedAt;
    }

    public List<String> getTags() {
        return tags;
    }

    public void setTags(List<String> tags) {
        this.tags = tags;
    }

    public List<String> getCommits() {
        return commits;
    }

    public void setCommits(List<String> commits) {
        this.commits = commits;
    }

    public List<String> getCommitHashes() {
        return commitHashes;
    }

    public void setCommitHashes(List<String> commitHashes) {
        this.commitHashes = commitHashes;
    }
}
