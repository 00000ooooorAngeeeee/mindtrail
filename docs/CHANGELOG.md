# TrailMind 开发过程记录（CHANGELOG）

> 本文件是 M0 阶段的 dogfooding 落地文件（见 docs/08 §8、docs/10 任务 0.8），按 [06-过程记录规范.md](06-过程记录规范.md) 记录开发过程。M3 起改用产品本身记录。
>
> 条目格式：`## [type] HH:mm · 类型名`，type 取自 06 §2 枚举。

## 会话 1 · M0 任务 0.0 + 0.1（环境准备 + 仓库初始化）

### [goal] 16:10 · 目标
完成 M0 前两个任务：0.0 环境准备、0.1 仓库初始化与工程骨架。表现为：`git status` 干净、目录结构与 04 §3 一致、文档集全部入库、有首次提交。
> 说明：任务提示词模板的"本次任务"字段未填写，按指令"按 07 里程碑顺序工作"+ AGENTS.md "M0 为下一任务"+ 仓库现状（v0 无代码），本次会话起点定为 M0 任务 0.0 + 0.1（docs/10 §13 会话排期的"必合"会话 1），而非模板示例中的 M1。

### [action] 16:15 · 操作
检查开发环境版本：node v24.15.0 / npm 11.12.1 / java 25（另有 jdk-21.0.10）/ mvn 3.9.9 / git 2.54.0 / mysql 8.0.45。

### [decision] 16:20 · 决策
后端 JDK 用 21（`jdk-21.0.10`）而非 25：Spring Boot 3 官方测试上限到 21，25 过新有 Maven/插件兼容风险；放弃 25 因稳定性；也不强制装文档提的 17——21 已满足 Spring Boot 3 的 17+ 要求，本机未装 17。
> 落地方式：任务 0.2 起 Maven 构建时把 `JAVA_HOME` 指向 `C:\Program Files\Java\jdk-21.0.10`（当前默认指向 jdk-25）。

### [error] 16:20 · 错误
MySQL `root` 无密码连接报 `ERROR 1045 (28000): Access denied for user 'root'@'localhost' (using password: NO)`。根因：本机 root 已设密码，密码未提供。修复：已获提供密码（明文不入库，存于本地记忆），验证 `SELECT 1` 返回 1 通过；后续经 `DB_USER/DB_PASS` 环境变量注入。

