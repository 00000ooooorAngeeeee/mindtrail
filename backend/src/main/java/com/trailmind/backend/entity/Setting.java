package com.trailmind.backend.entity;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;

import java.time.LocalDateTime;

/**
 * 应用设置实体（映射 setting 表，键值对；k 为主键）。
 * 当前键：theme（light|dark|system）、default_repo_path（默认 Git 仓库路径）。
 */
@TableName("setting")
public class Setting {

    @TableId(value = "k", type = IdType.INPUT)
    private String k;

    private String v;

    private LocalDateTime updatedAt;

    public String getK() {
        return k;
    }

    public void setK(String k) {
        this.k = k;
    }

    public String getV() {
        return v;
    }

    public void setV(String v) {
        this.v = v;
    }

    public LocalDateTime getUpdatedAt() {
        return updatedAt;
    }

    public void setUpdatedAt(LocalDateTime updatedAt) {
        this.updatedAt = updatedAt;
    }
}
