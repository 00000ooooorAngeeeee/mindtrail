package com.trailmind.backend.repository;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.trailmind.backend.entity.Workspace;
import org.apache.ibatis.annotations.Delete;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Select;

import java.util.List;

/**
 * workspace 表 Mapper。listWithCounts 一次查询带出导图数/会话数统计（避免 N+1）。
 * 级联删除系列：删除工作区时按「子先于父」显式清理（无物理外键，service 层保证，见 docs/05 §3）。
 */
@Mapper
public interface WorkspaceMapper extends BaseMapper<Workspace> {

    @Select("SELECT w.*, " +
            "(SELECT COUNT(*) FROM mindmap m WHERE m.workspace_id = w.id) AS mindmap_count, " +
            "(SELECT COUNT(*) FROM session s WHERE s.workspace_id = w.id) AS session_count " +
            "FROM workspace w ORDER BY w.id")
    List<Workspace> listWithCounts();

    @Delete("DELETE FROM entry_tag WHERE entry_id IN " +
            "(SELECT e.id FROM entry e JOIN session s ON e.session_id = s.id WHERE s.workspace_id = #{workspaceId})")
    int deleteEntryTagsByWorkspace(Long workspaceId);

    @Delete("DELETE FROM entry_commit WHERE entry_id IN " +
            "(SELECT e.id FROM entry e JOIN session s ON e.session_id = s.id WHERE s.workspace_id = #{workspaceId})")
    int deleteEntryCommitsByWorkspace(Long workspaceId);

    /** v1.1 联动级联：清理工作区内全部 node_entry（导图侧与条目侧都要覆盖，05 §3 显式级联）。 */
    @Delete("DELETE FROM node_entry WHERE mindmap_id IN (SELECT id FROM mindmap WHERE workspace_id = #{workspaceId}) " +
            "OR entry_id IN (SELECT e.id FROM entry e JOIN session s ON e.session_id = s.id " +
            "WHERE s.workspace_id = #{workspaceId})")
    int deleteNodeEntriesByWorkspace(Long workspaceId);

    @Delete("DELETE FROM entry WHERE session_id IN " +
            "(SELECT id FROM session WHERE workspace_id = #{workspaceId})")
    int deleteEntriesByWorkspace(Long workspaceId);

    @Delete("DELETE FROM session WHERE workspace_id = #{workspaceId}")
    int deleteSessionsByWorkspace(Long workspaceId);

    @Delete("DELETE FROM mindmap WHERE workspace_id = #{workspaceId}")
    int deleteMindmapsByWorkspace(Long workspaceId);

    @Delete("DELETE FROM tag WHERE workspace_id = #{workspaceId}")
    int deleteTagsByWorkspace(Long workspaceId);
}
