# 自包含打包设计 · 分阶段 Agent 启动提示词

> 配套设计文档：[`2026-08-23-self-contained-wails-packaging-design.md`](./2026-08-23-self-contained-wails-packaging-design.md) §11。
> 用法：**一次会话只跑一期**，复制对应期的整段提示词作为开场白。依赖顺序见文末。
> 风格遵循 [docs/12-Agent启动提示词手册.md](../../12-Agent启动提示词手册.md) §3 通用模板 + §5 环境须知。
> 注：提示词中不含 DB 密码（.env gitignored）；agent 运行时自行读 `.env`。

## 通用前提（每期提示词已内嵌，此处仅备查）

项目根 `E:\DeepseekHarness\mindtrail`（自身即 git 仓库）。栈：Electron + React18/TS/Vite/Zustand/ReactFlow + Java21/SpringBoot3/MyBatis-Plus/JGit + MySQL8（库 `trailmind`，REST `127.0.0.1:17860`）。先读 AGENTS.md → docs/08 → docs/11 → 设计文档 → 本期相关 docs。小步提交（Conventional Commits 中文主题）；关键逻辑补单测；会话末按 docs/06 写 review + 产品工作区「TrailMind 开发」dogfooding；docs 同步；完成后列剩余任务。环境：`.env`（仓库根）含 DB_USER/DB_PASS，MySQL `127.0.0.1:3306`；端口 17860/5173；改后端代码后须 `mvn package` 重建 jar 再启 Electron；`frontend/dist` gitignored；本会话 danger-full-access（文件全权限、无审批弹窗）。

---

## Phase 0 · Spring Boot 同源服务前端（共享前置，可独立先跑）

```text
你是思迹 TrailMind 项目的开发 agent。项目根 E:\DeepseekHarness\mindtrail（自身 git 仓库）。栈：Electron + React18/TS/Vite/Zustand/ReactFlow + Java21/SpringBoot3/MyBatis-Plus/JGit + MySQL8（库 trailmind，REST 127.0.0.1:17860）。

先读：AGENTS.md → docs/08-Agent协作手册.md → docs/11-维护与交接手册.md → docs/04 §5（契约）→ docs/05（schema）→ 设计文档 docs/superpowers/specs/2026-08-23-self-contained-wails-packaging-design.md（本任务属其 §11 Phase 0、§4.1）。

本次任务：让 Spring Boot 同源服务前端静态资源，作为自包含打包的共享前置（即使不做新壳也独立可交付，顺带修好打包态相对 /api 失效根因）。

实现要点：
1. Spring Boot 服务 classpath:/static/——构建时把 frontend/dist 内容复制进 backend/src/main/resources/static/（写入 scripts/build.mjs 的 build 步骤，与现有 vite build 衔接）。
2. SPA fallback：新增 WebMvcConfigurer/controller，把非 /api/**、非静态资源的 GET 请求 forward 到 /index.html（避免前端路由刷新 404）。
3. 扩展 DB 端口可配置：DB_PORT 环境变量（默认 3306），供后续期壳注入 bundled MariaDB 的 13306。
4. dev 态不变（仍 vite :5173 + /api proxy）；仅打包态走 backend 同源。

通用要求：①先读文档再动手 ②小步提交（Conventional Commits 中文主题）③关键逻辑补单测 ④会话末按 docs/06 写 review + 产品工作区「TrailMind 开发」dogfooding ⑤docs 同步 ⑥完成后列剩余任务。

验收标准：
- 打包态（backend 同源）GET / 返回 index.html、GET /api/v1/health 200、未知前端路由 forward 到 index.html（MockMvc 单测覆盖）
- 后端 mvn -f backend/pom.xml test 全绿（262 不动 + 新增同源服务/SPA fallback 单测）
- 前端 vitest（workdir mindtrail/frontend）281 全绿、tsc 通过
- 改动未破坏 dev 态（vite :5173 仍正常）

约束（禁止项）：
- 不动 262 后端测试逻辑（仅加 DB_PORT 配置项）
- 不删既有 vite proxy（dev 仍用）
- 不改导出协议（docs/06 §4/§4A）、不动 schema（docs/05）、不改既有 API 契约
- 本期不碰 jpackage/MariaDB/壳（后续期）

环境：.env（仓库根）含 DB_USER/DB_PASS，MySQL 127.0.0.1:3306；mvn -f backend/pom.xml test；frontend vitest/tsc workdir=mindtrail/frontend；frontend/dist gitignored；本会话 danger-full-access。
```

---

## Phase 1 · jpackage 后端 exe（bundled JRE，含图标）

