# 设计文档：自包含非 Electron 打包（Wails + 捆绑便携 MySQL）

> 状态：Phase 0–4 均已实现；**2026-08-24 决策落地：捆绑数据库由 MariaDB 改为便携 MySQL 8.4 LTS**，ngram 阻塞解除（见 §10 决策记录）；安装包（NSIS）与 Electron 壳退役属后续会话。
> 来源：用户需求「非 Electron 打包方案、一键启动、约定式丢 ico 换图标、数据库自包含」；头脑风暴选定方案 A。
> 关联：docs/04 §5（契约）、docs/05（schema）、docs/06 §4/§4A（导出/备份协议）、docs/10 §10/§12（M0 打包）、docs/11 §11（脚本索引）、AGENTS.md 快速命令。

## 1. 背景与目标

现状：TrailMind 桌面端 = Electron 壳（`desktop/main/index.js`）自拉 Java 后端 jar，前端 `/api/v1` 为**相对路径**，dev 靠 vite proxy 转发；打包态 `loadFile(dist)` 在 `file://` 下相对 `/api` 直达后端会失败（desktop 无 `/api` 协议拦截，这也是「打包安装环境待办」的根因）。启动还需用户预装 MySQL（与 Java）。

目标：产出**自包含**的 Windows 桌面应用，满足：

1. **非 Electron** 壳（现代 WebView2 渲染，与 Edge 一致，ReactFlow 无兼容风险）。
2. **一键启动**：双击 exe 即用，无需预装 Java、无需预装 MySQL。
3. **约定式换图标**：放一个固定名 ico 到 `branding/icon.ico`，重打包后壳与后端两个 exe 图标同时替换。
4. **零后端/搜索改动**：保留 MySQL FULLTEXT ngram 与全部后端测试（不重写搜索）——**这一约束决定了捆绑库必须是 MySQL**（§10 决策记录）。

## 2. 非目标（YAGNI）

- 不切换数据库到 H2/SQLite（搜索重写风险大，体积非硬约束时不值得）。
- 不做跨平台（Linux/macOS）打包——当前仅 Windows。
- 不做自动更新（updater）——后续独立项。
- 不内嵌 JVM 到壳进程——后端仍是独立子进程（jpackage 产物）。
- 不替换现有 Electron 开发态（`npm run dev`/`npm run launch` 保留）；本设计只新增**打包态**产物。

## 3. 架构与启动链

```
启动 TrailMind.exe（Wails/Go 壳，图标 = branding/icon.ico）
  ├─ 首运行：bundled mysqld.exe --initialize-insecure --basedir=…\mysql --datadir=%APPDATA%\TrailMind\db
  ├─ 启动 bundled mysqld.exe（--port=13306 --bind-address=127.0.0.1 --datadir=…/db）→ mysqladmin ping 就绪
  ├─ 启动 trailmind-backend.exe（jpackage，bundled JRE）
  │     env: DB_HOST=127.0.0.1 DB_PORT=13306 DB_NAME=trailmind DB_USER=root DB_PASS=（空）
  │     → 连 MySQL，幂等建库建表（schema.sql 含 FULLTEXT ngram），服务前端于 http://127.0.0.1:17860
  └─ WebView2 开窗加载 http://127.0.0.1:17860
        Spring Boot 同源：/ → frontend/dist/index.html，/api/v1 → 接口
关闭窗口 → 壳依次停 backend exe、停 mysqld
```

单进程族：壳（Go）+ 后端 exe（JVM）+ mysqld（MySQL 服务进程）。三者均由壳拉起/停止。

## 4. 组件设计

### 4.1 后端同源服务前端（共享前置，Phase 0）

