package com.trailmind.backend.controller;

import org.springframework.stereotype.Controller;
import org.springframework.web.bind.annotation.GetMapping;

/**
 * 根路径转发到前端 SPA 入口 index.html（同源服务前端，specs 自包含打包 Phase 0、docs/04 §5）。
 * 显式转发而非仅依赖 Spring Boot welcome page，使根路径入口行为确定且可在 MockMvc 测试。
 * 注：前端无路径路由（Zustand 状态机单视图），故仅根路径转发，无 SPA forward controller（YAGNI，见设计文档 §4.1）。
 */
@Controller
public class RootController {

    @GetMapping("/")
    public String index() {
        return "forward:/index.html";
    }
}
