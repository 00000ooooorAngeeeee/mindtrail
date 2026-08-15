package com.trailmind.backend.repository;

import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;

import java.time.LocalDateTime;
import java.util.List;

/**
 * 全局搜索 SQL（M4 任务一，04 §6.3 + 05 §5）：
 * 条目/导图走 FULLTEXT ngram（布尔模式 +词，mode='fulltext'）；短词/单字（ngram_token_size=2 无
 * unigram token，实测 0 命中）整体降级 LIKE（mode='like'，子串已由 SearchQueryUtil.escapeLike 转义）。
 * 会话标题无 FULLTEXT 索引（VARCHAR(200) ≤ 千级行，LIKE 代价可忽略；为标题加 FULLTEXT 需 ALTER
 * 迁移，见 docs/05 §6 ADR），恒走 LIKE。
 * 结果各 LIMIT 50（04 §8 性能预算）；workspaceId 非空时按工作区过滤（04 §5 /search?workspaceId=）。
 * 无分页：全局搜索按相关性截断即可（04 §8「FULLTEXT + LIMIT 50」）。
 */
@Mapper
public interface SearchMapper {

    /** 条目命中行：content_md 供片段生成；会话/工作区上下文供跳转展示。 */
    class EntryRow {
        private Long id;
        private Long sessionId;
        private Integer seq;
        private String type;
        private String contentMd;
        private LocalDateTime createdAt;
        private String sessionTitle;
        private Long workspaceId;
        private String workspaceName;

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

        public Long getWorkspaceId() {
            return workspaceId;
        }

        public void setWorkspaceId(Long workspaceId) {
            this.workspaceId = workspaceId;
        }

        public String getWorkspaceName() {
            return workspaceName;
        }

        public void setWorkspaceName(String workspaceName) {
            this.workspaceName = workspaceName;
        }
    }

    /** 导图命中行：search_text 供片段生成；content_json 供节点定位（findMatchNodeId）。 */
    class MindmapRow {
        private Long id;
        private Long workspaceId;
        private String name;
        private String searchText;
        private String contentJson;
        private Integer nodeCount;
        private LocalDateTime updatedAt;
        private String workspaceName;

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

        public String getName() {
            return name;
        }

        public void setName(String name) {
            this.name = name;
        }

        public String getSearchText() {
            return searchText;
        }

        public void setSearchText(String searchText) {
            this.searchText = searchText;
        }

        public String getContentJson() {
            return contentJson;
        }

        public void setContentJson(String contentJson) {
            this.contentJson = contentJson;
        }

        public Integer getNodeCount() {
            return nodeCount;
        }

        public void setNodeCount(Integer nodeCount) {
            this.nodeCount = nodeCount;
        }

        public LocalDateTime getUpdatedAt() {
            return updatedAt;
        }

        public void setUpdatedAt(LocalDateTime updatedAt) {
            this.updatedAt = updatedAt;
        }

        public String getWorkspaceName() {
            return workspaceName;
        }

        public void setWorkspaceName(String workspaceName) {
            this.workspaceName = workspaceName;
        }
    }

    /** 会话命中行（标题 LIKE）。 */
    class SessionRow {
        private Long id;
        private Long workspaceId;
        private String title;
        private String status;
        private LocalDateTime startedAt;
        private LocalDateTime endedAt;
        private String workspaceName;

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

        public String getWorkspaceName() {
            return workspaceName;
        }

        public void setWorkspaceName(String workspaceName) {
            this.workspaceName = workspaceName;
        }
    }

    @Select("""
            <script>
            SELECT e.id, e.session_id, e.seq, e.type, e.content_md, e.created_at,
                   s.title AS session_title, s.workspace_id, w.name AS workspace_name
            FROM entry e
            JOIN session s ON s.id = e.session_id
            JOIN workspace w ON w.id = s.workspace_id
            WHERE
            <choose>
              <when test="mode == 'fulltext'">MATCH(e.content_md) AGAINST(#{clause} IN BOOLEAN MODE)</when>
              <otherwise>e.content_md LIKE CONCAT('%', #{pattern}, '%')</otherwise>
            </choose>
            <if test="workspaceId != null"> AND s.workspace_id = #{workspaceId}</if>
            ORDER BY
            <choose>
              <when test="mode == 'fulltext'">MATCH(e.content_md) AGAINST(#{clause} IN BOOLEAN MODE) DESC, e.id DESC</when>
              <otherwise>e.id DESC</otherwise>
            </choose>
            LIMIT 50
            </script>
            """)
    List<EntryRow> searchEntries(@Param("mode") String mode,
                                 @Param("clause") String clause,
                                 @Param("pattern") String pattern,
                                 @Param("workspaceId") Long workspaceId);

    @Select("""
            <script>
            SELECT m.id, m.workspace_id, m.name, m.search_text, m.content_json, m.node_count, m.updated_at,
                   w.name AS workspace_name
            FROM mindmap m
            JOIN workspace w ON w.id = m.workspace_id
            WHERE
            <choose>
              <when test="mode == 'fulltext'">MATCH(m.search_text) AGAINST(#{clause} IN BOOLEAN MODE)</when>
              <otherwise>m.search_text LIKE CONCAT('%', #{pattern}, '%')</otherwise>
            </choose>
            <if test="workspaceId != null"> AND m.workspace_id = #{workspaceId}</if>
            ORDER BY
            <choose>
              <when test="mode == 'fulltext'">MATCH(m.search_text) AGAINST(#{clause} IN BOOLEAN MODE) DESC, m.id DESC</when>
              <otherwise>m.id DESC</otherwise>
            </choose>
            LIMIT 50
            </script>
            """)
    List<MindmapRow> searchMindmaps(@Param("mode") String mode,
                                    @Param("clause") String clause,
                                    @Param("pattern") String pattern,
                                    @Param("workspaceId") Long workspaceId);

    @Select("""
            <script>
            SELECT s.id, s.workspace_id, s.title, s.status, s.started_at, s.ended_at, w.name AS workspace_name
            FROM session s
            JOIN workspace w ON w.id = s.workspace_id
            WHERE
            <foreach collection="tokens" item="t" separator=" OR ">s.title LIKE CONCAT('%', #{t}, '%')</foreach>
            <if test="workspaceId != null"> AND s.workspace_id = #{workspaceId}</if>
            ORDER BY s.started_at DESC, s.id DESC
            LIMIT 50
            </script>
            """)
    List<SessionRow> searchSessions(@Param("tokens") List<String> tokens,
                                    @Param("workspaceId") Long workspaceId);
}
