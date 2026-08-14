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
- [ ] 会话 3：任务 0.4（workspace CRUD 创建/列表 + 落库往返）
