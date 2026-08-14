# AGENTS.md — 给 AI 协作者的项目速览

> 5 分钟速读版。完整约定见 [docs/08-Agent协作手册.md](docs/08-Agent协作手册.md)，**每次会话开始必须通读 08 与 07**。

## 这是什么

**思迹 TrailMind**：Windows 桌面端工具 = 双模式思维导图 + Git 绑定的 vibecoding 过程记录。当前仓库已进入 **M0 里程碑开发**（后端 /health、MySQL 幂等建表、workspace CRUD、前端工程已落地），正在推进 Electron 壳（任务 0.6）。

## 技术栈（一句话）

- 壳：Electron（负责拉起 Java 后端子进程）
- 前端：React 18 + TypeScript + Vite + Zustand + React Flow（画布）+ CodeMirror 6（Markdown）
- 后端：Java 17 + Spring Boot 3 + MyBatis-Plus + JGit，REST API 监听 127.0.0.1:17860
- 数据库：MySQL 8.x（库名 `trailmind`），schema 见 docs/05，幂等建表

## 必守规则（违反 = 返工）

1. **开工前读文档**：docs/07（做什么）→ docs/02（需求）→ docs/04/05（架构/数据）→ docs/06（记录规范）
2. **一次会话只做一个验收项**：见 docs/07，小步提交（Conventional Commits，中文主题）
3. **表结构变更必须同步 docs/05 的 schema.sql**
4. **写操作走事务**；删除级联在 Service 层显式处理
5. **关键逻辑必须补单测**：树布局、seq 分配、导出还原、搜索
6. **过程记录是本产品的灵魂**：每次会话结束按 docs/06 写 review；M3 之后用产品本身记录（dogfooding）
7. **导出格式是协议**：docs/06 §4，改动必须升 version

## 快速命令（M0 落地后）

- `npm run dev`：一键前后端联调
- `npm run package`：打包 exe
- `scripts/verify`：里程碑验收冒烟

## 当前进度

- [x] v0：文档完备
- [ ] M0：项目骨架与工程化（进行中）
  - [x] 0.0 环境准备 ｜ 0.1 仓库初始化 ｜ 0.2 后端骨架 + /health ｜ 0.3 MySQL 连接 + 幂等建表 ｜ 0.4 workspace CRUD ｜ 0.5 前端工程 + 首页连通
  - [ ] 0.6 Electron 壳 ← **下一个任务** ｜ 0.7 一键脚本与打包 ｜ 0.8 M0 总验收
- [ ] M1~M4：见 docs/07

## 文档索引

| 文档 | 一句话 |
|---|---|
| docs/01 | 定位与愿景（为什么做） |
| docs/02 | PRD（做什么、优先级） |
| docs/03 | 交互与视觉规范（界面怎么做） |
| docs/04 | 技术架构（怎么搭、接口契约） |
| docs/05 | 数据模型（表结构、JSON 结构） |
| docs/06 | 过程记录规范（灵魂：格式与协议） |
| docs/07 | 路线图与里程碑（先做哪、验收什么） |
| docs/08 | Agent 协作手册（完整工作约定） |
| docs/09 | 风险与开放问题 |
| docs/10 | M0 任务分解（会话级任务、实施步骤、验收清单） |
