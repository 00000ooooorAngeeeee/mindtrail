package com.trailmind.backend.entity;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableField;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;

import java.time.LocalDateTime;
import java.util.List;

/**
 * vibecoding 记录会话（映射 session 表，docs/05 §3）。
 * status 取值 active|completed（DB ENUM，字符串映射）。
 * entryCount 为列表统计列；entries/entryTotal 为详情页分页结果（均非表字段）。
 */
@TableName("session")
public class Session {

    @TableId(type = IdType.AUTO)
    private Long id;

    private Long workspaceId;
    private String title;
    private String status;
    private String repoPath;
    private String startHead;
    private String endHead;
    private String summary;
    private LocalDateTime startedAt;
    private LocalDateTime endedAt;
    private LocalDateTime createdAt;
    private LocalDateTime updatedAt;

    @TableField(exist = false)
    private Long entryCount;

    @TableField(exist = false)
    private List<Entry> entries;

    @TableField(exist = false)
    private Long entryTotal;

    public Long getId() {
        return id;
    }

    public void setId(Long id) {
        this.id = id;
    }

    public Long getWorkspaceId() {
        return workspaceId;
    }

    public void setWorkspaceId(Long workspaceId) {
        this.workspaceId = workspaceId;
    }

    public String getTitle() {
        return title;
    }

    public void setTitle(String title) {
        this.title = title;
    }

    public String getStatus() {
        return status;
    }

    public void setStatus(String status) {
        this.status = status;
    }

    public String getRepoPath() {
        return repoPath;
    }

    public void setRepoPath(String repoPath) {
        this.repoPath = repoPath;
    }

    public String getStartHead() {
        return startHead;
    }

    public void setStartHead(String startHead) {
        this.startHead = startHead;
    }

    public String getEndHead() {
        return endHead;
    }

    public void setEndHead(String endHead) {
        this.endHead = endHead;
    }

    public String getSummary() {
        return summary;
    }

    public void setSummary(String summary) {
        this.summary = summary;
    }

    public LocalDateTime getStartedAt() {
        return startedAt;
    }

    public void setStartedAt(LocalDateTime startedAt) {
        this.startedAt = startedAt;
    }

    public LocalDateTime getEndedAt() {
        return endedAt;
    }

    public void setEndedAt(LocalDateTime endedAt) {
        this.endedAt = endedAt;
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

    public Long getEntryCount() {
        return entryCount;
    }

    public void setEntryCount(Long entryCount) {
        this.entryCount = entryCount;
    }

    public List<Entry> getEntries() {
        return entries;
    }

    public void setEntries(List<Entry> entries) {
        this.entries = entries;
    }

    public Long getEntryTotal() {
        return entryTotal;
    }

    public void setEntryTotal(Long entryTotal) {
        this.entryTotal = entryTotal;
    }
}
