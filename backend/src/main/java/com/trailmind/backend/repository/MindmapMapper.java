package com.trailmind.backend.repository;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.trailmind.backend.entity.Mindmap;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;
import org.apache.ibatis.annotations.Update;

import java.util.List;

/**
 * mindmap 表 Mapper。
 * 列表只查摘要列（不含 content_json/search_text 大字段，避免整图进列表）；
 * 整图保存用自定义 @Update 排除 updated_at，交由 MySQL ON UPDATE CURRENT_TIMESTAMP 维护（乐观锁依赖其推进）。
 */
@Mapper
public interface MindmapMapper extends BaseMapper<Mindmap> {

    @Select("SELECT id, workspace_id, name, node_count, created_at, updated_at " +
            "FROM mindmap WHERE workspace_id = #{workspaceId} ORDER BY updated_at DESC, id DESC")
    List<Mindmap> listSummaryByWorkspace(@Param("workspaceId") Long workspaceId);

    @Update("UPDATE mindmap SET content_json = #{contentJson}, search_text = #{searchText}, node_count = #{nodeCount} " +
            "WHERE id = #{id}")
    int updateContent(@Param("id") Long id,
                      @Param("contentJson") String contentJson,
                      @Param("searchText") String searchText,
                      @Param("nodeCount") Integer nodeCount);
}
