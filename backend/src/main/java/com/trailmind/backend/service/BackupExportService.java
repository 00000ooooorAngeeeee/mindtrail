package com.trailmind.backend.service;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.SerializationFeature;
import com.fasterxml.jackson.datatype.jsr310.JavaTimeModule;
import com.fasterxml.jackson.datatype.jsr310.ser.LocalDateTimeSerializer;
import com.trailmind.backend.entity.Entry;
import com.trailmind.backend.entity.EntryCommit;
import com.trailmind.backend.entity.EntryTag;
import com.trailmind.backend.entity.Mindmap;
import com.trailmind.backend.entity.NodeEntry;
import com.trailmind.backend.entity.Session;
import com.trailmind.backend.entity.Setting;
import com.trailmind.backend.entity.Tag;
import com.trailmind.backend.entity.Workspace;
import com.trailmind.backend.repository.EntryCommitMapper;
import com.trailmind.backend.repository.EntryMapper;
import com.trailmind.backend.repository.EntryTagMapper;
import com.trailmind.backend.repository.MindmapMapper;
import com.trailmind.backend.repository.NodeEntryMapper;
import com.trailmind.backend.repository.SessionMapper;
import com.trailmind.backend.repository.SettingMapper;
import com.trailmind.backend.repository.TagMapper;
import com.trailmind.backend.repository.WorkspaceMapper;
import org.springframework.stereotype.Service;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import java.util.Base64;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.zip.ZipEntry;
import java.util.zip.ZipOutputStream;

/**
 * 全量备份导出（M4 任务六，PRD E5 / 04 §5「POST /backup/export」/ 05 §8；v1.1 起含 node_entry 共 9 张表）：
 * workspace/mindmap/session/entry/tag/entry_tag/entry_commit/node_entry/setting 导出为
 * 「trailmind-backup」v1 JSON，压缩为 zip（JDK 内置 ZipOutputStream，零依赖）后 Base64 返回。
 * 格式与 06 §4A 会话 JSON 同风格：format/version 标识 + 时间固定到秒的 ISO-8601，供 P2 导入恢复。
 */
@Service
public class BackupExportService {

    /** 备份格式标识（机器可读协议，P2 导入恢复依赖）。 */
    public static final String BACKUP_FORMAT = "trailmind-backup";

    /** 备份协议版本。 */
    public static final int BACKUP_VERSION = 1;

    /** zip 内 JSON 文件名（固定，便于解析与导入）。 */
    public static final String BACKUP_JSON_ENTRY = "trailmind-backup.json";

    /** 时间固定到秒（06 §4A：LocalDateTime.toString 秒为 0 时会省略，机器协议需形态稳定）。 */
    private static final DateTimeFormatter ISO_SECONDS = DateTimeFormatter.ofPattern("yyyy-MM-dd'T'HH:mm:ss");

    /** 备份专用 ObjectMapper：LocalDateTime 固定到秒 + 省略 null 字段（实体中非表字段不会污染协议）。 */
    private static final ObjectMapper MAPPER = createMapper();

    private final WorkspaceMapper workspaceMapper;
    private final MindmapMapper mindmapMapper;
    private final SessionMapper sessionMapper;
    private final EntryMapper entryMapper;
    private final TagMapper tagMapper;
    private final EntryTagMapper entryTagMapper;
    private final EntryCommitMapper entryCommitMapper;
    private final NodeEntryMapper nodeEntryMapper;
    private final SettingMapper settingMapper;

    public BackupExportService(WorkspaceMapper workspaceMapper, MindmapMapper mindmapMapper,
                               SessionMapper sessionMapper, EntryMapper entryMapper, TagMapper tagMapper,
                               EntryTagMapper entryTagMapper, EntryCommitMapper entryCommitMapper,
                               NodeEntryMapper nodeEntryMapper, SettingMapper settingMapper) {
        this.workspaceMapper = workspaceMapper;
        this.mindmapMapper = mindmapMapper;
        this.sessionMapper = sessionMapper;
        this.entryMapper = entryMapper;
        this.tagMapper = tagMapper;
        this.entryTagMapper = entryTagMapper;
        this.entryCommitMapper = entryCommitMapper;
        this.nodeEntryMapper = nodeEntryMapper;
        this.settingMapper = settingMapper;
    }

