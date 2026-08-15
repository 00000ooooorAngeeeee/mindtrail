package com.trailmind.backend.entity;

import com.baomidou.mybatisplus.annotation.TableName;

/**
 * 条目-标签关联（映射 entry_tag 表，docs/05 §3）。联合主键（entry_id, tag_id），无自增 id。
 */
@TableName("entry_tag")
public class EntryTag {

    private Long entryId;
    private Long tagId;

    public EntryTag() {
    }

    public EntryTag(Long entryId, Long tagId) {
        this.entryId = entryId;
        this.tagId = tagId;
    }

    public Long getEntryId() {
        return entryId;
    }

    public void setEntryId(Long entryId) {
        this.entryId = entryId;
    }

    public Long getTagId() {
        return tagId;
    }

    public void setTagId(Long tagId) {
        this.tagId = tagId;
    }
}
