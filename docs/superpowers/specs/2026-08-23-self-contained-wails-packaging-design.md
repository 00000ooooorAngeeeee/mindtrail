# 设计文档：自包含非 Electron 打包（Wails + 捆绑 MariaDB）

> 状态：设计已定，待实现。创建于 2026-08-23。
> 来源：用户需求「非 Electron 打包方案、一键启动、约定式丢 ico 换图标、数据库自包含」；头脑风暴选定方案 A。
> 关联：docs/04 §5（契约）、docs/05（schema）、docs/06 §4/§4A（导出/备份协议）、docs/10 §10/§12（M0 打包）、docs/11 §11（脚本索引）、AGENTS.md 快速命令。

## 1. 背景与目标

现状：TrailMind 桌面端 = Electron 壳（`desktop/main/index.js`）自拉 Java 后端 jar，前端 `/api/v1` 为**相对路径**，dev 靠 vite proxy 转发；打包态 `loadFile(dist)` 在 `file://` 下相对 `/api` 直达后端会失败（desktop 无 `/api` 协议拦截，这也是「打包安装环境待办」的根因）。启动还需用户预装 MySQL（与 Java）。

目标：产出**自包含**的 Windows 桌面应用，满足：

1. **非 Electron** 壳（现代 WebView2 渲染，与 Edge 一致，ReactFlow 无兼容风险）。
2. **一键启动**：双击 exe 即用，无需预装 Java、无需预装 MySQL。
3. **约定式换图标**：放一个固定名 ico 到 `branding/icon.ico`，重打包后壳与后端两个 exe 图标同时替换。
4. **零后端/搜索改动**：保留 MySQL FULLTEXT ngram 与全部 262 后端测试（不重写搜索）。

## 2. 非目标（YAGNI）

- 不切换数据库到 H2/SQLite（搜索重写风险大，体积非硬约束时不值得）。
- 不做跨平台（Linux/macOS）打包——当前仅 Windows。
- 不做自动更新（updater）——后续独立项。
- 不内嵌 JVM 到壳进程——后端仍是独立子进程（jpackage 产物）。
- 不替换现有 Electron 开发态（`npm run dev`/`npm run launch` 保留）；本设计只新增**打包态**产物。

## 3. 架构与启动链

```
启动 TrailMind.exe（Wails/Go 壳，图标 = branding/icon.ico）
  ├─ 首运行：bundled mariadb-install-db.exe 初始化数据目录 %APPDATA%\TrailMind\db
  ├─ 启动 bundled mariadbd.exe（--port=13306 --bind-address=127.0.0.1 --datadir=…/db）→ 轮询就绪
  ├─ 启动 trailmind-backend.exe（jpackage，bundled JRE）
  │     env: DB_HOST=127.0.0.1 DB_PORT=13306 DB_NAME=trailmind DB_USER=root DB_PASS=（空）
  │     → 连 mariadb，幂等建库建表，服务前端于 http://127.0.0.1:17860
  └─ WebView2 开窗加载 http://127.0.0.1:17860
        Spring Boot 同源：/ → frontend/dist/index.html，/api/v1 → 接口
关闭窗口 → 壳依次停 backend exe、停 mariadbd
```

单进程族：壳（Go）+ 后端 exe（JVM）+ mariadbd（mysqld）。三者均由壳拉起/停止。

## 4. 组件设计

### 4.1 后端同源服务前端（共享前置，Phase 0）

- Spring Boot 服务 `classpath:/static/`（构建时把 `frontend/dist` 内容复制进 `backend/src/main/resources/static/`）。
- **SPA fallback**：新增 controller/`WebMvcConfigurer`，把非 `/api/**`、非静态资源的 GET 请求 forward 到 `/index.html`（避免前端路由刷新 404）。
- 效果：打包态前端与 API 同源（`http://127.0.0.1:17860`），相对 `/api/v1` 直达后端，**修好当前打包态 /api 失效根因**。dev 仍走 vite（`:5173` + proxy），不变。
- DB 端口/凭据走环境变量（`DB_HOST/DB_PORT/DB_NAME/DB_USER/DB_PASS`，已有 `.env` 机制扩展 `DB_PORT`）；壳注入 bundled mariadb 值。

### 4.2 jpackage 后端 exe（Phase 1）