```text
你是思迹 TrailMind 项目的开发 agent。项目根 E:\DeepseekHarness\mindtrail（自身 git 仓库）。栈：Electron + React18/TS/Vite + Java21/SpringBoot3/MyBatis-Plus/JGit + MySQL8（库 trailmind，REST 127.0.0.1:17860）。

前置：Phase 0 已完成（backend 同源服务前端，jar 已含 frontend/dist 静态资源）。

先读：AGENTS.md → docs/08 → docs/11 → docs/10 §10/§12（M0 打包）→ 设计文档 docs/superpowers/specs/2026-08-23-self-contained-wails-packaging-design.md（本任务属其 §11 Phase 1、§4.2）。

本次任务：把后端 jar 打成带 bundled JRE 的 app-image（用户无需预装 Java），并支持自定义 ico 图标。

实现要点：
1. jdeps --list-deps 分析 backend/target/trailmind-backend-0.0.1.jar 确定所需 JDK 模块；jlink --strip-debug --no-header-files --no-man-pages --add-modules <deps> --output backend/target/jre 生成最小 JRE。
2. jpackage --type app-image --name trailmind-backend --input backend/target --main-jar trailmind-backend-0.0.1.jar --main-class <从 jar 的 META-INF/MANIFEST.MF Main-Class 取：Spring Boot 3.2+ 为 org.springframework.boot.loader.launch.JarLauncher，3.0-3.1 为 org.springframework.boot.loader.JarLauncher> --runtime-image backend/target/jre --icon branding/icon.ico --java-options "-Dserver.port=17860"。
3. branding/icon.ico：若不存在，本期创建 branding/ 目录并放一个占位 ico（供首次打包；用户后续替换即换图标）。
4. 实机冷启验证：在无 JAVA_HOME/不依赖本机 Java 的前提下启动产物，连既有 MySQL（.env creds）后 GET /api/v1/health 返回 200。

通用要求：①先读文档再动手 ②小步提交（Conventional Commits 中文主题）③关键逻辑补单测 ④会话末按 docs/06 写 review + 产品工作区「TrailMind 开发」dogfooding ⑤docs 同步 ⑥完成后列剩余任务。

验收标准：
- backend/target/trailmind-backend/ app-image 产出（含 bundled JRE + exe + 图标）
- 冷启（不依赖本机 Java）连既有 MySQL 后 /api/v1/health 200、前端 / 同源可达（Phase 0 能力）
- 改 branding/icon.ico 重打包后 exe 图标变化
- jpackage/jlink 模块未遗漏（反射加载类冷启不报 ClassNotFoundException）

约束（禁止项）：
- 不改后端 Java 代码（仅打包配置；jar 仍由 mvn -f backend/pom.xml package 产出）
- 不碰 MariaDB/壳（后续期）
- 不动既有 262 后端测试与前端测试

环境：需 JDK 21（含 jpackage/jlink/jdeps）；.env 含 DB_USER/DB_PASS，MySQL 127.0.0.1:3306；frontend/dist gitignored；本会话 danger-full-access。
```

---

## Phase 2 · 捆绑便携 MariaDB 生命周期（壳无关，可独立测试）

```text
你是思迹 TrailMind 项目的开发 agent。项目根 E:\DeepseekHarness\mindtrail（自身 git 仓库）。栈：Electron + React18/TS/Vite + Java21/SpringBoot3/MyBatis-Plus/JGit + MySQL8（库 trailmind，REST 127.0.0.1:17860）。

前置：Phase 0 已完成（DB_PORT 可配）。本期不依赖 Phase 1 的产物，可并行。

先读：AGENTS.md → docs/08 → docs/11 → docs/05（schema，确认幂等建表由后端负责）→ 设计文档 docs/superpowers/specs/2026-08-23-self-contained-wails-packaging-design.md（本任务属其 §11 Phase 2、§4.3、§8）。

本次任务：做 bundled 便携 MariaDB 的生命周期库（init/start/health/stop），壳无关、可独立单测。

实现要点：
1. 打包脚本下载 MariaDB 11.x 官方 zip（mariadb.org）→ 解压到 desktop/vendor/mariadb/；.gitignore 增 desktop/vendor/（体积大不入库）。
2. 生命周期库（建议 scripts/mariadb-lifecycle.mjs 或 desktop/main/mariadb-process.js，复用 backend-process.js 的 killProcessTree 风格）：
   - init（首运行）：mariadb-install-db.exe --datadir=%APPDATA%\TrailMind\db 初始化数据目录。
   - start：mariadbd.exe --port=13306 --bind-address=127.0.0.1 --datadir=…/db，仅本机监听。
   - health：轮询 127.0.0.1:13306（mysqladmin ping 或 TCP），超时 30s。
   - stop：mysqladmin.exe --port=13306 shutdown（优雅）+ 兜底 killProcessTree。
3. 纯函数抽取（端口选择/datadir 路径计算/就绪判定/shutdown 命令构造）供 node:test 单测。

通用要求：①先读文档再动手 ②小步提交（Conventional Commits 中文主题）③关键逻辑补单测 ④会话末按 docs/06 写 review + 产品工作区「TrailMind 开发」dogfooding ⑤docs 同步 ⑥完成后列剩余任务。

验收标准：
- 生命周期库 node:test（node --test scripts/test/*.test.mjs 或 desktop/test/）全绿：端口/路径/就绪/shutdown 命令构造正确
- 实机首运行：init → start(13306) → health 就绪 → mysqladmin 优雅关闭 → 无残留 mariadbd.exe
- desktop/vendor/ 已 gitignore
- 安全模型（root 无密码仅绑 127.0.0.1，单用户桌面工具可接受）写入 decision 记录

约束（禁止项）：
- 不改后端/前端代码（仅生命周期库 + 脚本）
- 不接壳（下期 Phase 3）
- 端口固定 13306（不静默换端口避免多实例）
- 不删既有 MySQL 依赖（dev 仍用 .env 的 MySQL）

环境：下载需网络（mariadb.org）；Windows mariadb-install-db.exe / mariadbd.exe / mysqladmin.exe；%APPDATA%\TrailMind\db；本会话 danger-full-access。
```

