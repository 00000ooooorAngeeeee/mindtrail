# 会话记录：Wails 自包含打包——改绑便携 MySQL + 端到端验证（2026-09-17）

> 本文件按 [06-过程记录规范](../06-过程记录规范.md) 格式记录本次会话。自 M3 任务二起过程记录已迁移到产品本身（工作区「TrailMind 开发」，07 §6 dogfooding 切换点），CHANGELOG 冻结于会话 21；本次因 agent 会话无法写入产品数据库，先以文档形式落盘，待人工/后续会话迁移进产品工作区。

## [goal] 目标

把「自包含非 Electron 打包」（specs 设计文档 2026-08-23，Phase 0–4 已实现但**端到端被阻塞**）打通到可交付状态：双击安装后在 WebView2 里跑的是 Wails 桌面应用（无 CMD、无浏览器），且**无需预装 Java/MySQL**。

用户本次决策（三问三答）：
1. 捆绑数据库 → **便携 MySQL 8.4 LTS**（而非继续 MariaDB）；
2. 产物形态 → **NSIS 安装包**（双击安装 exe）；
3. Electron 壳 → **本期一并删除**。

## [action] 操作

**S1 壳与打包脚本改绑 MySQL（提交 `d2da027`）**
- `desktop/wails/internal/orchestrator/orchestrator.go` → `mysql.go`：初始化改 `mysqld --initialize-insecure --basedir=<便携目录> --datadir=<数据目录> --mysqlx=OFF`；启动参数补 `--mysqlx=OFF`（不占 X Protocol 33060）；就绪判定由 TCP 探测改 `mysqladmin ping`；编排方法通用化为 `StartDatabase/StopDatabase/StartBackend/Run`。
- `desktop/main/mariadb-process.js` → `mysql-process.js`（Go 壳的可执行规格，命令/路径/状态机对齐；22 条 node:test）。
- `scripts/package-desktop.mjs`：MySQL zip 三级回退就位（`vendor/mysql/bin` 已就位 → `vendor/mysql-cache/<version>` → 下载解压），release 组装目录 `mariadb` → `mysql`（与壳 `%APPDIR%\mysql` 对齐）；脚本单测 8 → 12 条。
- docs：设计文档 §3/§4.3/§6/§7/§8/§9/§10/§11 全量改绑并新增 §10.1 决策记录；11 §11 脚本与壳索引、§15 待办同步。

**S2 端到端实证（新增 `scripts/e2e-packaged.mjs`）**
- 编排等价流程实跑：`mysqld --initialize-insecure` → 起库 13306 → 起后端 app-image（注入 DB env）→ `/api/v1/health` → 根路径同源返回 SPA → 幂等建 9 表 → **`FULLTEXT ... WITH PARSER ngram` 建索引成功** → 保存导图校验 `search_text/node_count`（05 §4）→ 中文全文搜索命中（片段 + 节点定位）→ 反序清理无残留。
- 结果：`S2 E2E: ALL PASS（10 项）`。

**S2b 壳 exe 编排与孤儿清理（新增 `scripts/e2e-shell.mjs`，提交见下）**
- 壳 exe 实跑：自动初始化 `%APPDATA%\TrailMind\db` → 拉起便携 MySQL 并 ping 就绪 → 拉起后端并 `/health` 200。
- 发现并修复**真实缺陷**：壳被强杀时 `Run()` 的收尾不执行 → `mysqld`/后端残留（违反 M0/M2 验收「强杀应用后重启无残留」）。修复：启动期把子进程 pid 写入 `%APPDATA%\TrailMind\run.json`，正常收尾删除；下次启动 `Shell.Run` 先 `CleanupStale` 按「先停后端、再停数据库」清理孤儿。
- 结果：`S2b SHELL: ALL PASS（5 项）`（含「强杀后重启：新实例清理孤儿并自行就绪」）。

## [decision] 决策

1. **捆绑库选 MySQL 而非「继续 MariaDB + 重写搜索」**：MariaDB 不支持 `WITH PARSER ngram`（`Function 'ngram' is not defined`），而 ngram 是 M4 全局搜索基础（05 §4、09 R4）。改绑 MySQL 保持「零后端/搜索改动」，避免破坏 N3 性能契约（1 万条目 ≤1s）与既有 262 后端测试语义。代价是体积（本机 MySQL 8.0 安装目录 bin+lib+share ≈ 489MB，官方 zip ≈ 250MB 压缩）与首运行初始化数秒。
2. **就绪判定用 `mysqladmin ping` 而非 TCP 探测**：初始化期端口已监听但拒绝查询，TCP 通 ≠ 可服务；单测补「端口通但未就绪须等 ping」用例固化该认识。
3. **强杀残留用「运行态文件 + 下次启动清理」**：Windows 上无法在进程被强杀时执行收尾；pidfile 是唯一可靠抓手，且清理顺序必须与正常收尾一致（先后端后数据库）。
4. **本次不删除 Electron 壳**（S5 单列）：Electron 还承担 `npm run dev/launch` 与 4 个 GUI/性能冒烟脚本（`verify-m2-gui`、`perf-regression`、`perf-search`、`verify-m4-acceptance`，均依赖 Electron+CDP）。先打通打包主线，再迁移这些脚本到 WebView2 远程调试口，避免同时动验收基础设施。

## [error] 错误

