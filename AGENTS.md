# AGENTS.md — 给 AI 协作者的项目速览

> 5 分钟速读版。完整约定见 [docs/08-Agent协作手册.md](docs/08-Agent协作手册.md)，**每次会话开始必须通读 08 与 07**。

## 这是什么

**思迹 TrailMind**：Windows 桌面端工具 = 双模式思维导图 + Git 绑定的 vibecoding 过程记录。当前仓库已完成 **M0–M4 全部里程碑**、**v1.1 P1 全部任务**（07 §8 Backlog P1 行全部勾选）与 **v1.2 P2**（导入恢复 §20、Markdown 大纲导出 §21、多标签批量合并 §22、自定义快捷键 §23；**可落地项已全部完成**），剩余仅为暂缓项（AI 会话自动摘要、每周复盘报告、会话/工作区模板、主题定制，见 09 §3 与 07 §8）。

## 技术栈（一句话）

- 壳：Electron（负责拉起 Java 后端子进程）
- 前端：React 18 + TypeScript + Vite + Zustand + React Flow（画布）+ CodeMirror 6（Markdown）
- 后端：Java 21 + Spring Boot 3 + MyBatis-Plus + JGit，REST API 监听 127.0.0.1:17860
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
- [x] M2：自由画布模式（双模式）——已总验收（07 §5 全清单 + GUI 实机验证 23 项全过，见 CHANGELOG 会话 16）
  - [x] M2 任务一：画布模式基础（双模式切换、自由拖拽/连线、坐标持久化、严格树判定 + 三选一）
  - [x] 节点形状（圆角矩形/矩形/椭圆/菱形）+ 颜色
  - [x] 框选多选、批量删除/移动（P1）｜ 自由便签（P1）
  - [x] M2 总验收（100 节点拖拽流畅、GUI 实机验证：`node scripts/verify-m2-gui.mjs` 输出 M2 GUI: ALL PASS；人工验收反馈修复见 CHANGELOG 会话 17-20，回归套件已扩至 33 项）
- [x] M3：过程记录（灵魂功能，含 Git 绑定）——已完成，总验收全过（07 §6 全清单：10 条条目 ≤10s/条、commit ≤10s 感知 + 一键绑定、徽标/详情弹层/解绑、强杀重启完整、1000 条目 8.6ms、Git 面板与 git log 一致、dogfooding 导出往返 21/21 还原）
  - [x] M3 任务一：会话管理 + 时间线条目（开始/结束/列表/删除、start_head/end_head、总结写 review 条目；条目追加/编辑/删除、seq 事务分配、标签即时创建；前端会话列表/详情页；后端 83 + 前端 79 单测、SMOKE ALL PASS，见 CHANGELOG 会话 21）
  - [x] M3 任务二：快速记录框 + 时间线视图（底部常驻/Enter 提交/类型记忆/Ctrl+E；类型着色/图标/时间戳/无限滚动每页 50；前端 92/92 单测、1000 条目分页 4.8~13.7ms；**本会话起过程记录迁移到产品本身**，见产品工作区「TrailMind 开发」）
  - [x] M3 任务三：Git 服务（JGit）——仓库校验/提交历史读取/5s 新提交感知 + 未绑定缓冲/绑定解绑（entry_commit）/建议卡片（同会话最多 3 次提醒）/Git 时间线面板；后端 111 + 前端 106 单测、SMOKE ALL PASS 含 git 往返，过程记录见产品工作区「TrailMind 开发」
  - [x] M3 任务四：条目卡片完善（Markdown 渲染 GFM、commit 徽标 + 详情弹层 + 解绑）+ M3 总验收；会话 Markdown 导出提前落地（06 §4 协议 + 解析器 + 往返测试）；后端 120 + 前端 114 单测、SMOKE 8/8 含 M3 总验收段，过程记录见产品工作区「TrailMind 开发」
