package com.trailmind.backend.controller;

import com.trailmind.backend.common.ApiResponse;
import com.trailmind.backend.entity.Entry;
import com.trailmind.backend.service.EntryService;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

/**
 * 时间线条目接口（04 §5 契约）：
 * POST /sessions/{id}/entries 追加（type/contentMd/tags/commitHashes，seq 事务分配）、
 * PUT /entries/{id} 编辑（MVP 仅 contentMd/type/tags）、DELETE /entries/{id}（级联关联表）、
 * Git 绑定（M3 任务三）：POST /entries/{id}/commits 绑定、DELETE /entries/{id}/commits/{hash} 解绑、
 * GET /sessions/{id}/commits 会话绑定列表（Git 面板与未绑定缓冲计算）。
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
        return ApiResponse.ok(service.add(sessionId, req.getType(), req.getContentMd(), req.getTags(), req.getCommitHashes()));
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

    @PostMapping("/entries/{id}/commits")
    public ApiResponse<List<String>> bind(@PathVariable Long id, @RequestBody CommitBindRequest req) {
        return ApiResponse.ok(service.bind(id, req.commitHashes()));
    }

    @DeleteMapping("/entries/{id}/commits/{hash}")
    public ApiResponse<Void> unbind(@PathVariable Long id, @PathVariable String hash) {
        service.unbind(id, hash);
        return ApiResponse.ok(null);
    }

    @GetMapping("/sessions/{sessionId}/commits")
    public ApiResponse<List<EntryService.BoundCommit>> sessionCommits(@PathVariable Long sessionId) {
        return ApiResponse.ok(service.sessionCommits(sessionId));
    }

    /** 绑定请求体（04 §5「body: commitHash[]」，落为 commitHashes 数组字段）。 */
    public record CommitBindRequest(List<String> commitHashes) {
    }
}
