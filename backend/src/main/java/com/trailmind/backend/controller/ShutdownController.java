package com.trailmind.backend.controller;

import com.trailmind.backend.common.ApiResponse;
import org.springframework.boot.SpringApplication;
import org.springframework.context.ApplicationContext;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.concurrent.atomic.AtomicBoolean;

/**
 * 优雅关闭接口：Electron 主进程退出时调用 POST /api/v1/shutdown 触发后端正常退出。
 * <p>
 * 先异步退出（延迟少量时间保证 HTTP 响应已送达），再关闭 Spring 上下文并结束 JVM。
 * 若后端无响应或超时，Electron 侧会以 taskkill 强杀兜底（见 desktop/main/backend-process.js）。
 */
@RestController
@RequestMapping("/api/v1")
public class ShutdownController {

    private final ApplicationContext context;
    private final AtomicBoolean shuttingDown = new AtomicBoolean(false);

    public ShutdownController(ApplicationContext context) {
        this.context = context;
    }

    @PostMapping("/shutdown")
    public ApiResponse<String> shutdown() {
        if (!shuttingDown.compareAndSet(false, true)) {
            return ApiResponse.ok("already shutting down");
        }
        Thread t = new Thread(() -> {
            try {
                Thread.sleep(300); // 等待响应写出后再退出
            } catch (InterruptedException ignored) {
                Thread.currentThread().interrupt();
            }
            System.exit(SpringApplication.exit(context, () -> 0));
        }, "trailmind-shutdown");
        t.setDaemon(false);
        t.start();
        return ApiResponse.ok("ok");
    }
}
