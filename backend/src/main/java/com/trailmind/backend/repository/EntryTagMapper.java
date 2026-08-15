package com.trailmind.backend.repository;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.trailmind.backend.entity.EntryTag;
import org.apache.ibatis.annotations.Delete;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;

import java.util.List;

/**
 * entry_tag 表 Mapper。分页加载时按会话批量取「条目 id → 标签名」，避免逐条 N+1。
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
}