- Spring Boot 服务 `classpath:/static/`（构建时把 `frontend/dist` 内容复制进 `backend/src/main/resources/static/`）。
- **根路径转发**（非 SPA fallback）：经核查前端无路径路由（Zustand 状态机单视图），深路径刷新场景不存在 → SPA fallback controller YAGNI 跳过；仅 `RootController` `@GetMapping("/") forward:/index.html` 显式根路径转发到 SPA 入口（确定且可 MockMvc 断言 `forwardedUrl`）。
- 效果：打包态前端与 API 同源（`http://127.0.0.1:17860`），相对 `/api/v1` 直达后端，**修好当前打包态 /api 失效根因**。dev 仍走 vite（`:5173` + proxy），不变。
- DB 端口/凭据走环境变量（`DB_HOST/DB_PORT/DB_NAME/DB_USER/DB_PASS`，已有 `.env` 机制扩展 `DB_PORT`）；壳注入 bundled mariadb 值。

### 4.2 jpackage 后端 exe（Phase 1）

- 用 `jdeps --list-deps` 分析 fat jar 确定所需 JDK 模块，`jlink --strip-debug --no-header-files --no-man-pages --add-modules <deps> --output backend/target/jre` 生成最小 JRE。
- `jpackage --type app-image --name trailmind-backend --input backend/target --main-jar trailmind-backend-0.0.1.jar --main-class org.springframework.boot.loader.launch.JarLauncher --runtime-image backend/target/jre --icon branding/icon.ico --java-options "-Dserver.port=17860"` → `trailmind-backend/` app-image（含 bundled JRE，**用户无需装 Java**）。
- 后端 exe 由壳以 env 注入 DB 配置后启动；仍可用现有 `mvn -f backend/pom.xml package` 出 jar。

### 4.3 捆绑便携 MySQL（Phase 2，2026-08-24 由 MariaDB 改绑）

- MySQL 8.4 LTS 官方 Windows 免安装 zip（dev.mysql.com `Downloads/MySQL-8.4/mysql-<ver>-winx64.zip`），打包脚本下载解压到 `desktop/vendor/`（**gitignore `desktop/vendor/`**，体积大）；三级回退：`vendor/mysql/bin` 已就位 → `vendor/mysql-cache/<version>` 缓存 → 下载解压。也可手工把 zip 放到 `desktop/vendor/` 供脚本复用。
- 首运行：`mysqld.exe --initialize-insecure --basedir=…\mysql --datadir=%APPDATA%\TrailMind\db`（建系统表 + root 空密码；`--basedir` 强制用便携目录的 share，避免误读机器上已装的 MySQL）。
- 启动：`mysqld.exe --port=13306 --bind-address=127.0.0.1 --datadir=…\db --skip-networking=off --mysqlx=OFF`，仅本机监听，且不额外占 X Protocol 端口（33060）。
- 健康等待：`mysqladmin.exe -u root --port=13306 ping` 输出含 `mysqld is alive`（**TCP 端口通不等于可服务**——初始化期端口已监听但拒绝查询）。
- 停止：`mysqladmin.exe -u root --port=13306 shutdown`（优雅）+ 兜底 kill。
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
1. 若 `%APPDATA%\TrailMind\db` 不存在（或缺 `db\mysql` 系统库）→ `mysqld --initialize-insecure` 初始化（仅首运行；半初始化目录先清理重建）。
2. 起 `mysqld`（13306）→ `mysqladmin ping` 就绪等待（≤60s，超时报错页）。
3. 起 `trailmind-backend.exe`（注入 DB env）→ 轮询 `GET /api/v1/health`（≤60s，Spring Boot 启动）。
4. WebView2 加载 `http://127.0.0.1:17860`。

关闭：窗口关闭 → kill backend exe（进程组）→ `mysqladmin shutdown` MySQL（兜底 kill）。
**崩溃/强杀兜底（运行态文件）**：壳启动期把本次拉起的 pid 写入 `%APPDATA%\TrailMind\run.json`，正常收尾后删除；
下次启动时 `Shell.Run` 先读该文件，按「先停后端、再停数据库」清理上次遗留（壳被强杀时进程内的清理路径不会执行），完成后删除文件。
实机验证：强杀壳后 mysqld/后端残留 → 重新启动 → 新实例完成清理并自行就绪（`node scripts/e2e-shell.mjs` → S2b SHELL ALL PASS）。

