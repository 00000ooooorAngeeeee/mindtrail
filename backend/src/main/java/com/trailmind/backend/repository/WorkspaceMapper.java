package com.trailmind.backend.repository;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.trailmind.backend.entity.Workspace;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Select;

import java.util.List;

/**
 * workspace 表 Mapper。listWithCounts 一次查询带出导图数/会话数统计（避免 N+1）。
 */
@Mapper
public interface WorkspaceMapper extends BaseMapper<Workspace> {

    @Select("SELECT w.*, " +
            "(SELECT COUNT(*) FROM mindmap m WHERE m.workspace_id = w.id) AS mindmap_count, " +
            "(SELECT COUNT(*) FROM session s WHERE s.workspace_id = w.id) AS session_count " +
            "FROM workspace w ORDER BY w.id")
    List<Workspace> listWithCounts();
}