- 用 `jdeps --list-deps` 分析 fat jar 确定所需 JDK 模块，`jlink --strip-debug --no-header-files --no-man-pages --add-modules <deps> --output backend/target/jre` 生成最小 JRE。
- `jpackage --type app-image --name trailmind-backend --input backend/target --main-jar trailmind-backend-0.0.1.jar --main-class org.springframework.boot.loader.launch.JarLauncher --runtime-image backend/target/jre --icon branding/icon.ico --java-options "-Dserver.port=17860"` → `trailmind-backend/` app-image（含 bundled JRE，**用户无需装 Java**）。
- 后端 exe 由壳以 env 注入 DB 配置后启动；仍可用现有 `mvn -f backend/pom.xml package` 出 jar。

### 4.3 捆绑便携 MariaDB（Phase 2）

- MariaDB 11.x 官方 zip（mariadb.org），打包脚本下载到 `desktop/vendor/mariadb/`（**gitignore `desktop/vendor/`**，体积大）。
- 首运行：`mariadb-install-db.exe --datadir=%APPDATA%\TrailMind\db` 初始化数据目录。
- 启动：`mariadbd.exe --port=13306 --bind-address=127.0.0.1 --datadir=…/db --skip-networking=off`，仅本机监听。
- 健康等待：轮询 `127.0.0.1:13306`（`mysqladmin ping` 或 TCP）。
- 停止：`mysqladmin.exe --port=13306 shutdown`（优雅）+ 兜底 kill。
- 安全：root 无密码仅绑 127.0.0.1（单用户桌面工具可接受，威胁模型：本机隔离）。

### 4.4 Wails 壳（Phase 3）

- Go 项目 `desktop/wails/`（`wails init -n trailmind-shell --template vanilla`，壳不嵌前端）。
- `main.go`：按 §3 编排 mariadb + backend + WebView2 窗（窗口标题「思迹 TrailMind」）。
- 加载 `http://127.0.0.1:17860`：Wails 默认嵌入 assets，加载外部 URL 需用 embedded 重定向页或 AssetServer 代理；**实现首日 spike 验证 Wails 外部 URL 加载**，若不顺则回落 **Tauri（Rust，原生 `WebviewUrl::External`）**——二者均 WebView2，壳极薄，切换成本低，满足全部约束。图标 `desktop/wails/build/windows/icon.ico`。
- 退出：窗口关闭 → 停 backend → 停 mariadb（killProcessTree 同款思路，Go 用 `os/exec` + 进程组 kill）。

### 4.5 图标约定（Phase 4）

- 单一来源：仓库根 `branding/icon.ico`（新增 `branding/` 目录，含一个占位 ico 供首次打包）。
- 打包脚本 `scripts/package-desktop.mjs`：
  1. 复制 `branding/icon.ico` → `desktop/wails/build/windows/icon.ico`；
  2. 传 `--icon mindtrail/branding/icon.ico` 给 jpackage。
- 用户改 `branding/icon.ico` → 重打包，壳与后端 exe 图标同时替换。**这就是「命名成 xxx.ico 即用」的落地**（约定名固定为 `branding/icon.ico`）。

### 4.6 打包脚本（Phase 4）

`scripts/package-desktop.mjs` 编排全流程（镜像现有 `scripts/build.mjs`/`package.mjs` 风格）：
1. `npm run build`（前端 vite build → `frontend/dist`）。
2. 复制 `frontend/dist/*` → `backend/src/main/resources/static/`；`mvn -f backend/pom.xml clean package`（出 jar）。
3. `jdeps` + `jlink` 出 `backend/target/jre`。
4. `jpackage` 出后端 app-image（`--icon branding/icon.ico`）。
5. 下载/解压 MariaDB zip → `desktop/vendor/mariadb/`（若缺失）。
6. 复制 `branding/icon.ico` → `desktop/wails/build/windows/icon.ico`；`wails build` 出壳 exe。
7. 组装 release/：壳 exe + 后端 app-image + `desktop/vendor/mariadb/`（保持相对路径，壳按 `%APPDIR%` 定位）。
- 新增 `npm run package:desktop`（package.json），区别于现有 `npm run package`（electron-builder）。

## 5. 数据流

WebView2 → `http://127.0.0.1:17860`（前端，同源）→ `GET /api/v1/...` → Spring Boot → MariaDB `127.0.0.1:13306`。无跨域、无代理、dev/prod 一致。

## 6. 启动与关闭流程

启动（壳）：
1. 若 `%APPDATA%\TrailMind\db` 不存在 → `mariadb-install-db` 初始化（仅首运行）。
2. 起 `mariadbd`（13306）→ 轮询就绪（≤30s，超时报错页）。
3. 起 `trailmind-backend.exe`（注入 DB env）→ 轮询 `GET /api/v1/health`（≤60s，Spring Boot 启动）。
4. WebView2 加载 `http://127.0.0.1:17860`。

