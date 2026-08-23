package com.trailmind.backend.controller;

import com.trailmind.backend.common.ApiResponse;
import com.trailmind.backend.common.BatchDeleteRequest;
import com.trailmind.backend.service.TagService;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

/**
 * 标签管理接口（M4 任务二，PRD D3/D4 + 04 §5 契约）：
 * GET /tags?workspaceId= 列表（含使用计数）｜ POST /tags 创建 ｜ PUT /tags/{id} 重命名（全局生效）｜
 * POST /tags/{id}/merge 合并（body: {targetId}）｜ DELETE /tags/{id}（级联清 entry_tag）｜
 * GET /entries?tagId=&sessionId= 按标签筛条目（sessionId 可选，D4 过滤即时）。
 */
@RestController
@RequestMapping("/api/v1")
public class TagController {

    private final TagService service;

    public TagController(TagService service) {
        this.service = service;
    }

    @GetMapping("/tags")
    public ApiResponse<List<TagService.TagInfo>> list(@RequestParam Long workspaceId) {
        return ApiResponse.ok(service.list(workspaceId));
    }

    @PostMapping("/tags")
    public ApiResponse<TagService.TagInfo> create(@RequestBody CreateRequest req) {
        return ApiResponse.ok(service.create(req.workspaceId(), req.name()));
    }

    @PutMapping("/tags/{id}")
    public ApiResponse<TagService.TagInfo> rename(@PathVariable Long id, @RequestBody RenameRequest req) {
        return ApiResponse.ok(service.rename(id, req.name()));
    }

    @PostMapping("/tags/{id}/merge")
    public ApiResponse<TagService.TagInfo> merge(@PathVariable Long id, @RequestBody MergeRequest req) {
        return ApiResponse.ok(service.merge(id, req.targetId()));
    }

    @DeleteMapping("/tags/{id}")
    public ApiResponse<Void> delete(@PathVariable Long id) {
        service.delete(id);
        return ApiResponse.ok(null);
    }

    /** 批量删除标签（04 §5 POST /tags/batch-delete，事务级联清 entry_tag，任一不存在 404 整体回滚）。 */
    @PostMapping("/tags/batch-delete")
    public ApiResponse<Void> batchDelete(@RequestBody BatchDeleteRequest req) {
        service.deleteBatch(req.ids());
        return ApiResponse.ok(null);
    }

    @GetMapping("/entries")
    public ApiResponse<List<TagService.FilteredEntry>> filterEntries(@RequestParam Long tagId,
                                                                     @RequestParam(required = false) Long sessionId) {
        return ApiResponse.ok(service.filterEntries(tagId, sessionId));
    }

    /** 创建标签请求体（04 §5 POST /tags）。 */
    public record CreateRequest(Long workspaceId, String name) {
    }

    /** 重命名请求体（04 §5 PUT /tags/{id}）。 */
    public record RenameRequest(String name) {
    }

    /** 合并请求体：源标签（路径 id）合并到 targetId。 */
    public record MergeRequest(Long targetId) {
    }
}
