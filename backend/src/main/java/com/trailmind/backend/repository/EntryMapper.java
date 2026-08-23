package com.trailmind.backend.repository;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.trailmind.backend.entity.Entry;
import org.apache.ibatis.annotations.Delete;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;
import org.apache.ibatis.annotations.Update;

import java.util.List;
import java.time.LocalDateTime;

/**
 * entry 表 Mapper。
 * nextSeq：会话内新条目序号，service 层事务内调用（05 §5「MAX(seq)+1 计算」）。
 * 级联删除系列：删除会话/单条目时按「子先于父」显式清理关联表（无物理外键，service 层保证）。
 */
@Mapper
public interface EntryMapper extends BaseMapper<Entry> {

    @Select("SELECT COALESCE(MAX(seq), 0) + 1 FROM entry WHERE session_id = #{sessionId}")
    Integer nextSeq(@Param("sessionId") Long sessionId);

    @Select("SELECT COALESCE(MAX(seq), 0) FROM entry WHERE session_id = #{sessionId}")
    Integer maxSeq(@Param("sessionId") Long sessionId);

    /** 插入条目（PRD C2.5）：afterSeq 之后全部条目 seq +1（seq 重排）。事务内调用；降序更新避免中间态与索引顺序抖动。 */
    @Update("UPDATE entry SET seq = seq + 1 WHERE session_id = #{sessionId} AND seq > #{afterSeq} ORDER BY seq DESC")
    int shiftSeq(@Param("sessionId") Long sessionId, @Param("afterSeq") int afterSeq);

    @Select("SELECT id, session_id, seq, type, content_md, created_at, updated_at " +
            "FROM entry WHERE session_id = #{sessionId} ORDER BY seq ASC LIMIT #{limit} OFFSET #{offset}")
    List<Entry> listBySession(@Param("sessionId") Long sessionId,
                              @Param("offset") int offset,
                              @Param("limit") int limit);

    @Select("SELECT COUNT(*) FROM entry WHERE session_id = #{sessionId}")
    long countBySession(@Param("sessionId") Long sessionId);

    @Delete("DELETE FROM entry WHERE session_id = #{sessionId}")
    int deleteBySession(@Param("sessionId") Long sessionId);

    @Delete("DELETE FROM entry_tag WHERE entry_id IN (SELECT id FROM entry WHERE session_id = #{sessionId})")
    int deleteEntryTagsBySession(@Param("sessionId") Long sessionId);

    @Delete("DELETE FROM entry_commit WHERE entry_id IN (SELECT id FROM entry WHERE session_id = #{sessionId})")
    int deleteEntryCommitsBySession(@Param("sessionId") Long sessionId);

    @Delete("DELETE FROM entry_tag WHERE entry_id = #{entryId}")
    int deleteEntryTagsByEntry(@Param("entryId") Long entryId);

    @Delete("DELETE FROM entry_commit WHERE entry_id = #{entryId}")
    int deleteEntryCommitsByEntry(@Param("entryId") Long entryId);

    /** 全量恢复前清空整表（DML DELETE，事务内可回滚；供 BackupRestoreService）。 */
    @Delete("DELETE FROM entry")
    int deleteAll();

    /** 工作区最近条目（v1.1 联动选择器：节点挂条目对话框「最近条目」页，按创建时间倒序）。 */
    @Select("SELECT e.id, e.session_id, e.seq, e.type, e.content_md, e.created_at, s.title AS session_title " +
            "FROM entry e JOIN session s ON s.id = e.session_id " +
            "WHERE s.workspace_id = #{workspaceId} ORDER BY e.created_at DESC, e.id DESC LIMIT #{limit}")
    List<RecentRow> selectRecentByWorkspace(@Param("workspaceId") Long workspaceId, @Param("limit") int limit);

    /** 投影行：最近条目（含会话标题，联动选择器展示）。 */
    class RecentRow {
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
}
