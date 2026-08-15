package com.trailmind.backend.controller;

import com.trailmind.backend.common.ApiResponse;
import com.trailmind.backend.entity.Entry;
import com.trailmind.backend.service.EntryService;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * 时间线条目接口（04 §5 契约）：
 * POST /sessions/{id}/entries 追加（type/contentMd/tags，seq 事务分配）、
 * PUT /entries/{id} 编辑（MVP 仅 contentMd/type/tags）、DELETE /entries/{id}（级联关联表）。
 */
@RestController
@RequestMapping("/api/v1")
public class EntryController {

    private final EntryService service;

    public EntryController(EntryService service) {
        this.service = service;
    }

    @PostMapping("/sessions/{sessionId}/entries")
    public ApiResponse<Entry> add(@PathVariable Long sessionId, @RequestBody Entry req) {
        return ApiResponse.ok(service.add(sessionId, req.getType(), req.getContentMd(), req.getTags()));
    }

    @PutMapping("/entries/{id}")
    public ApiResponse<Entry> update(@PathVariable Long id, @RequestBody Entry req) {
        return ApiResponse.ok(service.update(id, req.getContentMd(), req.getType(), req.getTags()));
    }

    @DeleteMapping("/entries/{id}")
    public ApiResponse<Void> delete(@PathVariable Long id) {
        service.delete(id);
        return ApiResponse.ok(null);
    }
}
