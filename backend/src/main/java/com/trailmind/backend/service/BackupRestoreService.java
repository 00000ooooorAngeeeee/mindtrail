package com.trailmind.backend.service;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.trailmind.backend.common.BadRequestException;
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
import org.springframework.transaction.annotation.Transactional;

import java.util.Base64;
import java.util.List;

/**
 * 全量备份导入恢复（v1.2 P2，PRD E5「导入恢复」/ 04 §5 POST /backup/import / 05 §8）：
 * 接收 {@code POST /backup/export} 的同款 zip（Base64），解析校验 format/version 后，
 * 在单事务内 DELETE 全部 9 张表再按原 id 逐行回填（保留主键以保证 workspace_id/session_id/entry_id/
 * mindmap_id 等引用与 content_json 节点 id、entry_commit/node_entry 关联一致），事务保证全量替换原子性。
 *
 * <p>恢复语义为「全量替换」：当前库被备份内容整体覆盖（非合并）。调用方须二次确认。
 * 校验失败（非法 zip / JSON / 格式 / 版本）抛 {@link BadRequestException}（→ 400），不触碰任何数据。
 */
@Service
public class BackupRestoreService {

    private final WorkspaceMapper workspaceMapper;
    private final MindmapMapper mindmapMapper;
    private final SessionMapper sessionMapper;
    private final EntryMapper entryMapper;
    private final TagMapper tagMapper;
    private final EntryTagMapper entryTagMapper;
    private final EntryCommitMapper entryCommitMapper;
    private final NodeEntryMapper nodeEntryMapper;
    private final SettingMapper settingMapper;

    public BackupRestoreService(WorkspaceMapper workspaceMapper, MindmapMapper mindmapMapper,
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

    /** 导入恢复产物：各表回填行数 + 总计 + 备份导出时间（供前端展示与日志取证）。 */
    public record RestoreSummary(
            long workspace, long mindmap, long session, long entry, long tag,
            long entryTag, long entryCommit, long nodeEntry, long setting,
            long total, String exportedAt) {
    }

    /**
     * 全量恢复：解 zip → 校验 format/version → 单事务 DELETE 9 表 + 按原 id 回填 → 返回摘要。
     * 校验失败抛 400（BadRequestException），不写库；写入失败事务回滚（DELETE 一并回滚，库不变）。
     */
    @Transactional
    public RestoreSummary restore(String base64Content) {
        if (base64Content == null || base64Content.isBlank()) {
            throw new BadRequestException("备份内容为空");
        }
        byte[] zip;
        try {
            zip = Base64.getDecoder().decode(base64Content);
        } catch (IllegalArgumentException e) {
            throw new BadRequestException("备份内容非合法 Base64", e);
        }
        String json;
        try {
            json = BackupExportService.unzipJson(zip);
        } catch (java.io.IOException e) {
            throw new BadRequestException("备份文件损坏或非 zip：" + e.getMessage(), e);
        }
        BackupExportService.BackupDocument doc;
        try {
            doc = BackupExportService.parseDocument(json);
        } catch (JsonProcessingException e) {
            throw new BadRequestException("备份 JSON 解析失败：" + e.getMessage(), e);
        }
        if (doc == null || !BackupExportService.BACKUP_FORMAT.equals(doc.format())) {
            throw new BadRequestException("备份格式不匹配：期望 " + BackupExportService.BACKUP_FORMAT
                    + "，实际 " + (doc == null ? "null" : doc.format()));
        }
        if (doc.version() != BackupExportService.BACKUP_VERSION) {
            throw new BadRequestException("备份版本不支持：期望 v" + BackupExportService.BACKUP_VERSION
                    + "，实际 v" + doc.version());
        }

        BackupExportService.BackupTables tables = doc.tables();
        List<Workspace> ws = orEmpty(tables == null ? null : tables.workspace());
        List<Mindmap> mm = orEmpty(tables == null ? null : tables.mindmap());
        List<Session> ss = orEmpty(tables == null ? null : tables.session());
        List<Entry> es = orEmpty(tables == null ? null : tables.entry());
        List<Tag> ts = orEmpty(tables == null ? null : tables.tag());
        List<EntryTag> ets = orEmpty(tables == null ? null : tables.entryTag());
        List<EntryCommit> ecs = orEmpty(tables == null ? null : tables.entryCommit());
        List<NodeEntry> nes = orEmpty(tables == null ? null : tables.nodeEntry());
        List<Setting> sts = orEmpty(tables == null ? null : tables.setting());

        // 1. 清空：逆依赖序（关联表先于主表）。DML DELETE，事务内可回滚；InnoDB 显式 id 回填后会自动推进自增计数。
        nodeEntryMapper.deleteAll();
        entryCommitMapper.deleteAll();
        entryTagMapper.deleteAll();
        entryMapper.deleteAll();
        tagMapper.deleteAll();
        sessionMapper.deleteAll();
        mindmapMapper.deleteAll();
        workspaceMapper.deleteAll();
        settingMapper.deleteAll();

        // 2. 回填：依赖序（主表先于关联表），保留原 id（IdType.AUTO 实体 id 非空则 insert 写入该 id）。
        ws.forEach(workspaceMapper::insert);
        mm.forEach(mindmapMapper::insert);
        ss.forEach(sessionMapper::insert);
        ts.forEach(tagMapper::insert);
        es.forEach(entryMapper::insert);
        ets.forEach(entryTagMapper::insert);
        ecs.forEach(entryCommitMapper::insert);
        nes.forEach(nodeEntryMapper::insert);
        sts.forEach(settingMapper::insert);

        long total = ws.size() + mm.size() + ss.size() + es.size() + ts.size()
                + ets.size() + ecs.size() + nes.size() + sts.size();
        return new RestoreSummary(
                ws.size(), mm.size(), ss.size(), es.size(), ts.size(),
                ets.size(), ecs.size(), nes.size(), sts.size(),
                total, doc.exportedAt());
    }

    private static <T> List<T> orEmpty(List<T> list) {
        return list == null ? List.of() : list;
    }
}
