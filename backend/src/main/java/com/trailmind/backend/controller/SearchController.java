package com.trailmind.backend.controller;

import com.trailmind.backend.common.ApiResponse;
import com.trailmind.backend.service.SearchService;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * 全局搜索接口（M4 任务一，04 §5 契约）：GET /search?q=&type=&workspaceId=
 * 跨全部工作区检索导图节点文本（search_text）、条目标题/正文（content_md FULLTEXT）、会话标题（LIKE）；
 * 结果按类型分组返回，关键词高亮由前端基于片段完成（04 §6.3）。
 */
@RestController
@RequestMapping("/api/v1")
public class SearchController {

    private final SearchService service;

    public SearchController(SearchService service) {
        this.service = service;
    }

    @GetMapping("/search")
    public ApiResponse<SearchService.SearchResult> search(@RequestParam String q,
                                                          @RequestParam(defaultValue = "all") String type,
                                                          @RequestParam(required = false) Long workspaceId) {
        return ApiResponse.ok(service.search(q, type, workspaceId));
    }
}
