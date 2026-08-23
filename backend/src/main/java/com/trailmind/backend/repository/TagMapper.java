package com.trailmind.backend.repository;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.trailmind.backend.entity.Tag;
import org.apache.ibatis.annotations.Delete;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;

import java.time.LocalDateTime;
import java.util.List;

/**
 * tag 表 Mapper（工作区级标签，uk_tag_workspace_name 保证唯一）。
 * listByWorkspaceWithCount：M4 任务二标签管理列表（按名称排序，带条目使用计数）。
 */
@Mapper
public interface TagMapper extends BaseMapper<Tag> {

    @Select("SELECT * FROM tag WHERE workspace_id = #{workspaceId} AND name = #{name}")
    Tag selectByWorkspaceAndName(@Param("workspaceId") Long workspaceId, @Param("name") String name);

    @Select("SELECT t.id, t.workspace_id, t.name, t.created_at, " +
            "(SELECT COUNT(*) FROM entry_tag et WHERE et.tag_id = t.id) AS entry_count " +
            "FROM tag t WHERE t.workspace_id = #{workspaceId} ORDER BY t.name, t.id")
    List<TagRow> listByWorkspaceWithCount(@Param("workspaceId") Long workspaceId);

    /** 全量恢复前清空整表（DML DELETE，事务内可回滚；供 BackupRestoreService）。 */
    @Delete("DELETE FROM tag")
    int deleteAll();

    /** 列表行：标签字段 + 条目使用计数。 */
    class TagRow {
        private Long id;
        private Long workspaceId;
        private String name;
        private LocalDateTime createdAt;
        private Long entryCount;

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

        public LocalDateTime getCreatedAt() {
            return createdAt;
        }

        public void setCreatedAt(LocalDateTime createdAt) {
            this.createdAt = createdAt;
        }

        public Long getEntryCount() {
            return entryCount;
        }

        public void setEntryCount(Long entryCount) {
            this.entryCount = entryCount;
        }
    }
}