- [x] M4 任务一：全局搜索——已完成（FULLTEXT ngram 布尔模式 + 短词/单字 LIKE 兜底、按类型分组（导图/条目/会话）、片段 + 关键词高亮、结果跳转（导图命中节点/条目 seq 定位，闪烁 2s）；后端 145 + 前端 130 单测、SMOKE 9/9 含搜索往返段、N3 实测 1 万条目首查 11ms；过程记录见产品工作区「TrailMind 开发」）
- [x] M4 任务二：标签——已完成（工作区级管理：创建/重命名/合并/删除 + 列表计数，重命名经 tag.id 引用全局生效、合并=条目重挂目标后删源；按标签过滤：工作区标签面板 + 会话过滤下拉，即时生效；后端 160 + 前端 138 单测、SMOKE 10/10 含标签往返段；过程记录见产品工作区「TrailMind 开发」）
- [x] M4 任务三：导出——已完成（会话 → Markdown 已随 M3 提前落地；新增会话 → JSON「trailmind-session-json v1」、导图 → PNG 整图「Java2D 绘制，画布坐标优先/树布局兜底，最长边 4096 等比缩放」与 OPML「parentId 派生树，_note/category 保留备注标签，自由边无法表达故忽略」；导出前先保存未落库修改；后端 169 + 前端 144 + 脚本 25 单测、SMOKE 11/11 含导出往返段；过程记录见产品工作区「TrailMind 开发」）
- [x] M4 任务四：设置页——已完成（数据库连接信息只读展示 host/port/库名/用户名/密码是否已配置（密码不回传）；主题 light/dark/system 三选一默认跟随系统，切换即时生效落库 setting 表，全站 CSS 变量深色主题（导图节点色板浅底深字保持便签效果）；默认仓库路径为会话创建回退链末端「会话 → 工作区 → 全局默认」，须为含 .git 目录的真实仓库；入口 ⚙ 按钮 + Ctrl+,；后端 186 + 前端 153 单测、SMOKE 12/12 含设置往返段；过程记录见产品工作区「TrailMind 开发」）
- [x] M4 任务五：空态与引导——已完成（03 §7 全部：新工作区居中引导卡片「新建第一张导图 / 开始第一次会话」+ 30 秒快速上手三步提示，导图与会话均空时展示、入口按钮聚焦对应创建输入框；会话 Git 面板无提交空态文案「尚未检测到提交，先关联仓库或完成一次 git commit」；搜索无结果空态「未找到，试试其他关键词」+「按标签浏览」快速过滤入口，跳转工作区标签面板并聚焦闪烁 2s；绑定建议同一会话最多 3 次提醒为 M3 任务三已实现，本轮验证单测覆盖；前端 158 单测、SMOKE 12/12 含全段回归；过程记录见产品工作区「TrailMind 开发」，会话「M4 任务五：空态与引导」）
- [x] M4 任务六：全量备份导出——已完成（`POST /backup/export` 导出全部表（v1.1 起 9 张，含 node_entry）为「trailmind-backup」v1 JSON，JDK 内置 ZipOutputStream 压缩 zip（零依赖）后 Base64 返回，协议与 06 §4A 同风格（format/version/exportedAt + 时间固定到秒），非表字段不进入备份，供 P2 导入恢复；设置页新增「数据备份」节导出全量备份按钮（zip Blob 下载）；verify.mjs 新增 unzipBackupJson 纯函数（Node 内建 zlib 解析 EOCD/中央目录/本地头）+ 备份往返段；后端 189 + 前端 160 + 脚本 28 单测、SMOKE 13/13 含备份往返段；过程记录见产品工作区「TrailMind 开发」，会话「M4 任务六：全量备份导出」）
- [x] M4 任务七：性能回归——已完成（04 §8 全预算 GUI 实机复测：新增 `scripts/perf-regression.mjs`（CDP + 合成事件 + rAF 帧率 + 页面内打点），N1 画布 500 节点缩放 194fps / 平移 165.5fps（≥45fps）、增删改 92/30/9ms（≤100ms）；N2 时间线 1000 条首屏 48ms（≤500ms）+ 分页 10ms；N3 复跑 perf-search.mjs 首查 43ms / 缓存 3ms（≤1s）；N4 参考 3098ms（正式验收仍为打包安装环境待办）；脚本单测 5、PERF-REGRESSION 12/12 ALL PASS；过程记录见产品工作区「TrailMind 开发」，会话「M4 任务七：性能回归」）
- [x] M4 任务八：缺陷清理——已完成（主路径冒烟回归：冒烟 13→14 段 ALL PASS（补导图重命名往返段）、后端 192 + 前端 161 + 脚本 33 单测、GUI 冒烟 31/31 全绿；补全 P0 遗留「导图重命名 PRD B4」——后端 PATCH /mindmaps/{id} 同步 search_text 的 name 部分 + 前端导图列表行内重命名 + 冒烟往返段；修正 07 §7 断网验收项编号错位为 PRD §6.5；过程记录见产品工作区「TrailMind 开发」，会话「M4 任务八：缺陷清理（主路径冒烟回归）」）
- [x] M4 收尾验收：已完成（07 §7 未勾两项全勾：① 断网状态全功能可用——死代理模拟断网实测（`OFFLINE_MODE=1 node scripts/verify-m2-gui.mjs` → M2 GUI 32/32：31 项冒烟在死代理下全过 + 运行期连接审计 3 采样 19-24 连接/6 进程全部仅回环），另附人工断网复测清单（07 §7）；② 7 天后复盘路径——「七日复盘·夹具会话」时间戳回填 10 天前，`node scripts/verify-m4-acceptance.mjs` → M4 ACCEPTANCE 10/10（搜索命中/标签过滤/会话打开条目渲染（review）/导出协议；GUI 实机 3 项 + API 5 项）；脚本单测 33→41、SMOKE 14 段 ALL PASS；过程记录见产品工作区「TrailMind 开发」，会话「M4 收尾验收」）
- [x] v1.1 P1：导图↔记录联动——已完成（07 §10 全清单：node_entry 第 9 张表（关系不入 content_json，05 §4 保存语义补充）；双向替换接口 PUT /mindmaps/{id}/nodes/{nodeId}/links 与 PUT /entries/{id}/nodes（先清后插幂等 + 同工作区校验）；双向查询（挂接图/节点挂接详情/条目引用列表/会话批量回填）+ 选择器（节点搜索含祖先链 path、工作区最近条目）；级联删除与整图保存差异清理；备份 9 表（trailmind-backup v1 形态不变）；前端节点 📎 挂接徽标 + 详情弹层（点击条目跳转会话定位闪烁）+ 挂接管理对话框、条目引用 chips（点击跳转导图节点闪烁）+ 引用管理对话框 + App 双向跳转接线；导出协议（06 §4/§4A）不变由全量备份覆盖；后端 192 → 216、前端 161 → 178、脚本 41 单测、SMOKE 14 → 15 段 ALL PASS；过程记录见产品工作区「TrailMind 开发」，会话「v1.1 P1 导图↔记录联动」）
- [x] v1.1 P1「B2 完善：连线标签」——已完成（07 §11 全清单，PRD B2.2 验收要点「可编辑标签」；便签/框选已于 M2 落地）：画布自由连线标签——自定义边 FreeEdge（贝塞尔 + 箭头 + 中点胶囊标签，05 §4 edges[].label）；双击连线/标签进入编辑（Enter 确认 / Esc 取消 / 失焦提交，空白清除标签），提交经 store updateEdgeLabel 统一 apply（撤销/重做 + 800ms 防抖保存）；PNG 整图导出绘制自由边标签（贝塞尔中点 t=0.5 白底胶囊，与前端几何同构）；存储链路零改动（label 字段与 search_text 含边 label 为 M1/05 §4 既有能力，verify 导图往返段早已断言）；前端 178 → 188、后端 216 → 217 单测、SMOKE 15 段 ALL PASS；过程记录见产品工作区「TrailMind 开发」，会话「v1.1 P1「B2 完善：连线标签」」）
- [x] v1.1 P1「C2.4 补记时间 / C2.5 插入条目」——已完成（07 §12 全清单，PRD C2.4/C2.5 补录场景）：追加/编辑条目可指定创建时间（ISO-8601 精确到秒，编辑面板 datetime-local 秒级输入、未改动不覆盖）；条目卡片「插入」→ 插入到该条之后（afterSeq，0=最前，越界 400），其后条目 seq+1 重排（EntryMapper.shiftSeq 降序更新，事务内）；GlobalExceptionHandler 补请求体不可读 → 400；存储链路零改动（created_at/seq 既有列）；后端 217 → 225、前端 188 → 197 单测、SMOKE 15 → 16 段 ALL PASS（新增条目插入/补记往返段）；过程记录见产品工作区「TrailMind 开发」，会话「v1.1 P1「C2.4 补记时间 / C2.5 插入条目」」）
- [x] v1.1 P1「C3.6 diff 预览」——已完成（07 §13 全清单，PRD C3.5「diff 预览 P1」，04 §5 契约自 M3 起预留）：提交详情弹层 Diff 预览——后端 `GET /git/repo/commits/{hash}/diff`（JGit DiffFormatter 相对首父 unified diff，根提交全量按新增展示；每文件 {path, diff, added, deleted}，countDiffLines 纯函数统计；文件数 >100 或 >256KB 截断标记 truncated）；前端 CommitDetailModal 每文件 details 折叠 +/- 行着色 + 增删徽标 + 截断提示，diff 失败降级不阻塞详情；存储/导出零改动（diff 实时只读不落库）；后端 225 → 231、前端 197 → 202 单测、SMOKE 16 段 ALL PASS（git 段内补 diff 断言）；过程记录见产品工作区「TrailMind 开发」，会话「v1.1 P1「C3.6 diff 预览」」）
- [x] v1.1 P1「标签云」——已完成（07 §14 全清单，PRD D4「标签云视图 P1」）：工作区标签面板顶部标签云——TagCloud 组件按使用计数分档字号（sm/md/lg/xl）+ 热度降序 + 循环色板着色，点击即时过滤（与列表同一 openFilter 路径）；tagCloudUtil.ts 纯函数（档位/色板/稳定排序）；管理操作仍在列表；后端零改动（数据源既有 GET /tags）；前端 202 → 206 单测、SMOKE 16 段回归全过；防坑：Windows 大小写不敏感导致 TagCloud.tsx 与 tagCloud.ts 冲突（import 解析到纯函数文件），纯函数改名 tagCloudUtil.ts；过程记录见产品工作区「TrailMind 开发」，会话「v1.1 P1「标签云」」）
- [x] v1.1 P1「自适应缩放」——已完成（07 §15 全清单，PRD §5 P1）：画布视图随内容变化自动适应——fitCheck.ts 纯函数 contentExceedsViewport（包围盒 vs 视口可见区 flow 坐标换算，padRatio 边距）；MindMapEditor 三触发点（内容/布局变化防抖 300ms、画布拖拽停止双 rAF、window resize），仅当超出视口才 fitView（padding 0.12 动画 300ms），未超出保持视野不打扰；实时节点取 React Flow 实例 getNodes（拖拽后闭包滞后）；v12 无 onResize prop 改 window resize 监听；前端 206 → 215 单测（fitCheck 9 条）、SMOKE 16 段回归全过；过程记录见产品工作区「TrailMind 开发」，会话「v1.1 P1「自适应缩放」」）
- [x] v1.1 P1「多会话并行视图」——已完成（07 §16 全清单，PRD §5 P1 / 02 §7「v1.1 再评估」落地 Tab 式）：App 会话视图改标签式——sessionTabs 全部挂载（非激活 display:none）状态各自保留（滚动/过滤/编辑）；标签栏点击激活/× 关闭（关激活自动切前一个）/「＋」回工作区继续打开（标签保留）；「← 返回」=关当前标签；标题占位 + getSession(size=1) 轻量回填；搜索/标签/联动跳转 upsert 标签，进导图清空；ARIA tablist/tab/tabpanel；前端 215 → 216 单测（多会话全流程）、SMOKE 16 段回归全过；**v1.1 P1 至此全部完成**；过程记录见产品工作区「TrailMind 开发」，会话「v1.1 P1「多会话并行视图」」）
- [x] v1.1 缺陷修复集（T4 评估落地）——已完成（07 §17）：① 会话标签栏 sticky 常驻；② 工作区计数实时刷新；③ 连线标签改纯文字浮于线条上方（去白底胶囊）；④ 进入导图自动适应改 React Flow fitView prop（测量完成即解析，首开/二次打开一致），按用户建议抽取 fitToView 与「适应视图」按钮共用并平滑动画（duration 300），verify-m2-gui 新增 S0d/S6a1 回归（M2 GUI 33/33）；【后续修复】fitView prop 的 fitViewQueued 在首个 updateNodeInternals 成功即解析、彼时仅部分节点已测量（getFitViewNodes 过滤未测量节点→包围盒残缺→错配，之后 fitViewQueued 已 false 不再重算；autoFit 兜底仅「超出视口」才触发，错配缩放过小亦不触发→用户须多次缩放，百节点/主图/asdfsda 复现），改由 InitialFitController（ReactFlow 子树内 useNodesInitialized 翻转=全部测量完成后再 fitView）承担首开/切图适应，移除 fitView prop、computeFitViewport 兜底；前端单测 224、tsc 通过；⑤ 连线标签 absolute 定位防多标签堆叠下移 + 上浮贴线；前端 218 单测、tsc 通过、后端 MindmapExportServiceTest 7/7、SMOKE 16 段回归；过程记录见产品工作区「TrailMind 开发」
- [x] 增量任务：批量删除 + 重命名失焦退出（用户即时需求，07 §18）——已完成：① 批量删除（4 列表：工作区/导图/会话/标签，后端 `POST /<entity>/batch-delete` 共享 `BatchDeleteRequest` + `@Transactional` 逐个级联、缺失 ID 整体回滚不删任何；前端 `useBatchSelect` hook + `BatchSelectToolbar` + `batchSelection` 纯函数，「选择模式」开关〔默认隐藏复选框〕+ 全选 + 批量删除（N）+ 二次确认）；② 重命名点击空白退出（`renameBlur` 纯函数 `focusLeftEditor`，relatedTarget 机制；WorkspaceItem/MindmapItem/TagSection input `onBlur` 失焦丢弃草稿保留原内容，Enter 仍保存、容器内按钮不触发）；后端 231 → 243（+12）、前端 → 239（+15：batchSelection 5 / renameBlur 4 / App 4 / TagSection 2）、tsc 通过、SMOKE 16 → 17 段 ALL PASS（含批量删除真实事务回滚段）；过程记录见产品工作区「TrailMind 开发」
- [x] 缺陷修复一：重命名工作区后列表计数归零（用户反馈，07 §19）——已完成：`useAppStore.rename` 用 `PUT /workspaces/{id}` 响应整对象替换列表项，而 `WorkspaceService.update` 经 `selectById` 不填充 `mindmapCount/sessionCount`（`@TableField(exist=false)`）→ 列表 `?? 0` 归零（07 §17 修复二遗漏的重命名路径）；后端 `WorkspaceMapper.selectWithCounts` + `update` 改回带计数单行查询（根因）+ 前端 `useAppStore.rename` 合并 `updated.mindmapCount ?? w.mindmapCount`（防御）；后端 243、前端 242 单测全绿、tsc 通过
- [x] 缺陷修复二：第三次进入导图适应视图失效停在左上角（用户反馈，07 §19）——**已完成**：先重建当前 HEAD（3c41383，InitialFitController 基线）的 frontend/dist 复现原 bug，加临时打点（InitialFitController 生命周期 + 内容 effect setNodes measured 分布 + RF store nodesInitialized/measured 转换）采集真实时序，**GUI 实机证实根因**：主路径 effect 依赖 `useNodesInitialized`，内容 effect 每次 `setNodes(buildNodes)` 重建节点对象使 React Flow `adoptUserNodes` 重置 `measured` → `useNodesInitialized` 翻 false → effect 清理 `cancelAnimationFrame` 掉已排程的双 rAF `fitView`，且 `doneKey` 已置位阻断重排与 800ms 兜底；是否失效取决于 outer rAF 与 cleanup 的子帧竞态（约第三次起，连接预热后 links 2 帧内返回时复现）。打点亦证 `measured` 确经 ResizeObserver 回填（0/11→11/11 约4ms），故上一会话 `carryMeasured`（保留旧 measured）前提错误、反致首开失效。修复：主路径 effect 不再依赖 `useNodesInitialized`，改 rAF 轮询 `rf.getNodes()` 的 measured，全部测量完成即一次性 `fitView` 并置 `doneKey`（提交 69f1954）。验收：GUI 实机同图 ×8 + 跨图交替 ×6 全部已适应、前端 242/242 + tsc、verify-m2-gui 33/33（S0d/S6a1）；过程记录见产品工作区「TrailMind 开发」