---

## Phase 3 · Wails 壳编排（含外部 URL spike，最贵最险）

```text
你是思迹 TrailMind 项目的开发 agent。项目根 E:\DeepseekHarness\mindtrail（自身 git 仓库）。栈：Electron + React18/TS/Vite + Java21/SpringBoot3/MyBatis-Plus/JGit + MySQL8（库 trailmind，REST 127.0.0.1:17860）。

前置：Phase 1（backend app-image，bundled JRE）+ Phase 2（MariaDB 生命周期库）均已完成。

先读：AGENTS.md → docs/08 → docs/10 §10/§12 → docs/11 → 设计文档 docs/superpowers/specs/2026-08-23-self-contained-wails-packaging-design.md（本任务属其 §11 Phase 3、§4.4、§10 风险表）。

本次任务：做 Wails(Go+WebView2) 壳，编排 mariadb + backend + WebView2 窗，退出清理无残留。

实现要点（第一步是 spike，成本前置）：
1. SPIKE（先做、最便宜）：验证 Wails 能加载外部 URL http://127.0.0.1:17860（embedded 重定向页或 AssetServer 代理）。若 Wails 外部 URL 加载不顺，立即回落 Tauri（Rust，WebviewUrl::External，同为 WebView2，壳薄、满足全部约束）——spike 结论写 decision 记录后再继续。
2. 壳项目（desktop/wails/，wails init --template vanilla，壳不嵌前端——前端由 backend 同源服务）。
3. main.go 编排（按设计 §3/§6）：init mariadb（首运行初始化）→ start mariadbd(13306) → 等就绪 → start trailmind-backend.exe（env 注入 DB_HOST=127.0.0.1 DB_PORT=13306 DB_NAME=trailmind DB_USER=root DB_PASS=）→ 等 /api/v1/health → WebView2 开窗加载 17860。
4. 退出：窗关闭 → kill backend exe（进程组）→ mysqladmin shutdown mariadb（兜底 kill）；defer/退出钩子确保不残留 mariadbd。
5. Go test 覆盖启停顺序 + 超时分支（用 stub 进程）。

通用要求：①先读文档再动手 ②小步提交（Conventional Commits 中文主题）③关键逻辑补单测 ④会话末按 docs/06 写 review + 产品工作区「TrailMind 开发」dogfooding ⑤docs 同步 ⑥完成后列剩余任务。

验收标准：
- 双击壳 dev 构建 → 起 mariadb + backend + 开窗加载 17860 全功能（导图/会话/搜索，搜索 FULLTEXT 正常）
- 关窗无残留 mariadbd.exe / trailmind-backend.exe / JVM 进程
- Go test 绿（启停顺序、超时分支）
- Wails/Tauri 取舍写 decision 记录

约束（禁止项）：
- 不改后端/前端代码（仅壳）
- 壳不嵌前端（前端由 backend 同源服务，Phase 0 已就绪）
- 保留全部既有测试（后端 262 / 前端 281 / 脚本）

环境：需 Go 工具链 + wails CLI（或 Rust + cargo tauri 若回落）；WebView2 运行时（Win10/11 多数自带，缺失则提示安装，不做自动安装）；desktop/wails/build/windows/icon.ico 可手放占位（Phase 4 脚本统一复制）；本会话 danger-full-access。

注：本期是全设计最贵最险的一期。spike 是止损闸门——spike 不通过就回落 Tauri，不要在 Wails 外部 URL 上死磕烧钱。
```

