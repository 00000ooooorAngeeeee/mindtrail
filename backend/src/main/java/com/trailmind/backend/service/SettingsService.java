package com.trailmind.backend.service;

import com.trailmind.backend.common.BadRequestException;
import com.trailmind.backend.entity.Setting;
import com.trailmind.backend.repository.SettingMapper;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.net.URI;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;

/**
 * 应用设置服务（M4 任务四，04 §5 GET/PUT /settings）：
 * 主题（light|dark|system，默认 system）、默认 Git 仓库路径（会话创建回退链末端：会话 → 工作区 → 全局默认）、
 * 数据库连接信息展示（只读：host/port/库名/用户名/密码是否已配置，密码本身不回传）。
 * 设置持久化于 setting 表（04 §6.6）；仓库路径校验与工作区一致（须存在 .git 目录）。
 */
@Service
public class SettingsService {

    public static final String KEY_THEME = "theme";
    public static final String KEY_DEFAULT_REPO_PATH = "default_repo_path";
    public static final String DEFAULT_THEME = "system";
    public static final List<String> THEMES = List.of("light", "dark", "system");

    private final SettingMapper mapper;
    private final String jdbcUrl;
    private final String dbUsername;
    private final String dbPassword;

    public SettingsService(SettingMapper mapper,
                           @Value("${spring.datasource.url}") String jdbcUrl,
                           @Value("${spring.datasource.username}") String dbUsername,
                           @Value("${spring.datasource.password:}") String dbPassword) {
        this.mapper = mapper;
        this.jdbcUrl = jdbcUrl;
        this.dbUsername = dbUsername;
        this.dbPassword = dbPassword;
    }

    /** 完整设置视图：主题 + 默认仓库路径 + 数据库连接信息（密码只给「是否已配置」）。 */
    public SettingsView get() {
        return new SettingsView(normalizedTheme(mapper.selectByKey(KEY_THEME)), getDefaultRepoPath(), databaseInfo());
    }

    /** 更新设置（PATCH 语义：null 字段不改动；defaultRepoPath 传空白字符串表示清除）。 */
    @Transactional
    public SettingsView update(String theme, String defaultRepoPath) {
        if (theme != null) {
            String t = theme.trim();
            if (!THEMES.contains(t)) {
                throw new BadRequestException("主题仅支持 light/dark/system");
            }
            mapper.upsert(KEY_THEME, t);
        }
        if (defaultRepoPath != null) {
            String p = defaultRepoPath.trim();
            if (p.isEmpty()) {
                mapper.deleteByKey(KEY_DEFAULT_REPO_PATH);
            } else {
                if (!Files.isDirectory(Path.of(p, ".git"))) {
                    throw new BadRequestException("仓库路径无效：未找到 .git 目录");
                }
                mapper.upsert(KEY_DEFAULT_REPO_PATH, p);
            }
        }
        return get();
    }

    /** 默认仓库路径（未设置返回 null），供 SessionService 会话创建回退链使用。 */
    public String getDefaultRepoPath() {
        Setting s = mapper.selectByKey(KEY_DEFAULT_REPO_PATH);
        if (s == null || s.getV() == null || s.getV().isBlank()) {
            return null;
        }
        return s.getV().trim();
    }

    /** 存量脏值（手工改库/历史版本）读到无效主题时回落默认值，保证前端总有合法主题。 */
    private String normalizedTheme(Setting s) {
        String v = s == null ? null : s.getV();
        return (v != null && THEMES.contains(v)) ? v : DEFAULT_THEME;
    }

    private DatabaseInfo databaseInfo() {
        return DatabaseInfo.parse(jdbcUrl, dbUsername, dbPassword);
    }

    /** 设置视图（04 §5 GET /settings 响应体）。 */
    public record SettingsView(String theme, String defaultRepoPath, DatabaseInfo database) {
    }

    /**
     * 数据库连接信息（仅展示用）。parse 为纯函数（单测覆盖）：解析 jdbc:mysql://host:port/db 形态，
     * 端口缺省 3306；解析失败返回空字段而非抛错（展示层防御）。
     */
    public record DatabaseInfo(String host, int port, String database, String username, boolean passwordConfigured) {

        public static DatabaseInfo parse(String jdbcUrl, String username, String password) {
            String host = "";
            int port = 3306;
            String database = "";
            if (jdbcUrl != null && jdbcUrl.startsWith("jdbc:")) {
                try {
                    URI uri = URI.create(jdbcUrl.substring("jdbc:".length()));
                    host = uri.getHost() == null ? "" : uri.getHost();
                    port = uri.getPort() > 0 ? uri.getPort() : 3306;
                    String path = uri.getPath();
                    database = path == null ? "" : path.replaceFirst("^/", "");
                } catch (IllegalArgumentException ignored) {
                    // 非法 URL：保留空字段（防御性展示）
                }
            }
            return new DatabaseInfo(host, port, database, username == null ? "" : username,
                    password != null && !password.isBlank());
        }
    }
}