- [x] v1.2 P2：导入恢复——已完成（07 §20 全清单，PRD E5「导入恢复」）：`POST /backup/import` 全量恢复——`BackupRestoreService.restore(base64)` 解 zip→校验 format/version→单 `@Transactional` 清空 9 表+按原 id 回填（保留主键保证 workspace_id/session_id/entry_id/mindmap_id 引用、content_json 节点 id、entry_commit/node_entry 关联一致；InnoDB 显式 id 回填后自动推进自增计数）→RestoreSummary；校验失败（空/非 zip/格式/版本/JSON）→ 400 不写库，写入失败事务回滚；前端 `SettingsPanel`「数据恢复」节（选 zip→二次确认→摘要+刷新，`utils/backupImport` 纯函数 arrayBufferToBase64/readFileAsArrayBuffer FileReader 兼容 jsdom/formatRestoreSummary）；备份协议 trailmind-backup v1 未改动（导入据此重建）；后端 243 → 252（+BackupRestoreServiceTest 8 + BackupControllerTest 1）、前端 242 → 251（+backupImport 6 + SettingsPanel 3）、脚本 41 单测、tsc 通过、SMOKE 16 → 17 段 ALL PASS（新增导入恢复段，恢复 543 行）；过程记录见产品工作区「TrailMind 开发」，会话「v1.2 P2 备份导入恢复」

