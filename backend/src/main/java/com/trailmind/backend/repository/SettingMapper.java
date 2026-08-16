package com.trailmind.backend.repository;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.trailmind.backend.entity.Setting;
import org.apache.ibatis.annotations.Delete;
import org.apache.ibatis.annotations.Insert;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;

/**
 * setting 表 Mapper（应用级键值设置）。
 * upsert：设置写入幂等（已存在则覆盖），避免「先查后写」竞态。
 */
@Mapper
public interface SettingMapper extends BaseMapper<Setting> {

    @Select("SELECT k, v, updated_at FROM setting WHERE k = #{k}")
    Setting selectByKey(@Param("k") String k);

    @Insert("INSERT INTO setting(k, v) VALUES(#{k}, #{v}) ON DUPLICATE KEY UPDATE v = VALUES(v)")
    int upsert(@Param("k") String k, @Param("v") String v);

    @Delete("DELETE FROM setting WHERE k = #{k}")
    int deleteByKey(@Param("k") String k);
}