    /** 导出产物：文件名（带时间戳）、MIME 类型、内容（Base64 zip）。 */
    public record ExportFile(String filename, String contentType, String content) {
    }

    /** 备份表数据（与 schema.sql 9 张表一一对应，key 为表名；v1.1 起含 node_entry）。 */
    public record BackupTables(
            List<Workspace> workspace,
            List<Mindmap> mindmap,
            List<Session> session,
            List<Entry> entry,
            List<Tag> tag,
            @com.fasterxml.jackson.annotation.JsonProperty("entry_tag") List<EntryTag> entryTag,
            @com.fasterxml.jackson.annotation.JsonProperty("entry_commit") List<EntryCommit> entryCommit,
            @com.fasterxml.jackson.annotation.JsonProperty("node_entry") List<NodeEntry> nodeEntry,
            List<Setting> setting) {
    }

    /** 备份协议载体：format/version/exportedAt/表数据。 */
    public record BackupDocument(String format, int version, String exportedAt, BackupTables tables) {
    }

    /** 全量备份：读全表 → 组装协议 JSON → zip 压缩 → Base64。 */
    public ExportFile export() {
        BackupDocument doc = new BackupDocument(
                BACKUP_FORMAT,
                BACKUP_VERSION,
                LocalDateTime.now().format(ISO_SECONDS),
                new BackupTables(
                        workspaceMapper.selectList(null),
                        mindmapMapper.selectList(null),
                        sessionMapper.selectList(null),
                        entryMapper.selectList(null),
                        tagMapper.selectList(null),
                        entryTagMapper.selectList(null),
                        entryCommitMapper.selectList(null),
                        nodeEntryMapper.selectList(null),
                        settingMapper.selectList(null)));
        try {
            byte[] json = MAPPER.writeValueAsBytes(doc);
            byte[] zip = zip(json);
            String filename = "trailmind-backup-" + LocalDateTime.now().format(DateTimeFormatter.ofPattern("yyyyMMdd-HHmmss")) + ".zip";
            return new ExportFile(filename, "application/zip", Base64.getEncoder().encodeToString(zip));
        } catch (JsonProcessingException e) {
            throw new IllegalStateException("备份 JSON 序列化失败", e);
        }
    }

    /** 单 JSON 压缩为 zip（stored 条目，文件名固定 BACKUP_JSON_ENTRY）。 */
    static byte[] zip(byte[] json) {
        try (ByteArrayOutputStream bos = new ByteArrayOutputStream();
             ZipOutputStream zos = new ZipOutputStream(bos)) {
            ZipEntry entry = new ZipEntry(BACKUP_JSON_ENTRY);
            zos.putNextEntry(entry);
            zos.write(json);
            zos.closeEntry();
            zos.finish();
            return bos.toByteArray();
        } catch (IOException e) {
            throw new IllegalStateException("备份 zip 压缩失败", e);
        }
    }

    private static ObjectMapper createMapper() {
        JavaTimeModule module = new JavaTimeModule();
        module.addSerializer(LocalDateTime.class, new LocalDateTimeSerializer(ISO_SECONDS));
        return new ObjectMapper()
                .registerModule(module)
                .setSerializationInclusion(com.fasterxml.jackson.annotation.JsonInclude.Include.NON_NULL)
                .disable(SerializationFeature.WRITE_DATES_AS_TIMESTAMPS);
    }

    /** 供测试解压备份 zip 的辅助：返回内部 JSON 原文（无第三方依赖，ZipInputStream 读单条目）。 */
    static String unzipJson(byte[] zip) throws IOException {
        try (java.util.zip.ZipInputStream zis = new java.util.zip.ZipInputStream(new java.io.ByteArrayInputStream(zip))) {
            ZipEntry e = zis.getNextEntry();
            if (e == null) {
                throw new IOException("备份 zip 为空");
            }
            if (!BACKUP_JSON_ENTRY.equals(e.getName())) {
                throw new IOException("备份 zip 条目名异常：" + e.getName());
            }
            return new String(zis.readAllBytes(), java.nio.charset.StandardCharsets.UTF_8);
        }
    }

    /** 备份解析结果（供测试断言格式与表数据）。 */
    static Map<String, Object> parseBackup(String json) throws JsonProcessingException {
        Map<String, Object> root = MAPPER.readValue(json, Map.class);
        return root;
    }
}
