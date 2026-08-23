@echo off
chcp 65001 >nul
cd /d "%~dp0"
title TrailMind 启动器
echo ========================================
echo   思迹 TrailMind 启动器
echo   前端 vite + Electron 壳（自拉后端 jar）
echo   关闭窗口或 Ctrl+C 即终止全部进程
echo ========================================
echo.
echo 前置：MySQL 已启动（127.0.0.1:3306，库 trailmind）。
echo       后端连库凭据由 Electron 主进程从仓库根 .env 读取。
echo.
node scripts/launch.mjs
echo.
echo 已退出。按任意键关闭本窗口…
pause >nul
