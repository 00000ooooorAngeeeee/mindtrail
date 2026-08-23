package com.trailmind.backend.repository;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.trailmind.backend.entity.EntryTag;
import org.apache.ibatis.annotations.Delete;
import org.apache.ibatis.annotations.Insert;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;

import java.time.LocalDateTime;
import java.util.List;

/**
 * entry_tag 表 Mapper。分页加载时按会话批量取「条目 id → 标签名」，避免逐条 N+1。
 * M4 任务二：按标签筛条目（selectByTag/selectTagNamesByEntries）、标签管理（deleteByTag/countByTag/
 * retagEntries 合并）。
 */
@Mapper
public interface EntryTagMapper extends BaseMapper<EntryTag> {

    /** 重建关联前的清理（写操作在 service 层事务内重建条目标签关联）。 */
    @Delete("DELETE FROM entry_tag WHERE entry_id = #{entryId}")
    int deleteByEntry(@Param("entryId") Long entryId);

    @Select("SELECT et.entry_id, t.name FROM tag t JOIN entry_tag et ON et.tag_id = t.id " +
            "WHERE et.entry_id IN (SELECT id FROM entry WHERE session_id = #{sessionId}) " +
            "ORDER BY et.entry_id, t.name")
    List<TagName> selectTagNamesBySession(@Param("sessionId") Long sessionId);

    @Select("SELECT t.name FROM tag t JOIN entry_tag et ON et.tag_id = t.id " +
            "WHERE et.entry_id = #{entryId} ORDER BY t.name")
    List<String> selectNamesByEntry(@Param("entryId") Long entryId);

    /** 删除标签级联：清空该标签的全部条目关联（service 层显式处理，05 §3）。 */
    @Delete("DELETE FROM entry_tag WHERE tag_id = #{tagId}")
    int deleteByTag(@Param("tagId") Long tagId);

    /** 全量恢复前清空整表（DML DELETE，事务内可回滚；供 BackupRestoreService）。 */
    @Delete("DELETE FROM entry_tag")
    int deleteAll();

    /** 标签使用计数。 */
    @Select("SELECT COUNT(*) FROM entry_tag WHERE tag_id = #{tagId}")
    long countByTag(@Param("tagId") Long tagId);

    /** 合并：源标签条目重挂目标标签（已含目标标签的条目跳过，防主键冲突）。 */
    @Insert("INSERT INTO entry_tag (entry_id, tag_id) " +
            "SELECT et.entry_id, #{toTagId} FROM entry_tag et WHERE et.tag_id = #{fromTagId} " +
            "AND et.entry_id NOT IN (SELECT entry_id FROM entry_tag WHERE tag_id = #{toTagId})")
    int retagEntries(@Param("fromTagId") Long fromTagId, @Param("toTagId") Long toTagId);

    /** 按标签筛条目（tagId 必传；sessionId 可选会话内过滤）；按会话开始时间倒序 + seq 正序，LIMIT 500。 */
    @Select("""
            <script>
            SELECT e.id, e.session_id, e.seq, e.type, e.content_md, e.created_at,
                   s.title AS session_title, s.workspace_id, w.name AS workspace_name
            FROM entry_tag et
            JOIN entry e ON e.id = et.entry_id
            JOIN session s ON s.id = e.session_id
            JOIN workspace w ON w.id = s.workspace_id
            WHERE et.tag_id = #{tagId}
            <if test="sessionId != null"> AND e.session_id = #{sessionId}</if>
            ORDER BY s.started_at DESC, s.id DESC, e.seq ASC
            LIMIT 500
            </script>
            """)
    List<FilteredRow> selectByTag(@Param("tagId") Long tagId, @Param("sessionId") Long sessionId);

    /** 按条目 id 集合批量取标签名（过滤列表回填，避免 N+1）；空集合勿调用（IN () 语法错误）。 */
    @Select("""
            <script>
            SELECT et.entry_id, t.name FROM tag t JOIN entry_tag et ON et.tag_id = t.id
            WHERE et.entry_id IN
            <foreach collection="entryIds" item="id" open="(" separator="," close=")">#{id}</foreach>
            ORDER BY et.entry_id, t.name
            </script>
            """)
    List<TagName> selectTagNamesByEntries(@Param("entryIds") List<Long> entryIds);

    /** 投影行：条目 id + 标签名（MyBatis 按下划线转驼峰自动映射）。 */
    class TagName {
        private Long entryId;
        private String name;

        public Long getEntryId() {
            return entryId;
        }

        public void setEntryId(Long entryId) {
            this.entryId = entryId;
        }

        public String getName() {
            return name;
        }

        public void setName(String name) {
            this.name = name;
        }
    }

    /** 按标签筛出的条目行（含会话/工作区上下文）。 */
    class FilteredRow {
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
}