- [x] v1.2 P2：Markdown 大纲导出——已完成（07 §21 全清单，PRD B5）：导图第三种导出格式 type=MD，与 OPML 同棵 parentId 派生树，输出 ATX H1 标题 + 嵌套无序列表（2 空格/层）+ note 作 blockquote 子行 + tags 以 # 前缀内联（自由连线忽略）；抽取 buildChildren/resolveRoot 供 OPML/MD 共享；前端工具栏「导出 MD」按钮复用 downloadTextFile；scripts/mindmap-export.mjs 增 parseMarkdownOutline 还原层级/文本/备注/标签；非 06 会话导出协议（同 OPML，无需升 version，落 04 §6.7）；后端 252 → 254（+MindmapExportServiceTest 2）、脚本 41 → 43（+parseMarkdownOutline 2）、前端 251、tsc 通过、SMOKE 17 段 ALL PASS（导出段增 MD 往返，原 type=MD 非法断言改 DOC）；过程记录见产品工作区「TrailMind 开发」，会话「v1.2 P2 Markdown 大纲导出」

- [x] v1.2 P2：多标签批量合并——已完成（07 §22 全清单，PRD D3）：选 N 个标签→合并到一个目标（条目重挂目标、源删除）；后端 TagService.mergeBatch 循环 merge（跳过 target、事务回滚）+ POST /tags/batch-merge；前端 BatchSelectToolbar 增可选 onMerge（≥2 选中可用）、TagSection 增目标选择器 + batchMergeConfirmText 二次确认（复用 §18 useBatchSelect）；与单合并、§18 批量删除对称配套；后端 254 → 258（+TagServiceTest 4）、前端 251 → 253（+TagSection 1 + batchSelection 1）、脚本 43、tsc 通过、SMOKE 17 段 ALL PASS（标签段增批量合并子块）；过程记录见产品工作区「TrailMind 开发」，会话「v1.2 P2 多标签批量合并」