## 7. 数据迁移（既有 MySQL → bundled MySQL）

- 用 M4 任务六**全量备份导出**（`POST /backup/export` → trailmind-backup v1 zip）从旧 MySQL 导出。
- 新 bundled MySQL 首次启动后，用**导入恢复**（`POST /backup/import`）恢复。
- 两功能均已实现并有测试；迁移一次性、用户驱动。spec 不做自动迁移（YAGNI）。

## 8. 错误处理

- 端口 13306/17860 被占 → 壳探测后报错页（提示关掉冲突进程）；不静默换端口（避免多实例）。
- MySQL 初始化失败（权限/磁盘）→ 报错页 + 日志路径 `%APPDATA%\TrailMind/logs/`。
- backend 起不来（JRE/jar/DB 连接）→ 壳显示后端错误页 + 日志。
- WebView2 运行时缺失（旧 Win10）→ 提示安装 WebView2 Evergreen（不做自动安装，YAGNI）。
- 首运行初始化中断 → 下次启动检测 `db` 半初始化则清理重建。

## 9. 测试策略

- **后端 262 测试不动**（仍 MySQL，测试连既有 MySQL）。
- Phase 0 新增：Spring Boot 同源服务 + SPA fallback 的单测（MockMvc：`/` 返回 index.html、`/api/v1/health` 正常、未知路径 forward）。
- Phase 2 新增：便携 MySQL 生命周期纯函数/脚本单测（端口选择、datadir 路径计算、初始化参数、就绪判定、shutdown 命令构造）——`node:test`，镜像 `desktop/test/backend-process.test.js` 思路。
- Phase 4 新增：打包脚本单测（icon 复制路径解析、MySQL zip URL/缓存定位、jpackage 参数构造）。
- Phase 3 壳：Go test 覆盖启停顺序 + 超时分支（用 stub 进程）。
- 现有 `scripts/verify.mjs` 冒烟：打包态额外加一段「打包产物启动 → /api/v1/health → 关闭无残留 mysqld」实机验收（可选，需 packaged 产物）。

## 10. 风险与缓解

| 风险 | 缓解 |
|---|---|
| ~~MariaDB 不支持 MySQL `ngram` 全文解析器~~ | **已解除（2026-08-24 决策）：改捆绑便携 MySQL 8.4 LTS**，schema.sql/搜索零改动，保留 `WITH PARSER ngram` 与后端 262 测试、N3 搜索性能契约（详见下方决策记录） |
| Wails 外部 URL 加载不顺 | 首日 spike 已过：采用内嵌重定向页跳转 `http://127.0.0.1:17860`（`desktop/wails/frontend/index.html`） |
| MySQL 便携版许可/分发（GPLv2 + FOSS 例外） | 官方 zip 可自由分发（社区版）；`desktop/vendor/` gitignore，打包时下载 |
| jpackage/jlink 模块遗漏（反射加载） | `jdeps --list-deps` + 实机冷启 jpackage 产物验证反射类 |
| 体积 ~700MB 未压缩（JRE + MySQL 全目录 + 壳）；安装包 LZMA 压缩后显著减小 | 接受（用户已选自包含优先）；后续可裁剪 MySQL 目录（只需 bin/lib/share）或 jlink strip |
| mysqld Windows 生命周期/首运行 | Phase 2 先做成可独立测试的库 + Phase 3 Go 编排，均以 stub 进程单测覆盖 |
| 既有数据不自动迁移 | 用既有备份导出/导入恢复，一次性用户驱动 |

### 10.1 决策记录：捆绑数据库由 MariaDB 改为便携 MySQL（2026-08-24）

