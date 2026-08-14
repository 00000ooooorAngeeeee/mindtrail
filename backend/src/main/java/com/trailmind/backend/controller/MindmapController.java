package com.trailmind.backend.controller;

import com.trailmind.backend.common.ApiResponse;
import com.trailmind.backend.entity.Mindmap;
import com.trailmind.backend.service.MindmapService;
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
 * 导图接口（04 §5 契约）：POST 新建 / GET 列表（工作区下）/ GET 详情 / PUT 整图保存（乐观锁）/ DELETE。
 */
@RestController
@RequestMapping("/api/v1")
public class MindmapController {

    private final MindmapService service;

    public MindmapController(MindmapService service) {
        this.service = service;
    }

    @PostMapping("/workspaces/{workspaceId}/mindmaps")
    public ApiResponse<Mindmap> create(@PathVariable Long workspaceId, @RequestBody Mindmap req) {
        return ApiResponse.ok(service.create(workspaceId, req.getName(), req.getContentJson()));
    }

    @GetMapping("/workspaces/{workspaceId}/mindmaps")
    public ApiResponse<List<Mindmap>> list(@PathVariable Long workspaceId) {
        return ApiResponse.ok(service.list(workspaceId));
    }

    @GetMapping("/mindmaps/{id}")
    public ApiResponse<Mindmap> get(@PathVariable Long id) {
        return ApiResponse.ok(service.get(id));
    }

    @PutMapping("/mindmaps/{id}")
    public ApiResponse<Mindmap> save(@PathVariable Long id, @RequestBody Mindmap req) {
        return ApiResponse.ok(service.save(id, req.getContentJson(), req.getUpdatedAt()));
    }

    @DeleteMapping("/mindmaps/{id}")
    public ApiResponse<Void> delete(@PathVariable Long id) {
        service.delete(id);
        return ApiResponse.ok(null);
    }
}
