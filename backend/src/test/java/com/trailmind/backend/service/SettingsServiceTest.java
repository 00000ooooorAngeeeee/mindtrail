package com.trailmind.backend.service;

import com.trailmind.backend.common.BadRequestException;
import com.trailmind.backend.entity.Setting;
import com.trailmind.backend.repository.SettingMapper;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.junit.jupiter.api.io.TempDir;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.nio.file.Files;
import java.nio.file.Path;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * 设置服务单测（M4 任务四，08 §6「关键逻辑补单测」）：
 * 主题默认/脏值归一化、主题更新校验、默认仓库路径校验（.git 必须存在）/清除/回读、
 * 数据库连接信息解析（纯函数：带参 URL、缺省端口、非法 URL 防御）。
 */
@ExtendWith(MockitoExtension.class)
class SettingsServiceTest {

    @Mock
    private SettingMapper mapper;

    @InjectMocks
    private SettingsService service;

    private static final String JDBC_URL =
            "jdbc:mysql://127.0.0.1:3306/trailmind?createDatabaseIfNotExist=true&serverTimezone=Asia/Shanghai";

    private Setting setting(String k, String v) {
        Setting s = new Setting();
        s.setK(k);
        s.setV(v);
        return s;
    }

    // ---- 主题 ----

    @Test
    void get_without_stored_theme_defaults_to_system() {
        when(mapper.selectByKey(SettingsService.KEY_THEME)).thenReturn(null);
        when(mapper.selectByKey(SettingsService.KEY_DEFAULT_REPO_PATH)).thenReturn(null);

        assertEquals("system", service.get().theme());
    }

    @Test
    void get_normalizes_unknown_stored_theme_to_system() {
        when(mapper.selectByKey(SettingsService.KEY_THEME)).thenReturn(setting("theme", "blue"));
        when(mapper.selectByKey(SettingsService.KEY_DEFAULT_REPO_PATH)).thenReturn(null);

        assertEquals("system", service.get().theme());
    }

    @Test
    void update_theme_persists_and_returns_view() {
        when(mapper.selectByKey(SettingsService.KEY_THEME)).thenReturn(setting("theme", "dark"));
        when(mapper.selectByKey(SettingsService.KEY_DEFAULT_REPO_PATH)).thenReturn(null);

        SettingsService.SettingsView view = service.update("dark", null);

        verify(mapper).upsert(SettingsService.KEY_THEME, "dark");
        assertEquals("dark", view.theme());
    }

    @Test
    void update_invalid_theme_throws_400_and_does_not_persist() {
        assertThrows(BadRequestException.class, () -> service.update("blue", null));
        assertThrows(BadRequestException.class, () -> service.update("", null));
        verify(mapper, never()).upsert(anyString(), anyString());
    }

    @Test
    void update_null_theme_keeps_unchanged() {
        when(mapper.selectByKey(SettingsService.KEY_THEME)).thenReturn(setting("theme", "light"));
        when(mapper.selectByKey(SettingsService.KEY_DEFAULT_REPO_PATH)).thenReturn(null);

        SettingsService.SettingsView view = service.update(null, null);

        verify(mapper, never()).upsert(anyString(), anyString());
        assertEquals("light", view.theme());
    }

    // ---- 默认仓库路径 ----

    @Test
    void update_default_repo_path_without_git_dir_throws_400() {
        Path notARepo = Path.of("C:/__trailmind_missing_dir__");
        assertThrows(BadRequestException.class, () -> service.update(null, notARepo.toString()));
        verify(mapper, never()).upsert(anyString(), anyString());
    }

    @Test
    void update_default_repo_path_blank_clears_setting(@TempDir Path dir) {
        when(mapper.selectByKey(SettingsService.KEY_THEME)).thenReturn(null);
        when(mapper.selectByKey(SettingsService.KEY_DEFAULT_REPO_PATH)).thenReturn(null);

        service.update(null, "   ");

        verify(mapper).deleteByKey(SettingsService.KEY_DEFAULT_REPO_PATH);
    }

    @Test
    void update_default_repo_path_with_git_dir_persists(@TempDir Path dir) throws Exception {
        Files.createDirectories(dir.resolve(".git"));
        when(mapper.selectByKey(SettingsService.KEY_THEME)).thenReturn(null);
        when(mapper.selectByKey(SettingsService.KEY_DEFAULT_REPO_PATH))
                .thenReturn(setting("default_repo_path", dir.toString()));

        SettingsService.SettingsView view = service.update(null, dir.toString());

        verify(mapper).upsert(SettingsService.KEY_DEFAULT_REPO_PATH, dir.toString());
        assertEquals(dir.toString(), view.defaultRepoPath());
    }

    @Test
    void getDefaultRepoPath_returns_null_when_unset_or_blank() {
        when(mapper.selectByKey(SettingsService.KEY_DEFAULT_REPO_PATH)).thenReturn(null);
        assertNull(service.getDefaultRepoPath());

        when(mapper.selectByKey(SettingsService.KEY_DEFAULT_REPO_PATH)).thenReturn(setting("default_repo_path", "  "));
        assertNull(service.getDefaultRepoPath());
    }

    @Test
    void getDefaultRepoPath_trims_stored_value() {
        when(mapper.selectByKey(SettingsService.KEY_DEFAULT_REPO_PATH))
                .thenReturn(setting("default_repo_path", "  D:/repo  "));

        assertEquals("D:/repo", service.getDefaultRepoPath());
    }

    // ---- 数据库连接信息解析（纯函数） ----

    @Test
    void parse_jdbc_url_extracts_host_port_database_and_credentials() {
        SettingsService.DatabaseInfo info = SettingsService.DatabaseInfo.parse(JDBC_URL, "root", "secret");

        assertEquals("127.0.0.1", info.host());
        assertEquals(3306, info.port());
        assertEquals("trailmind", info.database());
        assertEquals("root", info.username());
        assertTrue(info.passwordConfigured());
    }

    @Test
    void parse_missing_port_defaults_to_3306() {
        SettingsService.DatabaseInfo info =
                SettingsService.DatabaseInfo.parse("jdbc:mysql://db.local/trailmind", "root", "");

        assertEquals("db.local", info.host());
        assertEquals(3306, info.port());
        assertEquals("trailmind", info.database());
        assertFalse(info.passwordConfigured());
    }

    @Test
    void parse_empty_or_null_password_reports_not_configured() {
        SettingsService.DatabaseInfo blank =
                SettingsService.DatabaseInfo.parse(JDBC_URL, "root", "  ");
        SettingsService.DatabaseInfo missing =
                SettingsService.DatabaseInfo.parse(JDBC_URL, "root", null);

        assertFalse(blank.passwordConfigured());
        assertFalse(missing.passwordConfigured());
    }

    @Test
    void parse_invalid_or_null_url_degrades_to_empty_fields() {
        SettingsService.DatabaseInfo bad = SettingsService.DatabaseInfo.parse("jdbc:://///", "root", "x");
        SettingsService.DatabaseInfo none = SettingsService.DatabaseInfo.parse(null, null, null);

        assertEquals("", bad.host());
        assertEquals("", none.host());
        assertEquals("", none.username());
        assertFalse(none.passwordConfigured());
    }
}