- **背景**：Phase 3 实机证实 MariaDB 不支持 MySQL 的 `WITH PARSER ngram`（`Function 'ngram' is not defined`），schema.sql 建表即失败——而 ngram 是 M4 任务一全局搜索的基础，`docs/05 §4`、`09 R4` 均已按 ngram 落地。
- **选项**：① 改捆绑便携 MySQL（保 ngram，零搜索改动）② 继续 MariaDB + 重写搜索（LIKE 兜底/自建分词）③ 双库并存可切换。
- **决定**：**①**。理由：设计目标 §1 第 4 条本就要求「零后端/搜索改动」，②会破坏 N3 性能预算（1 万条目 ≤1s）与既有 262 后端测试语义、并需重写 05 §6/09 R4；③与项目「不做无用分支」取向冲突。
- **代价**：便携 MySQL 目录明显大于 MariaDB（本机 MySQL 8.0 安装目录 bin+lib+share ≈ 489MB，官方 8.4 zip ≈ 250MB 压缩），首次解压与首次 `--initialize-insecure` 各需数秒。
- **影响面**：壳 `internal/orchestrator`（`mysql.go`）、`desktop/main/mysql-process.js`、`scripts/package-desktop.mjs` 及其单测；后端与前端**零改动**。

## 11. 里程碑与范围

分 5 期，Phase 0 独立可交付（即使不做新壳也能改善现状）：

- **Phase 0**：Spring Boot 同源服务前端（`classpath:/static/` + `RootController` 根路径 forward）+ `DB_HOST/DB_PORT` env + 单测。交付后打包态 /api 根因解决。（SPA fallback 经核查前端无路由 YAGNI 跳过）—— **已完成**
- **Phase 1**：jpackage 后端 app-image（bundled JRE，`--icon`），实机冷启验证（连外部 MySQL）—— **已完成（2026-08-23）**。产出 `backend/target/trailmind-backend/`（`npm run package:backend`），图标约定 `branding/icon.ico`。
- **Phase 2**：便携数据库生命周期库（init/start/stop/health，端口 13306，datadir），`node:test` 单测—— **已完成**。产出 `desktop/main/mysql-process.js`（22 单测，2026-08-24 由 mariadb-process 改绑 MySQL），zip 下载/解压属 Phase 4 打包脚本（§4.6）。
- **Phase 3**：Wails 壳编排（数据库 + backend + WebView2 + 退出清理），Go test—— **已完成**。`desktop/wails/`（trailmind-shell）+ `internal/orchestrator`（20 Go 单测，2026-08-24 改绑 MySQL）。**ngram 阻塞已由 MySQL 决策解除**；端到端实机复验与安装包属后续会话。
- **Phase 4**：打包脚本 `scripts/package-desktop.mjs` + `branding/icon.ico` 约定 + `npm run package:desktop` + release 组装—— **脚本已实现（2026-08-24 改绑 MySQL，12 条单测）**。实机打包与 NSIS 安装包属后续会话（需网络下载 MySQL zip + 安装 NSIS）。

每期小步提交（Conventional Commits 中文主题），docs 同步。

## 12. 验收标准

1. 双击 release 产物 → 出 TrailMind 窗口、后端自起、mariadb 自起，**无需预装 Java/MySQL**。
2. 前端 `/api/v1` 同源可达（导图/会话/搜索全功能，搜索 FULLTEXT 正常）。
3. 改 `branding/icon.ico` 重打包 → 壳与后端 exe 图标均替换。
4. 关闭窗口 → 无残留 `mysqld.exe`/`trailmind-backend.exe`/JVM 进程。
5. 后端 + 前端 + 脚本 测试全绿；Phase 0 新增同源服务单测；Phase 2/4 新增脚本单测；Phase 3 新增 Go 单测（含强杀孤儿清理）。
6. 既有数据经备份导出→导入恢复完整（M4 任务六往返既有测试覆盖）。

## 13. 端到端验证脚本与安装包（本次新增）

### 13.1 打包产物验收脚本

两段脚本用于**打包产物**的实机验收（需先 `npm run package` 或手工备好 `release/` 布局；MySQL 便携目录可放 `release/mysql/`）：

