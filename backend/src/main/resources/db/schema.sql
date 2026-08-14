-- 思迹 TrailMind 数据库 schema（幂等，可重复执行）
-- 字符集统一 utf8mb4，排序规则 utf8mb4_unicode_ci（依赖库级默认，建库见 application.yml createDatabaseIfNotExist）

CREATE TABLE IF NOT EXISTS workspace (
  id          BIGINT       NOT NULL AUTO_INCREMENT,
  name        VARCHAR(100) NOT NULL COMMENT '工作区名称',
  description TEXT         NULL COMMENT '描述',
  repo_path   VARCHAR(500) NULL COMMENT '关联 Git 仓库绝对路径（可选）',
  created_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_workspace_updated (updated_at)
) ENGINE=InnoDB COMMENT='工作区（=一个项目）';

CREATE TABLE IF NOT EXISTS mindmap (
  id           BIGINT       NOT NULL AUTO_INCREMENT,
  workspace_id BIGINT       NOT NULL,
  name         VARCHAR(100) NOT NULL COMMENT '导图名称',
  content_json JSON         NOT NULL COMMENT '整图数据，结构见 docs/05 §4',
  search_text  VARCHAR(8000) NOT NULL DEFAULT '' COMMENT '冗余文本：所有节点文本+标签+名称，供全文搜索',
  node_count   INT          NOT NULL DEFAULT 0 COMMENT '节点数（冗余统计）',
  created_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_mindmap_workspace (workspace_id),
  FULLTEXT KEY ft_mindmap_search (search_text) WITH PARSER ngram
) ENGINE=InnoDB COMMENT='思维导图（整图 JSON 存储）';

CREATE TABLE IF NOT EXISTS session (
  id           BIGINT       NOT NULL AUTO_INCREMENT,
  workspace_id BIGINT       NOT NULL,
  title        VARCHAR(200) NOT NULL COMMENT '会话标题',
  status       ENUM('active','completed') NOT NULL DEFAULT 'active',
  repo_path    VARCHAR(500) NULL COMMENT '会话级 Git 仓库路径，覆盖工作区设置',
  start_head   CHAR(40)     NULL COMMENT '会话开始时仓库 HEAD（用于提交感知）',
  end_head     CHAR(40)     NULL COMMENT '会话结束时 HEAD',
  summary      TEXT         NULL COMMENT '结束总结（渲染为 review 条目）',
  started_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ended_at     DATETIME     NULL,
  created_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_session_workspace (workspace_id),
  KEY idx_session_status (status)
) ENGINE=InnoDB COMMENT='vibecoding 记录会话';

CREATE TABLE IF NOT EXISTS entry (
  id         BIGINT       NOT NULL AUTO_INCREMENT,
  session_id BIGINT       NOT NULL,
  seq        INT          NOT NULL COMMENT '会话内序号（时间线顺序），从 1 递增',
  type       VARCHAR(20)  NOT NULL COMMENT 'goal|context|prompt|action|artifact|decision|error|test|review|next|note',
  content_md TEXT         NOT NULL COMMENT 'Markdown 正文',
  created_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '记录创建时间（可手动补记）',
  updated_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_entry_session_seq (session_id, seq),
  FULLTEXT KEY ft_entry_content (content_md) WITH PARSER ngram
) ENGINE=InnoDB COMMENT='时间线条目';

CREATE TABLE IF NOT EXISTS tag (
  id           BIGINT      NOT NULL AUTO_INCREMENT,
  workspace_id BIGINT      NOT NULL,
  name         VARCHAR(50) NOT NULL,
  created_at   DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_tag_workspace_name (workspace_id, name)
) ENGINE=InnoDB COMMENT='标签（工作区级）';

CREATE TABLE IF NOT EXISTS entry_tag (
  entry_id BIGINT NOT NULL,
  tag_id   BIGINT NOT NULL,
  PRIMARY KEY (entry_id, tag_id)
) ENGINE=InnoDB COMMENT='条目-标签多对多';

CREATE TABLE IF NOT EXISTS entry_commit (
  entry_id   BIGINT       NOT NULL,
  commit_hash CHAR(40)    NOT NULL COMMENT 'Git commit 完整 hash',
  repo_path  VARCHAR(500) NOT NULL COMMENT '提交来源仓库（多仓库备用）',
  bound_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (entry_id, commit_hash),
  KEY idx_commit_repo (repo_path, commit_hash)
) ENGINE=InnoDB COMMENT='条目-Git 提交绑定';

CREATE TABLE IF NOT EXISTS setting (
  k          VARCHAR(100) NOT NULL,
  v          TEXT         NOT NULL,
  updated_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (k)
) ENGINE=InnoDB COMMENT='应用设置';
