package com.trailmind.backend.controller;

import com.trailmind.backend.common.ApiResponse;
import com.trailmind.backend.service.NodeEntryService;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;
import java.util.Map;

/**
 * 导图节点↔记录条目联动接口（v1.1 P1，04 §5 契约补充）：
 * 节点挂条目（PUT /mindmaps/{id}/nodes/{nodeId}/links，替换语义）、条目引用节点（PUT /entries/{id}/nodes，替换语义）、
 * 双向查询（导图挂接图 / 节点挂接详情 / 条目引用列表 / 会话批量回填）与选择器（节点搜索 / 工作区最近条目）。
 * 同工作区约束由 {@link NodeEntryService} 校验（跨工作区联动超出 MVP 范围）。
 */
@RestController
@RequestMapping("/api/v1")
public class NodeEntryController {

    private final NodeEntryService service;

    public NodeEntryController(NodeEntryService service) {
        this.service = service;
    }

    /** 导图全部挂接（徽标计数）：{nodeId: [entryId, …]}。 */
    @GetMapping("/mindmaps/{id}/links")
    public ApiResponse<Map<String, List<Long>>> mindmapLinks(@PathVariable Long id) {
        return ApiResponse.ok(service.mindmapLinks(id));
    }

    /** 节点挂接的条目详情（详情弹层数据源）。 */
    @GetMapping("/mindmaps/{id}/nodes/{nodeId}/links")
    public ApiResponse<List<NodeEntryService.LinkedEntry>> nodeLinks(@PathVariable Long id,
                                                                     @PathVariable String nodeId) {
        return ApiResponse.ok(service.nodeLinks(id, nodeId));
    }

    /** 替换节点挂接的条目集合（先清后插，幂等）。body: {entryIds: [..]}。 */
    @PutMapping("/mindmaps/{id}/nodes/{nodeId}/links")
    public ApiResponse<List<NodeEntryService.LinkedEntry>> replaceNodeLinks(@PathVariable Long id,
                                                                            @PathVariable String nodeId,
                                                                            @RequestBody EntryIdsRequest req) {
        return ApiResponse.ok(service.replaceNodeLinks(id, nodeId, req.entryIds()));
    }

    /** 节点搜索（选择器）：q 空时浏览全部；返回 {nodeId, text, path}。 */
    @GetMapping("/mindmaps/{id}/nodes")
    public ApiResponse<List<NodeEntryService.NodeHit>> searchNodes(@PathVariable Long id,
                                                                   @RequestParam(required = false) String q) {
        return ApiResponse.ok(service.searchNodes(id, q));
    }

    /** 条目引用的节点列表（含导图名与节点文本，跳转定位用）。 */
    @GetMapping("/entries/{id}/nodes")
    public ApiResponse<List<NodeEntryService.NodeRef>> entryNodes(@PathVariable Long id) {
        return ApiResponse.ok(service.entryNodes(id));
    }

    /** 替换条目引用的节点集合（先清后插，幂等，可跨导图）。body: {links: [{mindmapId, nodeId}, …]}。 */
    @PutMapping("/entries/{id}/nodes")
    public ApiResponse<List<NodeEntryService.NodeRef>> replaceEntryNodes(@PathVariable Long id,
                                                                         @RequestBody NodeRefsRequest req) {
        return ApiResponse.ok(service.replaceEntryNodes(id, req.links()));
    }

    /** 会话内全部条目引用（时间线批量回填，避免 N+1）：{entryId: [NodeRef, …]}。 */
    @GetMapping("/sessions/{id}/links")
    public ApiResponse<Map<Long, List<NodeEntryService.NodeRef>>> sessionLinks(@PathVariable Long id) {
        return ApiResponse.ok(service.sessionLinks(id));
    }

    /** 工作区最近条目（节点挂条目对话框候选，按创建时间倒序）。 */
    @GetMapping("/workspaces/{workspaceId}/entries/recent")
    public ApiResponse<List<NodeEntryService.RecentEntry>> recentEntries(@PathVariable Long workspaceId,
                                                                         @RequestParam(required = false) Integer limit) {
        return ApiResponse.ok(service.recentEntries(workspaceId, limit));
    }

    /** 请求体：节点挂接条目 id 列表。 */
    public record EntryIdsRequest(List<Long> entryIds) {
    }

    /** 请求体：条目引用节点列表。 */
    public record NodeRefsRequest(List<NodeEntryService.NodeRefInput> links) {
    }
}