| 脚本 | 作用 | 输出 |
|---|---|---|
| `scripts/e2e-packaged.mjs` | 编排等价流程：`mysqld --initialize-insecure` → 起库（13306）→ 起后端 app-image（注入 DB env）→ `/health` → 同源前端 → 幂等建 9 表 → **`WITH PARSER ngram` 建索引** → 保存导图校验 search_text/node_count → **中文全文搜索命中** → 反序清理无残留 | `S2 E2E: ALL PASS（10 项）` |
| `scripts/e2e-shell.mjs` | 壳 exe 真实编排：壳自初始化数据目录 + 拉库 + 拉后端 → 强杀后确认残留 → **再次启动验证孤儿清理并自行就绪** | `S2b SHELL: ALL PASS（5 项）` |

环境变量：`E2E_APPDATA_ROOT`（隔离数据目录，避免污染真实 `%APPDATA%`）、`E2E_LOG_DIR`、`E2E_DB_PORT`；
夹具数据库目录通过 `MYSQL_FIXTURE_DIR` 指定（缺省为本机安装的 MySQL 便携副本；正式发布仍用打包脚本下载的官方 zip）。

### 13.2 NSIS 安装包（S3）

`scripts/package-installer.mjs`（`npm run package:installer`）：
1. 校验 `release/` 布局（壳 exe + `mysql/bin/mysqld.exe` + `trailmind-backend/trailmind-backend.exe`），缺失即报出缺项；
2. 生成 `release/trailmind-installer.nsi`（UTF-8 无 BOM）：`File /r` 递归打包整份 release 布局、开始菜单与桌面快捷方式指向壳 exe、写卸载注册项、**卸载只删程序目录并提示用户数据保留在 `%APPDATA%\TrailMind`**；图标走 `/DICON_FILE=branding/icon.ico`（约定式换图，安装包图标随之替换）；
3. 定位 `makensis`（`NSIS_HOME` → `Program Files(x86)/NSIS` → `Program Files/NSIS` → `LOCALAPPDATA/NSIS` → PATH），未安装则报错并给出下载指引；
4. 产物 `release/TrailMind-Setup-<version>.exe`（版本号取 package.json，与 docs/11 §5 版本管理一致）。

> 不用 `wails build -nsis` 的原因：Wails 内置 NSIS 模板只打包壳 exe，不含 `mysql/` 与 `trailmind-backend/`（壳按 `%APPDIR%` 定位它们）。

### 13.3 桌面端启动器（S5：Electron 退役后）

`scripts/lib/shell-launcher.mjs`：GUI 验收脚本与 `npm run launch` 共用——
`resolveShellExe`（release 优先、回退 `desktop/wails/build/bin`）、WebView2 用户数据目录与 `DevToolsActivePort` 解析、
`buildShellEnv`（注入 `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=…`，断网模拟可叠加死代理开关）、
`pickPageTarget`、`waitForPageTarget`（已知端口轮询 + DevToolsActivePort 兜底）。
`scripts/lib/proc.mjs` 承接原 Electron 侧的 `killProcessTree` 等进程工具。

## 14. 受限环境注意事项（agent 沙箱）

- **Node `spawn`/`spawnSync` 带管道（默认 stdio）会 `EPERM`**：`node --test`（runner 用管道拉起子进程）、`vitest`（esbuild 服务）等在本沙箱直接失败；
  规避：单测文件用 `node <file>` 直跑；脚本内需捕获输出时用 `spawnSync` + fd 重定向到临时文件（`stdio: ['ignore', fd, fd]`）。
- **jpackage app-image 必须拿到有效 std 句柄**，否则弹「Failed to launch JVM」（`d1b0b1a` 已修）：壳与脚本都以 NUL/文件句柄替代 NULL。
- **GUI 自动化脚本**（`verify-m2-gui.mjs` / `perf-regression.mjs`）在本沙箱不可运行（Electron/WebView2 的 mojo 命名管道被拒），需全权限会话或人工执行。
- 沙箱下 `tasklist`/`Get-CimInstance Win32_Process` 可能 `Access denied`，残留检查改用 PID 探活（`process.kill(pid, 0)`）。