- [x] v1.2 P2：自定义快捷键——已完成（07 §23 全清单，PRD §5 P2）：设置页「快捷键」节列 03 §5 落地 10 项，点击修改捕获键位 + 冲突检测 + 持久化 setting 表 `keymap` diff JSON（空白=重置默认）；3 处 handler（App/MindMapEditor/SessionView）改读 keymap（默认=03 §5 不变，Ctrl+Y 保留重做别名）；后端 SettingsService/Controller 增 keymap 字段（GET/PUT，PATCH 语义）；前端 utils/keymap.ts 纯函数（DEFAULT_KEYMAP/parse/serialize/format/comboFromEvent/matchesCombo/findConflict）+ useKeymap hook + useSettingsStore.setKeymap + SettingsPanel 快捷键节（capture 拦全局 handler/冲突拒绝/Esc 取消/单项与全部恢复默认）；Enter 提交与 Ctrl+W 关闭视图暂不纳入可定制集；后端 258 → 262（+SettingsServiceTest 4）、前端 253 → 265（+keymap 9 + SettingsPanel 3）、脚本 43、tsc 通过、SMOKE 17 段 ALL PASS（设置段增 keymap 往返子块）；过程记录见产品工作区「TrailMind 开发」，会话「v1.2 P2 自定义快捷键」

