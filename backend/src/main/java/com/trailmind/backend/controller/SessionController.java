package com.trailmind.backend.controller;

import com.trailmind.backend.common.ApiResponse;
import com.trailmind.backend.entity.Session;
import com.trailmind.backend.service.SessionExportService;
import com.trailmind.backend.service.SessionService;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

/**
 * 记录会话接口（04 §5 契约）：
 * POST /workspaces/{wid}/sessions 开始会话（start_head 记录）、GET 列表、
 * GET /sessions/{id} 详情（含条目分页，默认每页 50）、PATCH（title/status/summary）、DELETE（级联）、
 * GET /sessions/{id}/export/markdown 导出 Markdown（严格 06 §4，M3 总验收「导出→解析→比对」）。
 */
@RestController
@RequestMapping("/api/v1")
public class SessionController {

    private final SessionService service;
    private final SessionExportService exportService;

    public SessionController(SessionService service, SessionExportService exportService) {
        this.service = service;
        this.exportService = exportService;
    }

    @PostMapping("/workspaces/{workspaceId}/sessions")
    public ApiResponse<Session> create(@PathVariable Long workspaceId, @RequestBody Session req) {
        return ApiResponse.ok(service.create(workspaceId, req.getTitle(), req.getRepoPath()));
    }

    @GetMapping("/workspaces/{workspaceId}/sessions")
    public ApiResponse<List<Session>> list(@PathVariable Long workspaceId) {
        return ApiResponse.ok(service.list(workspaceId));
    }

    @GetMapping("/sessions/{id}")
    public ApiResponse<Session> get(@PathVariable Long id,
                                    @RequestParam(defaultValue = "1") int page,
                                    @RequestParam(defaultValue = "50") int size) {
        return ApiResponse.ok(service.detail(id, page, size));
    }

    @PatchMapping("/sessions/{id}")
    public ApiResponse<Session> update(@PathVariable Long id, @RequestBody Session req) {
        return ApiResponse.ok(service.update(id, req.getTitle(), req.getStatus(), req.getSummary()));
    }

    @DeleteMapping("/sessions/{id}")
    public ApiResponse<Void> delete(@PathVariable Long id) {
        service.delete(id);
        return ApiResponse.ok(null);
    }

    @GetMapping("/sessions/{id}/export/markdown")
    public ApiResponse<String> exportMarkdown(@PathVariable Long id) {
        return ApiResponse.ok(exportService.exportMarkdown(id));
    }
}
