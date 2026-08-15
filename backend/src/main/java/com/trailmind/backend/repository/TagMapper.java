package com.trailmind.backend.repository;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.trailmind.backend.entity.Tag;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;

/**
 * tag 表 Mapper（工作区级标签，uk_tag_workspace_name 保证唯一）。
 */
@Mapper
public interface TagMapper extends BaseMapper<Tag> {

    @Select("SELECT * FROM tag WHERE workspace_id = #{workspaceId} AND name = #{name}")
    Tag selectByWorkspaceAndName(@Param("workspaceId") Long workspaceId, @Param("name") String name);
}