---

## Phase 4 · 打包脚本 + 图标约定 + release 组装

```text
你是思迹 TrailMind 项目的开发 agent。项目根 E:\DeepseekHarness\mindtrail（自身 git 仓库）。栈：Electron + React18/TS/Vite + Java21/SpringBoot3/MyBatis-Plus/JGit + MySQL8（库 trailmind，REST 127.0.0.1:17860）。

前置：Phase 0-3 全部完成（同源服务 / backend app-image / MariaDB 生命周期库 / Wails 壳）。

先读：AGENTS.md → docs/08 → docs/10 §10 → docs/11 → docs/12（启动提示词）→ 设计文档 docs/superpowers/specs/2026-08-23-self-contained-wails-packaging-design.md（本任务属其 §11 Phase 4、§4.5/§4.6、§12 验收）。

本次任务：写一键打包脚本 + 图标单一来源约定 + release 组装，产出可分发的自包含产物。

实现要点：
1. scripts/package-desktop.mjs 编排全流程（镜像现有 scripts/build.mjs/package.mjs 风格）：
   a. npm run build（vite build → frontend/dist）
   b. 复制 frontend/dist/* → backend/src/main/resources/static/；mvn -f backend/pom.xml clean package（出 jar）
   c. jdeps + jlink 出 backend/target/jre
   d. jpackage --icon branding/icon.ico 出后端 app-image
   e. 下载/解压 MariaDB zip → desktop/vendor/mariadb/（若缺失）
   f. 复制 branding/icon.ico → desktop/wails/build/windows/icon.ico；wails build 出壳 exe
   g. 组装 release/：壳 exe + 后端 app-image + desktop/vendor/mariadb（保持相对路径，壳按 %APPDIR% 定位）
2. 图标单一来源 branding/icon.ico：打包脚本同时供 Wails icon.ico 与 jpackage --icon。改这一个 ico 重打包，壳与后端两 exe 图标同步替换。
3. package.json 增 "package:desktop": "node scripts/package-desktop.mjs"（区别于现有 electron-builder 的 package）。
4. release/ 加 .gitignore。
5. 脚本纯函数单测（icon 复制路径解析、jpackage/wails 参数构造）。

通用要求：①先读文档再动手 ②小步提交（Conventional Commits 中文主题）③关键逻辑补单测 ④会话末按 docs/06 写 review + 产品工作区「TrailMind 开发」dogfooding ⑤docs 同步 ⑥完成后列剩余任务。

验收标准（对照设计 §12）：
- npm run package:desktop 一键出 release/（壳 + 后端 app-image + mariadb）
- 双击 release 产物 → 出 TrailMind 窗口、后端/mariadb 自起，无需预装 Java/MySQL
- 前端 /api/v1 同源可达（导图/会话/搜索全功能，搜索 FULLTEXT 正常）
- 改 branding/icon.ico 重打包 → 壳与后端 exe 图标均替换
- 关窗无残留 mariadbd/backend/JVM
- 既有测试全绿（262/281/脚本）+ 新增打包脚本单测
- 既有数据经备份导出→导入恢复完整（M4 任务六往返已有测试覆盖）
- docs 同步（docs/11 §11 脚本表 + AGENTS 快速命令 + docs/10/12 相关）

约束（禁止项）：
- 不改既有 electron-builder 的 npm run package（保留）
- release/ gitignore 不入库
- 不改导出协议、不动 schema

环境：综合前几期工具链（Go+wails、JDK21+jpackage、网络下载 MariaDB）；branding/icon.ico 占位（若未放先创建）；本会话 danger-full-access。
```

---

## 执行顺序与依赖

```
Phase 0（同源服务）  ──┐
                       ├─→ Phase 1（jpackage 后端）──┐
                       │                              ├─→ Phase 3（Wails 壳）─→ Phase 4（打包脚本 + release）
                       └─→ Phase 2（MariaDB 生命周期）┘
```

- **Phase 0 可独立先跑**（最便宜、独立可交付、顺带修好 `/api` 根因）——即使最后不做新壳也值得。
- **Phase 2 可与 Phase 1 并行**（不依赖 backend 产物）。
- **Phase 3 依赖 Phase 1 + Phase 2**；是全设计最贵最险的一期，先做 spike（Wails 外部 URL），不通过即回落 Tauri。
- **Phase 4 依赖 Phase 0-3 全部**，收尾出 release。
- 每期完成后列剩余任务（docs/12 §6 收尾清单）。
