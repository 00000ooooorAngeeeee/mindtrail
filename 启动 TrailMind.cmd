@echo off
chcp 65001 >nul
cd /d "%~dp0"
title TrailMind 桌面端启动器
echo ========================================
echo   思迹 TrailMind 桌面端
echo   Electron 壳自拉后端 jar，同源加载前端
echo   （无需 vite / 浏览器；关闭窗口即退出）
echo ========================================
echo.
echo 前置：MySQL 已启动（3306）；后端 jar 已构建（含前端，npm run build）。
echo       若无窗口出现，可能有残留 TrailMind 实例占用单实例锁——
echo       任务管理器结束 electron 进程后重试（勿结束 DeepSeek Harness 的 electron）。
echo.
node scripts/launch.mjs
echo.
echo 已退出。按任意键关闭本窗口…
pause >nul
