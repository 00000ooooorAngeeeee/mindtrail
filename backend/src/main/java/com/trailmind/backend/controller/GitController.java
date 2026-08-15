package com.trailmind.backend.controller;

import com.trailmind.backend.common.ApiResponse;
import com.trailmind.backend.git.GitRepoService;
import com.trailmind.backend.git.GitRepoService.CommitInfo;
import com.trailmind.backend.git.GitRepoService.RepoStatus;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

/**
 * Git 仓库只读接口（04 §5 契约，M3 任务三）：
 * GET /git/repo/status?path= 校验是否为 Git 仓库并返回 HEAD 信息（PRD C3.1）；
 * GET /git/repo/commits?path=&since=&until=&limit= 提交列表（hash/author/time/message/files，04 §5；
 * since=会话 start_head 即 5s 轮询的「新提交感知」来源，04 §6.2）。
 */
@RestController
@RequestMapping("/api/v1")
public class GitController {

    private final GitRepoService service;

    public GitController(GitRepoService service) {
        this.service = service;
    }

    @GetMapping("/git/repo/status")
    public ApiResponse<RepoStatus> status(@RequestParam String path) {
        return ApiResponse.ok(service.status(path));
    }

    @GetMapping("/git/repo/commits")
    public ApiResponse<List<CommitInfo>> commits(@RequestParam String path,
                                                 @RequestParam(required = false) String since,
                                                 @RequestParam(required = false) String until,
                                                 @RequestParam(required = false) Integer limit) {
        return ApiResponse.ok(service.commits(path, since, until, limit));
    }
}
