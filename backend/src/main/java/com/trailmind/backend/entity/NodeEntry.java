package com.trailmind.backend.entity;

import com.baomidou.mybatisplus.annotation.TableName;

import java.time.LocalDateTime;

/**
 * 导图节点-条目联动（映射 node_entry 表，docs/05 §3，v1.1 P1）：
 * 节点挂接条目 / 条目引用节点 的关联表。联合主键（mindmap_id, node_id, entry_id），无自增 id；
 * 挂接关系不写入 content_json（避免整图 JSON 漂移），由 service 层保证引用完整性（05 §3 外键策略）。
 */
@TableName("node_entry")
public class NodeEntry {

    private Long mindmapId;
    /** content_json 内节点 id（如 n1，05 §4；节点删除后由查询侧按存在性过滤）。 */
    private String nodeId;
    private Long entryId;
    private LocalDateTime createdAt;

    public NodeEntry() {
    }

    public NodeEntry(Long mindmapId, String nodeId, Long entryId) {
        this.mindmapId = mindmapId;
        this.nodeId = nodeId;
        this.entryId = entryId;
    }

    public Long getMindmapId() {
        return mindmapId;
    }

    public void setMindmapId(Long mindmapId) {
        this.mindmapId = mindmapId;
    }

    public String getNodeId() {
        return nodeId;
    }

    public void setNodeId(String nodeId) {
        this.nodeId = nodeId;
    }

    public Long getEntryId() {
        return entryId;
    }

    public void setEntryId(Long entryId) {
        this.entryId = entryId;
    }

    public LocalDateTime getCreatedAt() {
        return createdAt;
    }

    public void setCreatedAt(LocalDateTime createdAt) {
        this.createdAt = createdAt;
    }
}
