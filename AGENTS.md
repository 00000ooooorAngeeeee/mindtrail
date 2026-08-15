# AGENTS.md — 给 AI 协作者的项目速览

> 5 分钟速读版。完整约定见 [docs/08-Agent协作手册.md](docs/08-Agent协作手册.md)，**每次会话开始必须通读 08 与 07**。

## 这是什么

**思迹 TrailMind**：Windows 桌面端工具 = 双模式思维导图 + Git 绑定的 vibecoding 过程记录。当前仓库已完成 **M0 里程碑**（后端 /health、MySQL 幂等建表、workspace CRUD、前端工程、Electron 壳、一键脚本均已落地，验收见 docs/10 §12）与 **M1 里程碑**（工作区 + 树状思维导图：CRUD、导图数据层、树状画布、撤销/重做、防抖保存，进度见下方「当前进度」），下一里程碑 **M2**（自由画布模式）。

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
- [x] M0：项目骨架与工程化（完成，验收见 docs/10 §12 与 CHANGELOG；打包安装待 Windows 开发者模式，见 docs/10 §10）
  - [x] 0.0 环境准备 ｜ 0.1 仓库初始化 ｜ 0.2 后端骨架 + /health ｜ 0.3 MySQL 连接 + 幂等建表 ｜ 0.4 workspace CRUD ｜ 0.5 前端工程 + 首页连通 ｜ 0.6 Electron 壳
  - [x] 0.7 一键脚本与打包 ｜ 0.8 M0 总验收（7/8 项硬证据通过；打包安装为环境待办）
- [x] M1：工作区 + 树状思维导图（实现完成；完整验收清单含性能项待最终 M1 验收）
  - [x] 工作区完整 CRUD + 工作区首页（详情/更新/级联删除；列表重命名/删除/详情页）
  - [x] 导图数据层：mindmap CRUD + content_json 存取 + search_text/node_count 维护 + PUT 乐观锁；工作区首页导图列表/新建/删除
  - [x] 树状模式画布（节点渲染/增删改/拖拽改层级/折叠/自研布局/缩放平移；React Flow 渲染 + 手动保存）
  - [x] 撤销/重做 ｜ 整图防抖保存（800ms）+ 乐观锁冲突提示
- [ ] M2：自由画布模式（双模式） ← **下一个任务**
- [ ] M3~M4：见 docs/07

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