### [action] 16:25 · 操作
`git init` 初始化 trailmind 仓库；建立 `desktop/ frontend/ backend/ scripts/` 目录（`.gitkeep` 占位）；写根 `.gitignore`（node_modules/dist/target/release/out/*.log/.env/*.local/.idea/.vscode）；根 `package.json` 定义 `dev/build/package/verify` 占位脚本（指向 `scripts/*.mjs`，任务 0.7 实现）。

### [action] 16:28 · 操作
README 补充「仓库结构」小节（对应 04 §3）。

### [artifact] 16:30 · 产出
- 首次提交 `54ff2c6`：仓库骨架（目录结构 + .gitignore + package.json + 全部文档 docs/01-10 入库）

### [note] 16:31 · 备注
发现文档轻微不一致：08 §3 写 `scripts/verify.sh`（或 .ps1），10 §7/§12 写 `scripts/verify.mjs`（Node）。本会话按更具体的 10 文档取 `.mjs`；任务 0.7 落地 verify 脚本时统一口径。

### [review] 16:32 · 复盘
骨架阶段顺利，一次提交完成 0.1 全部验收项。教训：① 环境是"最容易被文档假设骗"的一环——文档写 JDK 17，实际只有 21/25，好在 21 可替代；② MySQL 凭据这类"外部秘密"应在会话一开始就向用户索取，而不是等用到时再卡住。下次应先核对真实环境与文档假设的差异。

### [next] 16:32 · 下一步
- [x] 提供 MySQL `root` 密码（已验证 `SELECT 1` 通过；密码存本地记忆，经 `DB_USER/DB_PASS` 注入，不入 git）
- [ ] 会话 2：任务 0.2（后端 Spring Boot 骨架 + `/health`）+ 0.3（MySQL 连接 + 幂等建表）

## 会话 2 · M0 任务 0.2 + 0.3（后端骨架 + 数据库连接）

### [goal] 16:35 · 目标
完成后端 Spring Boot 骨架（/health 连通）与 MySQL 连接/幂等建表。表现为：`GET /api/v1/health` 返回统一结构、端口仅绑 127.0.0.1、清库后启动自动建 8 表、重启无报错、单测通过。

### [action] 16:38 · 操作
创建 Spring Boot 3.3.5 工程（Java 21），包结构 controller/common；实现 HealthController、ApiResponse 统一响应、GlobalExceptionHandler 全局异常处理。

### [decision] 16:40 · 决策
依赖拆分：0.2 仅引 web + test，MySQL/MyBatis-Plus 放到 0.3。因为 0.2 无 datasource 时若提前引入 mybatis-plus（传递 spring-jdbc）会导致启动报「url 未配置」，拆开保证每步自洽。

### [decision] 16:44 · 决策
建库建表用 Spring 内建 `spring.sql.init` + URL 参数 `createDatabaseIfNotExist=true`，而非 docs/10 描述的「自定义 DatabaseInitializer(ApplicationRunner)」。理由：框架内建方案少 40 行样板、无 DriverManager/语句拆分手工逻辑，且 createDatabaseIfNotExist 让「谁先连接都自动建库」更健壮。放弃自建 Runner 因复杂度无收益。

### [decision] 16:45 · 决策
排序规则实际为 `utf8mb4_0900_ai_ci`（MySQL 8 默认）而非 docs/05 §3 写的 `utf8mb4_unicode_ci`。字符集 utf8mb4 满足验收；0900_ai_ci 是 MySQL 8 推荐的更准 Unicode 比对。已同步 docs/05 §3 表述。

### [error] 16:47 · 错误
验证时新实例启动报 `Web server failed to start. Port 17860 was already in use`。根因：上一会话用 TaskStop 停 `mvn spring-boot:run` 未杀到其派生的 java 子进程（PID 17416 残留占 17860）。修复：`taskkill /PID 17416 /T /F` 杀进程树。教训：spring-boot:run 的 java 子进程需 `/T` 杀进程树——正是 docs/10 任务 0.6「残留进程」问题的真实案例。

### [test] 16:48 · 验证
`mvn test` 2 个单测通过（HealthControllerTest + SchemaSqlTest）；运行时：DROP trailmind 后启动 → 自动建 8 表 → `SHOW CREATE TABLE entry` 含 `FULLTEXT...WITH PARSER ngram` → 表/库字符集均 utf8mb4 → 二次重启无报错。

### [artifact] 16:48 · 产出
- `bb127e7`：后端骨架 + /health + 单测
- `ea998fa`：数据库连接 + schema.sql 8 表 + SchemaSqlTest

### [review] 16:50 · 复盘
后端底座一次通过。教训：① 验证运行态前先确认端口/进程干净——残留进程会让「成功建表」和「启动失败」同时出现，误导判断；② 框架内建机制（spring.sql.init）优于手工 ApplicationRunner，符合「少写代码」原则。下次 0.4（workspace CRUD）开始引入真实业务逻辑与事务，需按 TDD 补 Service 单测。

### [next] 16:50 · 下一步
- [x] 会话 3：任务 0.4（workspace CRUD 创建/列表 + 落库往返）

## 会话 3 · M0 任务 0.4（workspace CRUD 创建/列表）

### [goal] 17:00 · 目标
跑通「后端 → 数据库」第一条真实业务数据链路。表现为：POST /api/v1/workspaces 创建返回 id、GET 列表含统计（导图数/会话数）、空/超长 name 返回 code=400、数据落库可查、单测通过。

### [action] 17:02 · 操作
分层落地：`entity/Workspace`（@TableId AUTO，含 @TableField(exist=false) 的 mindmapCount/sessionCount 统计列）→ `repository/WorkspaceMapper`（BaseMapper + listWithCounts 子查询）→ `service/WorkspaceService`（create 校验 + list）→ `controller/WorkspaceController`（POST/GET）。新增 `common/BadRequestException`，GlobalExceptionHandler 加 400 分支。

### [decision] 17:04 · 决策
统计列用一条 SQL 子查询（`(SELECT COUNT(*) FROM mindmap WHERE workspace_id=w.id) AS mindmap_count`）带出，而非逐工作区 N+1 查询——列表 <50 行一次搞定，且走 `map-underscore-to-camel-case` 自动映射到统计字段。

### [decision] 17:04 · 决策
列表复用 `Workspace` 实体挂统计列（`@TableField(exist=false)`），不另建 VO 类——少一个文件，前端拿到的 JSON 形状不变。

### [decision] 17:05 · 决策
校验放在 service 手工做（name 非空/≤100、repoPath 存在 .git），用 `BadRequestException` 转 code=400，与 docs/10 §7「service 层校验」描述一致，不引入 jakarta-validation 注解与 DTO。不用 `@Transactional`：0.4 只有单条 insert（已原子），无多语句写。

### [error] 17:06 · 错误
curl 直接 `-d '{"name":"中文"}'` 报 `JSON parse error: Invalid UTF-8 middle byte`。根因：Windows 终端把命令行中文按 GBK 编码传，非后端 bug（ASCII 的空名/超长名均正确返回 400）。修复：`--data-binary @utf8.json` 传文件体重验通过，中文正常落库。

### [test] 17:07 · 验证
`mvn test` 8 个通过（Health 1 + WorkspaceController 集成 2 + WorkspaceService 4）；运行时 curl：POST 返回 id、GET 列表含刚创建项且统计=0、空名/超长名 code=400；`mysql SELECT` 可见数据落库。停止时用 `taskkill /T /F` 杀进程树，确认无残留 trailmind java 进程（其余 java 为 Gradle/VSCode 守护，与本应用无关）。

### [artifact] 17:08 · 产出
- `eb49c01`：工作区创建与列表接口 + 单测

### [review] 17:09 · 复盘
第一条真实业务链路一次通过。两点观察：① POST 响应的 createdAt/updatedAt/mindmapCount 为 null（insert 只回填自增 id，时间戳与统计需 SELECT 才有）——前端 M0 用 GET 列表取全量即可，后续若有需要再在 create 后回查；② curl 传中文的编码坑与后端无关，验证时用文件体更稳。下次 0.5（前端）开始前后端连通，需按 04 §5 契约封装 API client 并做 CORS/proxy。

### [next] 17:09 · 下一步
- [x] 会话 4：任务 0.5（前端工程 + 首页连通，Vite + React + TS + zustand）

## 会话 4 · M0 任务 0.5（前端工程 + 首页连通）

### [goal] 17:11 · 目标
完成前端工程 + 首页连通。表现为：浏览器打开首页显示品牌名「思迹 TrailMind」、后端版本号、工作区列表；点创建按钮列表出现新工作区（刷新不丢）；后端未启动时显示明确错误态而非白屏；单测通过。

### [action] 17:15 · 操作
手写 Vite + React 18 + TS 工程骨架（package.json / vite.config.ts / tsconfig.json / index.html），未用 `npm create vite` 交互式脚手架——agent 环境下交互提示无法自动化，手写等价且可控。依赖 react/react-dom/zustand；dev 依赖 vite/vitest/@testing-library/ts。

### [action] 17:20 · 操作
实现 api 层：`client.ts`（原生 fetch，baseURL `/api/v1`，统一解包 `{code,data}`，code≠0 抛 ApiError，网络失败提示「后端未连接」）、`health.ts`、`workspaces.ts`、`types.ts`（Health/Workspace/ApiResponse 类型）。

### [action] 17:23 · 操作
实现首页 App + zustand store（useAppStore：health/workspaces/loading/error + load/create），品牌名 + 版本号 + 工作区列表 + 创建按钮 + 空态/错误态。

### [decision] 17:21 · 决策
用原生 fetch 而非 axios——文档允许「axios 或原生 fetch」，原生少一个依赖，封装 40 行内完成，足够 M0/M1 用；放弃 axios 因无额外需求。

### [decision] 17:22 · 决策
用 Vite dev proxy（`/api` → 127.0.0.1:17860）而非后端加 CORS——文档推荐 proxy，生产 Electron 加载打包产物本就无跨域，后端不暴露 CORS 头，安全边界（N6）更干净。

### [decision] 17:24 · 决策
样式用普通 CSS（App.css + index.css）而非 CSS Modules——08 §4.3 写「CSS Modules（或约定方案，M0 定）」，M0 首页单组件，普通 CSS 最小；M1 组件增多时再定约定并迁移。

### [test] 17:38 · 验证
`npm test` 7 个通过（client 4：解包成功 / code≠0 抛错 / 网络异常提示 / body 序列化；App 3：渲染品牌名+版本号 / 空态 / 后端不可用错误态）；`npm run build`（tsc --noEmit + vite build）通过。运行时 e2e：起后端（DB_PASS 注入）→ 起前端 dev server → 经 proxy 调 /health 返回 code=0、POST /workspaces 创建成功（id=3）、GET 列表含新工作区（统计=0），全链路连通。

### [artifact] 17:41 · 产出
- `4d92215`：前端工程骨架 + 首页连通 + 单测

### [review] 17:45 · 复盘
前端骨架一次通过，e2e 全链路（Vite proxy → 后端 → MySQL）验证通过。两点观察：① `mvn spring-boot:run` 与 `npm run dev` 的 npm wrapper 被 TaskStop 杀掉后，其派生的 java/node 子进程仍残留占端口，需 `netstat` 查 PID + `taskkill /T /F` 杀进程树——这正是任务 0.6 Electron 壳要解决的「残留进程清理」的真实复现；② create 接口返回的 createdAt/统计列为 null（会话 3 已记录），首页列表用 GET 取全量规避。下次 0.6（Electron 壳）开始进程生命周期管理，是 M0 的难点任务。

### [next] 17:45 · 下一步
- [x] 会话 5：任务 0.6（Electron 壳 + 后端进程生命周期管理）

## 会话 5 · M0 任务 0.6（Electron 壳 + 后端进程生命周期）

### [goal] 17:50 · 目标
完成 Electron 壳：桌面窗口自动拉起/关闭 Java 后端、端口冲突（残留进程）自动清理、退出无残留 java。表现为：`npm run dev:desktop` 窗口出现→遮罩→后端自动拉起→首页连通；关窗口后端自动退出；双实例不重复拉后端；单测通过。

### [action] 17:52 · 操作
后端新增 `ShutdownController`（POST /api/v1/shutdown）：先异步返回响应（延迟 300ms 保证送达），再 `System.exit(SpringApplication.exit(...))` 优雅关闭，供 Electron 退出时调用；用 AtomicBoolean 防重复触发。

### [action] 17:55 · 操作
desktop/ 建 Electron 工程：`main/index.js`（requestSingleInstanceLock 单实例锁、1280×800/min 960×600 窗口、splash「正在启动后端…」遮罩、before-quit→stop）、`main/backend-process.js`（纯 Node 模块：端口探测→决策→spawn java -jar→健康等待→POST /shutdown 优雅关闭 + taskkill 兜底）、`preload/index.js`（预留）。

### [decision] 17:56 · 决策
backend-process 用纯 Node（CommonJS、零 Electron 依赖），核心逻辑抽成 `decideStart`/`waitForHealth` 纯函数并支持依赖注入——直接用 `node --test` 单测分支逻辑，不为一个模块引入 vitest/tsc 构建链。放弃 docs/10 §9 写的 `.test.ts`：为测一个文件引入 TS 构建链收益不成比例，且 Electron 主进程默认 CJS，全程无需编译。

### [decision] 17:57 · 决策
端口占用判定用「TCP connect 探测 + netstat -ano 查 PID + PowerShell Get-CimInstance 查命令行」，命令行含 `trailmind` 即判为本应用残留→taskkill /T /F 后重启；否则报「被其他程序占用」。放弃 wmic（Win11 已弃用）；taskkill 必带 /T 杀进程树（对应会话 2 记录的残留教训）。

### [decision] 17:58 · 决策
「正在启动后端…」遮罩由主进程先 loadURL 一个 data: URL splash，后端健康就绪后再切到前端——不改前端 0.5 的加载/错误态，遮罩自包含在 desktop/。

### [error] 17:58 · 错误
Electron 二进制下载失败：npm 包已装（electron@43.4.0），但 postinstall 从 GitHub 下载 electron.exe 报 `TypeError: fetch failed`；npmmirror 的 cdn 亦仅 65KB/s（138MB 需约 35 分钟）。根因：GitHub releases 不可达、npmmirror CDN 限速。**已解决**：改用华为云镜像 `ELECTRON_MIRROR=https://repo.huaweicloud.com/electron/`（约 515KB/s，数分钟下载完成，checksum 校验通过）。

### [error] 18:10 · 错误
GUI 冒烟首次启动报 `TypeError: Cannot read properties of undefined (reading 'requestSingleInstanceLock')`。根因：agent 环境的 bash 里被注入了 `ELECTRON_RUN_AS_NODE=1`（Windows 用户/系统环境变量与 shell 配置均无此项，属 Claude Code 会话环境注入），导致 electron.exe 以纯 Node 模式运行，`require('electron')` 解析不到内置 `app`。修复：启动时 `env -u ELECTRON_RUN_AS_NODE` 解除；非代码缺陷，用户本机终端无此变量、不受影响。

### [test] 17:59 · 验证
- desktop `node --test`：9 个单测通过（decideStart 三分支、waitForHealth 重试/超时、start 的 kill-and-spawn/spawn/error 三分支）。
- `mvn clean package`（JDK 21 + DB_PASS）：8 个后端测试通过，产出 `target/trailmind-backend-0.0.1.jar`。
- headless e2e（node 直跑 backend-process）：`start()` spawn→健康等待 healthy=true（约 2.6s）；`stop()` POST /shutdown→java 优雅退出（约 0.36s），端口 17860 无 LISTENING 残留；`queryPortOwner(17860)` 实测识别运行中 trailmind 进程（cmdline 含 trailmind）。
- GUI 冒烟（华为云镜像补下二进制 + `env -u ELECTRON_RUN_AS_NODE`）：vite 起 → Electron 窗口进程存活 → 后端自动拉起（6 次轮询内 LISTENING）→ `/health` code=0 连通，主进程/GPU/渲染子进程齐备。
- 未完全自动化验证：真实「点窗口 X → 后端退出」链路——外发 WM_CLOSE 无法可靠触发 Electron 窗口 close，`stop()` 优雅关闭已由 headless e2e 覆盖，`before-quit→stop` 为标准 3 行事件绑定，列为低风险人工验收项。

### [artifact] 18:00 · 产出
- 提交 `feat(backend)`：优雅关闭接口 POST /api/v1/shutdown
- 提交 `feat(desktop)`：Electron 壳 + backend-process 进程管理 + 单测 + `dev:desktop` 脚本

### [review] 18:02 · 复盘
进程生命周期是 M0 难点，本次把关键决策抽成纯函数 + 依赖注入，最难测的「残留进程清理」分支用 node:test 直接覆盖，且 headless e2e 跑通 start→stop 全链路。三点教训：① Electron 二进制下载是「网络/镜像」类外部依赖，应像 MySQL 凭据一样在会话开始就确认可达性，而不是到验证阶段才撞墙；② GUI 窗口这类「不可见验证」必须明确列为人工验收项，不能用「代码写完」冒充「验证通过」；③ 依赖注入让 Electron 主进程逻辑可脱离 Electron 单测，是这类「壳」任务的关键手段；④ 镜像选择要实测速度：npmmirror CDN 65KB/s 与华为云 515KB/s 差近 8 倍；⑤ `ELECTRON_RUN_AS_NODE=1` 这类会话注入的环境变量会让 electron 静默降级为 node 模式，报错极不直观（`app` undefined），遇到 `require('electron')` 异常应先 `env | grep -i electron`。下次 0.7 一键脚本/打包：dev/build/package 脚本 + verify 冒烟 + electron-builder NSIS。

### [next] 18:02 · 下一步
- [x] 会话 6：任务 0.7（一键脚本 dev/build/package + verify 冒烟 + electron-builder NSIS 打包）

## 会话 6 · M0 任务 0.7（一键脚本与打包）

### [goal] 18:05 · 目标
落地四个脚本 + 打包配置：`npm run dev` 一键开发、`npm run build` 构建、`npm run package` 打包、`node scripts/verify.mjs` 冒烟全绿输出 `M0 SMOKE: ALL PASS`。表现为：build/verify 真实跑通，dev/package 脚本就位且语法可用。

### [action] 18:08 · 操作
写四个 Node 脚本（`.mjs`，纯内建模块零新依赖）：`dev.mjs`（并行 spawn 前后端 + Ctrl+C 整树 taskkill）、`build.mjs`（前端 vite build + 后端 mvn clean package）、`package.mjs`（构建后调 electron-builder）、`verify.mjs`（/health → schema → workspace 往返）；补 `desktop/electron-builder.yml`（NSIS，jar 走 extraResources、前端 dist 入 asar），desktop/package.json 加 electron-builder 依赖与 `dist` 脚本。

### [decision] 18:12 · 决策
`dev.mjs` 复用 `desktop/main/backend-process.js` 的 `killProcessTree`（taskkill /T 杀进程树），而非在 scripts/ 里再写一份——同一段「杀进程树」逻辑已在 0.6 落地并单测，跨目录 import 一次即可，避免复制粘贴两份漂移。

### [decision] 18:14 · 决策
verify 的 schema 检查与 workspace 清理走 `mysql` CLI + `MYSQL_PWD` 环境变量，不引入 mysql2 依赖——脚本零第三方依赖，密码也不进命令行/日志。放弃 mysql2 因只为 2 条 SQL 加一个依赖不划算。

### [decision] 18:14 · 决策
verify 第 3 步的「DELETE 清理」用 SQL 而非 API：后端 0.4 只实现了创建/列表、无 DELETE 接口，加接口属 M1 全量 CRUD 的范围。故冒烟脚本用 `DELETE FROM workspace WHERE name=...` 清理（唯一名 `verify-<pid>-<ts>`），M1 补 DELETE 后可改回 API 调用。

### [error] 18:20 · 错误
verify.mjs 首跑 workspace 往返失败：`Content-Type 'application/octet-stream' is not supported`。根因：Node 内建 `http.request` 不自动设 Content-Type，POST 无 body 头被 Spring 判为 octet-stream 拒绝。修复：`request` 有 body 时显式加 `Content-Type: application/json` 头。这个正是冒烟脚本存在的价值——首跑就抓到真实缺陷。

### [test] 18:40 · 验证
- 单测：`node --test scripts/test/verify.test.mjs` 5 个通过（EXPECTED_TABLES 8 表 / missingTables 缺失检测 / summarize 通过·失败分支）。
- verify e2e：起后端 jar（JDK21 + DB_PASS）→ `node scripts/verify.mjs` 输出 `M0 SMOKE: ALL PASS`（health code=0、schema 8/8、workspace 往返）；清理后 `verify-%` 残留=0、端口 17860 无 LISTENING。
- build e2e：`node scripts/build.mjs` 跑通（前端 vite build + 后端 mvn clean package，8 个后端测试通过，jar 重建）。
- **未完全自动化验证**：① `dev.mjs` 的真实 Ctrl+C 树杀（spawn 两个子进程 + 信号处理，本轮未拉起 GUI 前台进程实测，逻辑复用已单测的 killProcessTree）；② `package.mjs` 的 electron-builder NSIS 打包（electron-builder 尚未 npm install，且 NSIS/winCodeSign 需从 GitHub 下载，与会话 5 的 electron 二进制同类网络依赖）——列为人工验收项，见 0.8 总验收。

### [artifact] 18:42 · 产出
- `9a74c8e`：一键开发/构建/打包脚本 + 验收冒烟 + electron-builder 配置 + verify 单测

### [review] 18:45 · 复盘
0.7 把 M0 的「可工程化」补全，build/verify 两条主链路真跑通。三点教训：① 冒烟脚本首跑就抓到 Content-Type 缺陷，说明「先写脚本再跑一遍真服务」比「写完即称完成」可靠得多——验证优先于完成；② 复用既有 killProcessTree 而非复制，是「少写代码」的正例，但 `scripts/` 反向 import `desktop/main/` 的依赖方向略别扭，若后续 scripts 增多可考虑把通用进程工具抽到 `scripts/lib/`；③ 打包与 GUI 前台这类「网络/不可见」环节必须诚实标注为人工验收项，不能混进「已验证」。下次 0.8 做 M0 总验收 + dogfooding：把 M0 全程过程补成 CHANGELOG 记录并逐项勾选 07 §3 验收清单。

### [next] 18:45 · 下一步
- [ ] 会话 7：任务 0.8（M0 总验收 + dogfooding 启动记录：勾选 07 §3 全清单、补 M0 过程记录、同步 AGENTS.md 进度至 M1）

## 会话 7 · M0 任务 0.8（M0 总验收 + dogfooding 启动）

### [goal] 18:38 · 目标
完成 M0 总验收：逐项执行 07 §3 / 10 §12 验收清单，能自动化的以硬证据勾选、GUI/权限项诚实标注；补写 M0 全程过程记录（会话 1-6 已写，本会话收尾）；同步 AGENTS.md 进度至 M1。表现为：`node scripts/verify.mjs` 全绿、三套单测通过、进度文档同步、本会话写 review。

### [action] 18:40 · 操作
以 JDK 21 + `DB_PASS` 环境变量启动后端 jar（`Started in 2.066 seconds`），跑 `node scripts/verify.mjs` 输出 `M0 SMOKE: ALL PASS`（health code=0、schema 8/8、workspace 创建→列表→清理往返）。

### [test] 18:46 · 验证
- 后端 `mvn test`：8 通过（SchemaSql 1 + Health 1 + WorkspaceController 2 + WorkspaceService 4）。注意：`@SpringBootTest` 集成测试需注入 `DB_PASS` 才能加载上下文，裸 `mvn test` 报 `ApplicationContext failure`——非缺陷，是集成测试连 MySQL 的前置。
- 前端 `npm test`：7 通过（client 4 + App 3）。
- desktop `node --test`：9 通过（backend-process 决策/健康等待/启停分支）。
- 验收项逐条实测：`GET /api/v1/health` code=0 ✓；端口仅绑 127.0.0.1（N6）✓；workspace 创建/列表/空名 400 ✓；schema 8 表齐全 ✓；优雅关闭 `POST /api/v1/shutdown` 返 code=0、端口释放、无残留 trailmind java ✓；幂等建表（表已存在时重启无错）✓。

### [error] 20:57 · 错误
`npm run package` 在 electron-builder 解压 winCodeSign 失败：`ERROR: Cannot create symbolic link : 客户端没有所需的特权 : .../darwin/10.12/lib/libcrypto.dylib`。根因：Windows 未开启「开发者模式」，7zip `-snld` 解压软链接需 `SeCreateSymbolicLinkPrivilege` 权限，而 winCodeSign/NSIS 归档内含 macOS dylib 软链接。验证：`7za x -snl-`（关软链接）解压成功（83 文件、Everything is Ok），证明归档与打包代码无误、纯权限前置。修复：设置 → 隐私和安全性 → 开发者选项 → 开启「开发人员模式」（或以管理员运行），重跑 `npm run package`。

### [decision] 21:00 · 决策
「双击打包 exe 安装、启动 ≤3s」不勾选完成，标注为**环境待办**：① 产 exe 需先开开发者模式；② 安装/启动计时本就是 GUI 人工验收，agent 环境无法 headless 完成。与其用 `-snl-` 手工预解压缓存绕行，不如把前置条件写进文档（已同步 docs/10 常见坑），一次到位、不伪造验证。

### [review] 21:12 · 复盘
M0 收尾：8 项验收中 7 项以硬证据勾选（verify 全绿 + 三套单测 + 端口/幂等/CRUD/优雅关闭逐条实测），唯一未勾选是「打包安装 ≤3s」，根因是 Windows 开发者模式这一系统级权限前置、与代码无关。三点教训：① 打包这类「网络 + 系统权限」双重外部依赖，应在 0.7 就实测一次而非留到 0.8 才撞权限墙；② `npm install` 被超时中断会留下「包在、bin 链接缺失」的半装态，表现为 `'electron-builder' 不是内部或外部命令`，补救是重跑 `npm install` 补 bin 链接；③ 验收要诚实：能自动化就自动化，GUI/权限项明确标注人工、不冒充。下次 M1（工作区 + 树状导图）进入画布业务，需按 TDD 先补树布局纯函数单测。

### [next] 21:12 · 下一步
- [ ] 遗留（人工）：开启 Windows 开发者模式后 `npm run package` 产出 exe + 双击安装启动 ≤3s 计时
- [ ] M1：工作区 + 树状思维导图（07 §4）
