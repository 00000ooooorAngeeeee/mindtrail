package com.trailmind.backend.controller;

import com.trailmind.backend.common.ApiResponse;
import com.trailmind.backend.service.SettingsService;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * 应用设置接口（04 §5 契约，M4 任务四落地）：
 * GET 返回主题/默认仓库路径/数据库连接信息；PUT 更新主题与默认仓库路径（null 字段不改动）。
 */
@RestController
@RequestMapping("/api/v1/settings")
public class SettingsController {

    private final SettingsService service;

    public SettingsController(SettingsService service) {
        this.service = service;
    }

    @GetMapping
    public ApiResponse<SettingsService.SettingsView> get() {
        return ApiResponse.ok(service.get());
    }

    @PutMapping
    public ApiResponse<SettingsService.SettingsView> update(@RequestBody UpdateRequest req) {
        return ApiResponse.ok(service.update(req.getTheme(), req.getDefaultRepoPath()));
    }

    /** PUT 请求体：theme ∈ light|dark|system；defaultRepoPath 传空白字符串表示清除。 */
    public static class UpdateRequest {
        private String theme;
        private String defaultRepoPath;

        public String getTheme() {
            return theme;
        }

        public void setTheme(String theme) {
            this.theme = theme;
        }

        public String getDefaultRepoPath() {
            return defaultRepoPath;
        }

        public void setDefaultRepoPath(String defaultRepoPath) {
            this.defaultRepoPath = defaultRepoPath;
        }
    }
}
