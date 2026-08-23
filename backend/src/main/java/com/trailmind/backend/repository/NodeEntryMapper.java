package com.trailmind.backend.repository;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.trailmind.backend.entity.NodeEntry;
import org.apache.ibatis.annotations.Delete;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;

import java.time.LocalDateTime;
import java.util.List;

/**
 * node_entry 表 Mapper（导图节点-条目联动，v1.1 P1，docs/05 §3）。
 * 替换语义（先清后插）与级联删除都在 service 层事务内编排；查询侧按 content_json 节点存在性过滤由 service 做。
 * 级联系列：删除条目/会话/导图/工作区时显式清理（无物理外键，service 层保证）。
 */
@Mapper
public interface NodeEntryMapper extends BaseMapper<NodeEntry> {

    /** 节点侧替换：清空该节点挂接。 */
    @Delete("DELETE FROM node_entry WHERE mindmap_id = #{mindmapId} AND node_id = #{nodeId}")
    int deleteByMindmapAndNode(@Param("mindmapId") Long mindmapId, @Param("nodeId") String nodeId);

    /** 条目侧替换：清空该条目引用。 */
    @Delete("DELETE FROM node_entry WHERE entry_id = #{entryId}")
    int deleteByEntry(@Param("entryId") Long entryId);

    /** 删除导图级联（05 §3 显式级联）。 */
    @Delete("DELETE FROM node_entry WHERE mindmap_id = #{mindmapId}")
    int deleteByMindmap(@Param("mindmapId") Long mindmapId);

    /** 删除会话级联：先于条目删除调用（子先于父）。 */
    @Delete("DELETE FROM node_entry WHERE entry_id IN (SELECT id FROM entry WHERE session_id = #{sessionId})")
    int deleteBySession(@Param("sessionId") Long sessionId);

    /** 整图保存差异清理：删除已不存在节点的挂接（撤销场景由「保存前撤销不落库」保证不误伤，05 §4 保存语义）。 */
    @Delete("""
            <script>
            DELETE FROM node_entry WHERE mindmap_id = #{mindmapId} AND node_id IN
            <foreach collection="nodeIds" item="nid" open="(" separator="," close=")">#{nid}</foreach>
            </script>
            """)
    int deleteByMindmapAndNodeIds(@Param("mindmapId") Long mindmapId, @Param("nodeIds") List<String> nodeIds);

    /** 全量恢复前清空整表（DML DELETE，事务内可回滚；供 BackupRestoreService）。 */
    @Delete("DELETE FROM node_entry")
    int deleteAll();

    /** 节点挂接的条目 id（挂接时间正序，前端详情/对话框用）。 */
    @Select("SELECT entry_id FROM node_entry WHERE mindmap_id = #{mindmapId} AND node_id = #{nodeId} " +
            "ORDER BY created_at, entry_id")
    List<Long> selectEntryIdsByMindmapAndNode(@Param("mindmapId") Long mindmapId, @Param("nodeId") String nodeId);

    /** 导图全部挂接（nodeId → entryIds，徽标计数用，一次取全避免 N+1）。 */
    @Select("SELECT node_id, entry_id FROM node_entry WHERE mindmap_id = #{mindmapId}")
    List<NodeRow> selectByMindmap(@Param("mindmapId") Long mindmapId);

    /** 节点挂接的条目详情（含会话上下文，详情弹层数据源）。 */
    @Select("""
            SELECT e.id, e.session_id, e.seq, e.type, e.content_md, e.created_at, s.title AS session_title
            FROM node_entry ne
            JOIN entry e ON e.id = ne.entry_id
            JOIN session s ON s.id = e.session_id
            WHERE ne.mindmap_id = #{mindmapId} AND ne.node_id = #{nodeId}
            ORDER BY ne.created_at, ne.entry_id
            """)
    List<LinkedEntryRow> selectLinkedEntries(@Param("mindmapId") Long mindmapId, @Param("nodeId") String nodeId);

    /** 条目引用的挂接行（含工作区，跳转需先定位工作区）。 */
    @Select("""
            SELECT ne.mindmap_id, ne.node_id, w.id AS workspace_id
            FROM node_entry ne
            JOIN mindmap m ON m.id = ne.mindmap_id
            JOIN workspace w ON w.id = m.workspace_id
            WHERE ne.entry_id = #{entryId}
            """)
    List<NodeRefRow> selectByEntry(@Param("entryId") Long entryId);

    /** 会话内全部条目引用（时间线批量回填，避免逐条 N+1）。 */
    @Select("""
            SELECT ne.entry_id, ne.mindmap_id, ne.node_id, w.id AS workspace_id
            FROM node_entry ne
            JOIN mindmap m ON m.id = ne.mindmap_id
            JOIN workspace w ON w.id = m.workspace_id
            WHERE ne.entry_id IN (SELECT id FROM entry WHERE session_id = #{sessionId})
            """)
    List<SessionRefRow> selectBySession(@Param("sessionId") Long sessionId);

    /** 投影行：nodeId + entryId（MyBatis 按下划线转驼峰自动映射）。 */
    class NodeRow {
        private String nodeId;
        private Long entryId;

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
    }

    /** 投影行：节点挂接的条目详情。 */
    class LinkedEntryRow {
        private Long id;
        private Long sessionId;
        private Integer seq;
        private String type;
        private String contentMd;
        private LocalDateTime createdAt;
        private String sessionTitle;

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

        public String getSessionTitle() {
            return sessionTitle;
        }

        public void setSessionTitle(String sessionTitle) {
            this.sessionTitle = sessionTitle;
        }
    }

    /** 投影行：条目引用的节点（含工作区 id，前端跳转先定位工作区）。 */
    class NodeRefRow {
        private Long mindmapId;
        private String nodeId;
        private Long workspaceId;

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

        public Long getWorkspaceId() {
            return workspaceId;
        }

        public void setWorkspaceId(Long workspaceId) {
            this.workspaceId = workspaceId;
        }
    }

    /** 投影行：会话内条目引用（entryId 分组用）。 */
    class SessionRefRow {
        private Long entryId;
        private Long mindmapId;
        private String nodeId;
        private Long workspaceId;

        public Long getEntryId() {
            return entryId;
        }

        public void setEntryId(Long entryId) {
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

        public Long getWorkspaceId() {
            return workspaceId;
        }

        public void setWorkspaceId(Long workspaceId) {
            this.workspaceId = workspaceId;
        }
    }
}
