package com.trailmind.backend.repository;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.trailmind.backend.entity.Entry;
import org.apache.ibatis.annotations.Delete;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;

import java.util.List;

/**
 * entry 表 Mapper。
 * nextSeq：会话内新条目序号，service 层事务内调用（05 §5「MAX(seq)+1 计算」）。
 * 级联删除系列：删除会话/单条目时按「子先于父」显式清理关联表（无物理外键，service 层保证）。
 */
@Mapper
public interface EntryMapper extends BaseMapper<Entry> {

    @Select("SELECT COALESCE(MAX(seq), 0) + 1 FROM entry WHERE session_id = #{sessionId}")
    Integer nextSeq(@Param("sessionId") Long sessionId);

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
}
