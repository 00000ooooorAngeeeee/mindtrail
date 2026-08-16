package com.trailmind.backend.controller;

import com.trailmind.backend.common.ApiResponse;
import com.trailmind.backend.entity.Mindmap;
import com.trailmind.backend.service.MindmapExportService;
import com.trailmind.backend.service.MindmapService;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

/**
 * 导图接口（04 §5 契约）：POST 新建 / GET 列表（工作区下）/ GET 详情 / PUT 整图保存（乐观锁）/ DELETE /
 * POST /mindmaps/{id}/export?type=PNG|OPML 导出（M4 任务三）。
 */
@RestController
@RequestMapping("/api/v1")
public class MindmapController {

    private final MindmapService service;
    private final MindmapExportService exportService;

    public MindmapController(MindmapService service, MindmapExportService exportService) {
        this.service = service;
        this.exportService = exportService;
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

    /** 导图重命名（PRD B4，M4 缺陷清理补全）：body 仅 name，同步 search_text 的 name 部分。 */
    @PatchMapping("/mindmaps/{id}")
    public ApiResponse<Mindmap> rename(@PathVariable Long id, @RequestBody Mindmap req) {
        return ApiResponse.ok(service.rename(id, req.getName()));
    }

    @DeleteMapping("/mindmaps/{id}")
    public ApiResponse<Void> delete(@PathVariable Long id) {
        service.delete(id);
        return ApiResponse.ok(null);
    }

    /** 导图导出（PRD B5 / 04 §5）：type 大小写不敏感，PNG=整图（Base64）、OPML=树状大纲（XML 原文）。 */
    @PostMapping("/mindmaps/{id}/export")
    public ApiResponse<MindmapExportService.ExportFile> export(@PathVariable Long id,
                                                               @RequestParam String type) {
        return ApiResponse.ok(exportService.export(id, type));
    }
}
