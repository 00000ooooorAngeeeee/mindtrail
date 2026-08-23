package com.trailmind.backend.controller;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.web.servlet.MockMvc;

import static org.hamcrest.Matchers.containsString;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.forwardedUrl;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * 同源前端服务守卫测试（specs 自包含打包 Phase 0、docs/04 §5 契约）。
 *
 * 后端同源服务 classpath:/static/：/ → index.html（Spring Boot welcome page）、
 * /assets/* → 静态资源、/api/v1/* → 接口（同源无跨域，修好打包态相对 /api 失效根因）。
 *
 * 本测试用 src/test/resources/static 下的固定夹具（真实 dist gitignore、构建期由 build.mjs 复制进 jar）。
 * @SpringBootTest 全上下文，与 WorkspaceControllerTest 同款，需本机 MySQL 可用（DB_PASS 环境变量注入）。
 *
 * 注：前端无路径路由（Zustand 状态机单视图），故无 SPA forward controller（YAGNI，见设计文档 §4.1）。
 */
@SpringBootTest
@AutoConfigureMockMvc
class StaticResourceServingTest {

    @Autowired
    private MockMvc mockMvc;

    @Test
    void root_forwards_to_index_html() throws Exception {
        // 根路径经 RootController forward:/index.html；MockMvc 不执行转发目标，故断言 forwardedUrl
        // （真实运行时转发由静态处理器落地 index.html，与 index_html_served_directly 同款）
        mockMvc.perform(get("/"))
                .andExpect(status().isOk())
                .andExpect(forwardedUrl("/index.html"));
    }

    @Test
    void index_html_served_directly_as_static() throws Exception {
        mockMvc.perform(get("/index.html"))
                .andExpect(status().isOk())
                .andExpect(content().contentTypeCompatibleWith("text/html"))
                .andExpect(content().string(containsString("trailmind-spa-fixture")));
    }

    @Test
    void asset_served_as_static() throws Exception {
        mockMvc.perform(get("/assets/app.js"))
                .andExpect(status().isOk())
                .andExpect(content().string(containsString("trailmind-static-asset-fixture")));
    }

    @Test
    void api_same_origin_not_intercepted_by_static() throws Exception {
        // /api/v1/health 是 controller 的精确映射，优先级高于静态资源，不会被同源静态服务拦截
        mockMvc.perform(get("/api/v1/health"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(0))
                .andExpect(jsonPath("$.data.status").value("ok"))
                .andExpect(jsonPath("$.data.app").value("trailmind"));
    }
}