- [x] 前端美化：悬浮岛式侧边栏——已完成（07 §24，用户即时美化需求，非 PRD §5 项）：悬浮岛式可隐藏双列壳层（顶栏 + 可隐藏 sidebar island + main island，`--shadow` 浮岛投影，原 640px 居中单列废弃）；`features/sidebar/Sidebar.tsx`（新）多级树（工作区作父节点→导图/会话[时间轴+状态点]/标签三组）；提取 `MindmapListSection`（镜像 SessionSection）；`utils/toast.ts`+`utils/undoDelete.ts`+`components/Toaster.tsx` 撤销 toast（乐观移除→撤销→到期真删，失败回退）；侧边栏单条删除接 undo-toast（工作区/导图/会话/标签），批量保留二次确认；App.tsx 右侧视图机 overview/导图(内联右侧，去 `position:fixed` 全屏、由 `.main-content.editor-mode` 满高 flex 承载、侧边栏常驻)/会话卡片标签/标签云 + workspace undo pending 过滤；侧边栏宽度可拖拽（`sidebar-resizer`，220–560，localStorage 持久化，拖拽期禁用过渡、mouseup 派发 resize 触发导图自适应）；`test/setup.ts` 增 ResizeObserver 桩（jsdom 无此 API、React Flow 测量依赖）；保留搜索/联动/标签聚焦/多会话/keymap 全部导航；前端 265 → 281（+toast 11 + App undo 2 + 内联导图/拖拽宽度/隐藏手柄 3）、tsc 通过、后端 262 不变（零后端改动）。注：导图内联与可拖拽宽度为用户反馈增补；「删除未现撤销 toast/二次确认」根因为运行了 §24 之前 stale `frontend/dist`（dist gitignore 不入库、Electron 加载本地构建产物），源码本身正确（`deleteWithUndo`+`Toaster`+批量 `confirm()` 已接线且有单测），重建 dist 后即恢复；过程记录见产品工作区「TrailMind 开发」，会话「前端美化：悬浮岛式侧边栏」

