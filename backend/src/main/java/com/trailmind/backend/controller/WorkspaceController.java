package com.trailmind.backend.controller;

import com.trailmind.backend.common.ApiResponse;
import com.trailmind.backend.entity.Workspace;
import com.trailmind.backend.service.WorkspaceService;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

/**
 * 工作区接口：POST /workspaces 创建、GET /workspaces 列表（含导图/会话统计）。
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
}
