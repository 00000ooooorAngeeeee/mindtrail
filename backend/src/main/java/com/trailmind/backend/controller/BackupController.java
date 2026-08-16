package com.trailmind.backend.controller;

import com.trailmind.backend.common.ApiResponse;
import com.trailmind.backend.service.BackupExportService;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * 全量备份接口（04 §5 契约，M4 任务六落地）：
 * POST /api/v1/backup/export 导出全部数据为 JSON 压缩包（zip 内 trailmind-backup.json，Base64 返回）。
 */
@RestController
@RequestMapping("/api/v1/backup")
public class BackupController {

    private final BackupExportService service;

    public BackupController(BackupExportService service) {
        this.service = service;
    }

    @PostMapping("/export")
    public ApiResponse<BackupExportService.ExportFile> export() {
        return ApiResponse.ok(service.export());
    }
}