- _注：以下 P2 项**暂不实现**，列入待排期：AI 会话自动摘要（方案已定，[09 §3](docs/09-风险清单与开放问题.md)：自带 Key 外部 API 为主 + 规则模板兜底，本地大模型预留 provider 接口）、每周复盘报告、会话模板、工作区模板、主题定制（基础 light/dark/system 主题已随 M4 任务四落地，此项指进阶自定义）。_

下一任务：**v1.2 P2 可落地项已全部完成**（导入恢复 §20、Markdown 大纲导出 §21、多标签批量合并 §22、自定义快捷键 §23）+ **前端美化 §24 已完成**（悬浮岛式侧边栏 + 导图内联右侧 + 侧边栏可拖拽宽度 + 撤销 toast）。**剩余仅为暂缓项**：AI 会话自动摘要（方案见 09 §3）、每周复盘报告、会话/工作区模板、主题定制（基础主题已随 M4 任务四落地，此项指进阶自定义）；条件项：节点表化改造（搜索/引用成瓶颈时，05 §6）。见 09 §3 与 07 §8 Backlog P2 行。

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
| docs/11 | 维护与交接手册（架构/维护/版本号/发布更新/代码索引/FAQ，接手必读） |
| docs/12 | Agent 启动提示词手册（人类如何启动 agent 改进维护本产品） |