1. **`spawn EPerm`（Node 带管道的 spawn/spawnSync 全被沙箱拒绝）**：`node --test`（runner 用管道拉起子进程）、`vitest`（esbuild 服务）在本会话直接失败；`spawnSync` 默认 stdio 亦 EPERM。规避：单测文件 `node <file>` 直跑；脚本内捕获输出用 `spawnSync` + fd 重定向到临时文件；前端 vitest 经一次性升权运行（287/287 通过）。
2. **jpackage app-image 报「Failed to launch JVM」弹窗**：诊断脚本用 `stdio:'ignore'`（NULL 句柄）拉起后端触发（`d1b0b1a` 已修的已知问题），壳与脚本都需给有效 std 句柄（NUL 设备须用 `\\.\NUL` 全路径，Node `openSync('NUL')` 会被当相对文件）。
3. **脚本 stdio 句柄生命周期**：把父进程打开的 fd 传给 `spawn` 后父进程 `closeSync` 会使子进程句柄失效（表现为进程在跑但行为异常）——服务进程一律 `stdio:'ignore'`，日志交由其自身文件。
4. **自造夹具踩契约坑**：e2e 脚本初版把 `content_json.nodes` 写成数组，而契约是**以节点 id 为键的对象**（05 §4）→ `search_text` 没进节点文本、`node_count=0`、搜索空结果。教训：端到端脚本必须**断言契约字段**（`node_count`、`search_text`、命中片段、`nodeId`），否则会把脚本自身缺陷误判为产品缺陷。
5. **沙箱无法终止孤儿进程**：`taskkill`/`Stop-Process` 对早期诊断遗留的 mysqld `Access denied`（升权重试仍拒），改为「换数据目录 + 换端口」绕开，不作为产品结论。

## [test] 验证

- 后端 `mvn test`：**266 通过 / 0 失败**（BUILD SUCCESS；含搜索、导出、备份恢复等全量回归）。
- 前端 `npm test`（vitest）：**287 通过 / 34 文件**。
- 脚本 + 桌面 `node:test`（单文件直跑）：**100 → 112 通过**（`mysql-process` 22、`package-desktop` 12、`backend-process` 9、其余 69）。
- Go 壳 `go test ./...`：**23 通过**（新增运行态解析/孤儿清理/正常收尾删 pidfile 等 4 条）。
- `scripts/e2e-packaged.mjs`：**S2 E2E: ALL PASS（10 项）**。
- `scripts/e2e-shell.mjs`：**S2b SHELL: ALL PASS（5 项）**。
- 环境变量链路独立验证：后端以 `DB_PORT=13306` 启动后在 bundled 库建 9 张表，真实 3306 库 mindmap 行数零变化（证明壳注入生效、未污染用户库）。

## [artifact] 产出

- `d2da027`：refactor(shell): 壳与打包脚本改绑便携 MySQL——解除 ngram 阻塞（含 Go/脚本单测与 docs 同步）
- （本次收尾提交）：fix(shell): 强杀残留孤儿进程清理（运行态文件）+ 打包产物端到端验证脚本
- 新增 `scripts/e2e-packaged.mjs`、`scripts/e2e-shell.mjs`（打包产物验收脚本，详见设计文档 §13）
- 设计文档新增 §13 端到端验证脚本、§14 受限环境注意事项

## [review] 复盘

- 本次最大价值不在写代码，而在**把「文档说已实现」变成「实机有证据」**：Phase 0–4 早就写完了，但端到端从没跑通过，阻塞点（MariaDB 无 ngram）在 11/manual 里挂了三周。先做「最小可信实证」（起库→建表→搜索），阻塞点当天就被证伪/解决。
- 教训一：**先证伪再动手**。一开始想让「MariaDB + LIKE 兜底」过关，若按此改会连带重写搜索语义、破坏 N3 性能契约，且难以说服「零搜索改动」的设计目标。用 5 分钟实测 ngram 在 MySQL 上可用，直接消掉了整条风险链。
- 教训二：**验收脚本必须断言契约**。本轮三次「失败」中有两次是脚本自己写错请求体/断言字段（`nodes` 数组 vs 对象、`nodes` vs `nodeId`），一次是真缺陷（强杀残留）。没有契约断言，真缺陷会被噪声淹没。
- 教训三：**强杀路径是被长期忽略的一类验收项**。正常关窗人人测，强杀没人测——而 M0/M2 验收清单里它一直在。运行态文件（pidfile）是这类场景的通用解法，值得推广到其他子进程型桌面应用。
- 教训四：**沙箱限制要写进文档**而不是每次重新踩。Node 管道 spawn 的 EPERM、jpackage 的 std 句柄、GUI 脚本需全权限——已写入设计文档 §14 与 11 §15。

## [next] 下一步

- [ ] S3 **NSIS 安装包**：`wails build -nsis`（需先装 NSIS 并确认 `makensis` 在 PATH）；核对安装后程序目录含 `mysql/` 与 `trailmind-backend/`（Wails NSIS 模板默认只带壳 exe，需在 `project.nsi` 补 `File /r`）；数据仍落 `%APPDATA%` 以便升级不丢。
- [ ] S4 **图标约定 + N4 验收**：换 `branding/icon.ico` 重打包 → 壳/后端/安装包三处图标同步；补 07 §3 M0 唯一未勾项（双击安装后启动到可交互 ≤3s）。
- [ ] S5 **移除 Electron 壳**：`desktop/main|preload`、`npm run launch/dev:desktop`、`electron-builder.yml` 退役；4 个 GUI/性能脚本从 Electron+CDP 迁到 WebView2 远程调试口（`WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=…`）；同步 04/11/AGENTS.md 多处描述。
- [ ] S6 **人工提供前置文件**：MySQL 8.4 便携 zip（放 `desktop/vendor/`）与 NSIS 安装包（agent 会话无外网，脚本已支持复用 zip 与缓存）。
- [ ] **dogfooding**：把本记录按 06 格式写入产品工作区「TrailMind 开发」（本次 agent 无法写产品库，需人工或后续会话补录）。
- [ ] 查看并关闭诊断期遗留的 `mysqld.exe` 残留进程（沙箱内无法终止，见 [error] 5）。