关闭：窗口关闭 → kill backend exe（进程组）→ `mysqladmin shutdown` mariadb（兜底 kill）。崩溃兜底：壳 `defer`/退出钩子确保不残留 mariadbd。

## 7. 数据迁移（既有 MySQL → bundled MariaDB）

- 用 M4 任务六**全量备份导出**（`POST /backup/export` → trailmind-backup v1 zip）从旧 MySQL 导出。
- 新 bundled MariaDB 首次启动后，用**导入恢复**（`POST /backup/import`）恢复。
- 两功能均已实现并有测试；迁移一次性、用户驱动。spec 不做自动迁移（YAGNI）。

## 8. 错误处理

- 端口 13306/17860 被占 → 壳探测后报错页（提示关掉冲突进程）；不静默换端口（避免多实例）。
- mariadb 初始化失败（权限/磁盘）→ 报错页 + 日志路径 `%APPDATA%\TrailMind/logs/`。
- backend 起不来（JRE/jar/DB 连接）→ 壳显示后端错误页 + 日志。
- WebView2 运行时缺失（旧 Win10）→ 提示安装 WebView2 Evergreen（不做自动安装，YAGNI）。
- 首运行初始化中断 → 下次启动检测 `db` 半初始化则清理重建。

## 9. 测试策略

- **后端 262 测试不动**（仍 MySQL，测试连既有 MySQL）。
- Phase 0 新增：Spring Boot 同源服务 + SPA fallback 的单测（MockMvc：`/` 返回 index.html、`/api/v1/health` 正常、未知路径 forward）。
- Phase 2 新增：MariaDB 生命周期纯函数/脚本单测（端口选择、datadir 路径计算、就绪判定、shutdown 命令构造）——`node:test`，镜像 `desktop/test/backend-process.test.js` 思路。
- Phase 4 新增：打包脚本单测（icon 复制路径解析、jpackage 参数构造）。
- Phase 3 壳：Go test 覆盖启停顺序 + 超时分支（用 stub 进程）。
- 现有 `scripts/verify.mjs` 冒烟：打包态额外加一段「打包产物启动 → /api/v1/health → 关闭无残留 mariadbd」实机验收（可选，需 packaged 产物）。

## 10. 风险与缓解

| 风险 | 缓解 |
|---|---|
| Wails 外部 URL 加载不顺 | 首日 spike；回落 Tauri（同 WebView2，壳薄） |
| MariaDB portable 许可/分发（GPL） | 官方 zip 可自由分发；`desktop/vendor/` gitignore，打包时下载 |
| jpackage/jlink 模块遗漏（反射加载） | `jdeps --list-deps` + 实机冷启 jpackage 产物验证反射类 |
| 体积 ~240MB（JRE~80 + MariaDB~150 + 壳~10） | 接受（用户已选自包含优先）；后续可换 jlink strip + MariaDB 精简 |
| mariadbd Windows 生命周期/首运行 | Phase 2 先做成可独立测试的库再接壳 |
| 既有数据不自动迁移 | 用既有备份导出/导入恢复，一次性用户驱动 |

## 11. 里程碑与范围

分 5 期，Phase 0 独立可交付（即使不做新壳也能改善现状）：

- **Phase 0**：Spring Boot 同源服务前端 + SPA fallback + `DB_PORT` env + 单测。交付后打包态 /api 根因解决。
- **Phase 1**：jpackage 后端 app-image（bundled JRE，`--icon`），实机冷启验证（连外部 MySQL）。
- **Phase 2**：bundled MariaDB 生命周期库（init/start/stop/health，端口 13306，datadir），`node:test` 单测。
- **Phase 3**：Wails 壳编排（mariadb + backend + WebView2 + 退出清理），Go test。
- **Phase 4**：打包脚本 `scripts/package-desktop.mjs` + `branding/icon.ico` 约定 + `npm run package:desktop` + release 组装。

每期小步提交（Conventional Commits 中文主题），docs 同步。

## 12. 验收标准

1. 双击 release 产物 → 出 TrailMind 窗口、后端自起、mariadb 自起，**无需预装 Java/MySQL**。
2. 前端 `/api/v1` 同源可达（导图/会话/搜索全功能，搜索 FULLTEXT 正常）。
3. 改 `branding/icon.ico` 重打包 → 壳与后端 exe 图标均替换。
4. 关闭窗口 → 无残留 `mariadbd.exe`/`trailmind-backend.exe`/JVM 进程。
5. 后端 262 + 前端 281 + 脚本 测试全绿；Phase 0 新增同源服务单测；Phase 2/4 新增脚本单测。
6. 既有数据经备份导出→导入恢复完整（M4 任务六往返既有测试覆盖）。
