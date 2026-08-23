package com.trailmind.backend.controller;

import com.trailmind.backend.common.ApiResponse;
import com.trailmind.backend.service.BackupExportService;
import com.trailmind.backend.service.BackupRestoreService;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * 全量备份接口（04 §5 契约）：
 * POST /api/v1/backup/export 导出全部数据为 JSON 压缩包（zip 内 trailmind-backup.json，Base64 返回，M4 任务六）；
 * POST /api/v1/backup/import  导入恢复：全量替换当前数据（v1.2 P2，PRD E5「导入恢复」）。
 */
@RestController
@RequestMapping("/api/v1/backup")
public class BackupController {

    private final BackupExportService exportService;
    private final BackupRestoreService restoreService;

    public BackupController(BackupExportService exportService, BackupRestoreService restoreService) {
        this.exportService = exportService;
        this.restoreService = restoreService;
    }

    @PostMapping("/export")
    public ApiResponse<BackupExportService.ExportFile> export() {
        return ApiResponse.ok(exportService.export());
    }

    /** 导入恢复请求体：content 为 {@code POST /backup/export} 返回的同款 Base64 zip。 */
    public record BackupImportRequest(String content) {
    }

    /** 全量恢复：解 zip → 校验 → 单事务清空 9 表 + 按原 id 回填 → 返回各表行数摘要（04 §5 / 05 §8）。 */
    @PostMapping("/import")
    public ApiResponse<BackupRestoreService.RestoreSummary> importBackup(@RequestBody BackupImportRequest request) {
        return ApiResponse.ok(restoreService.restore(request == null ? null : request.content()));
    }
}
