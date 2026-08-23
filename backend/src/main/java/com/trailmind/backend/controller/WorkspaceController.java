package com.trailmind.backend.controller;

import com.trailmind.backend.common.ApiResponse;
import com.trailmind.backend.common.BatchDeleteRequest;
import com.trailmind.backend.entity.Workspace;
import com.trailmind.backend.service.WorkspaceService;
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
 * 工作区接口（04 §5 契约）：POST 创建、GET 列表、GET/{id} 详情、PUT 更新、DELETE 删除（级联）。
 */
@RestController
@RequestMapping("/api/v1/workspaces")
public class WorkspaceController {

    private final WorkspaceService service;

    public WorkspaceController(WorkspaceService service) {
        this.service = service;
    }

    @PostMapping
    public ApiResponse<Workspace> create(@RequestBody Workspace req) {
        return ApiResponse.ok(service.create(req.getName(), req.getDescription(), req.getRepoPath()));
    }

    @GetMapping
    public ApiResponse<List<Workspace>> list() {
        return ApiResponse.ok(service.list());
    }

    @GetMapping("/{id}")
    public ApiResponse<Workspace> get(@PathVariable Long id) {
        return ApiResponse.ok(service.get(id));
    }

    @PutMapping("/{id}")
    public ApiResponse<Workspace> update(@PathVariable Long id, @RequestBody Workspace req) {
        return ApiResponse.ok(service.update(id, req.getName(), req.getDescription(), req.getRepoPath()));
    }

    @DeleteMapping("/{id}")
    public ApiResponse<Void> delete(@PathVariable Long id) {
        service.delete(id);
        return ApiResponse.ok(null);
    }

    /** 批量删除工作区（04 §5 POST /workspaces/batch-delete，事务级联，任一不存在 404 整体回滚）。 */
    @PostMapping("/batch-delete")
    public ApiResponse<Void> batchDelete(@RequestBody BatchDeleteRequest req) {
        service.deleteBatch(req.ids());
        return ApiResponse.ok(null);
    }
}
