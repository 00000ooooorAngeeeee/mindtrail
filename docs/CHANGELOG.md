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
MySQL `root` 无密码连接报 `ERROR 1045 (28000): Access denied for user 'root'@'localhost' (using password: NO)`。根因：本机 root 已设密码，密码未提供。修复：暂未阻塞（本会话不涉及 DB），已记录为任务 0.3 前置；需提供 `DB_USER/DB_PASS`。

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
- [ ] 提供 MySQL `root` 密码（任务 0.3 前置，写入 `DB_USER/DB_PASS` 环境变量）
- [ ] 会话 2：任务 0.2（后端 Spring Boot 骨架 + `/health`）+ 0.3（MySQL 连接 + 幂等建表）
