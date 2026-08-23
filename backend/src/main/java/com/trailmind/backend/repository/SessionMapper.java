package com.trailmind.backend.repository;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.trailmind.backend.entity.Session;
import org.apache.ibatis.annotations.Delete;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;

import java.util.List;

/**
 * session 表 Mapper。列表一次查询带出条目数统计（避免 N+1）；
 * 排序：进行中在前（status ENUM 字典序 active<completed），同状态按开始时间倒序（PRD C1.2）。
 */
@Mapper
public interface SessionMapper extends BaseMapper<Session> {

    @Select("SELECT s.*, (SELECT COUNT(*) FROM entry e WHERE e.session_id = s.id) AS entry_count " +
            "FROM session s WHERE s.workspace_id = #{workspaceId} " +
            "ORDER BY s.status ASC, s.started_at DESC, s.id DESC")
    List<Session> listByWorkspace(@Param("workspaceId") Long workspaceId);

    /** 全量恢复前清空整表（DML DELETE，事务内可回滚；供 BackupRestoreService）。 */
    @Delete("DELETE FROM session")
    int deleteAll();
}
