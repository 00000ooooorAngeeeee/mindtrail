package com.trailmind.backend.service;

import com.trailmind.backend.common.NotFoundException;
import com.trailmind.backend.entity.Entry;
import com.trailmind.backend.entity.Session;
import com.trailmind.backend.entity.Workspace;
import com.trailmind.backend.repository.SessionMapper;
import com.trailmind.backend.repository.WorkspaceMapper;
import org.springframework.stereotype.Service;

import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import java.util.List;
import java.util.Map;

/**
 * 会话导出 Markdown（严格按 docs/06 §4 协议，M3 任务四/总验收「导出→解析→比对」依赖）：
 * YAML frontmatter（format: trailmind-session、version、session.*、gitRange、entries）+ 条目按
 * 「## [type] HH:mm · 类型名」分隔，绑定提交写「&gt; git: `hash`」行、标签写「&gt; 标签：`a` `b`」行。
 * 约定：gitRange 用完整 40 位 hash（06 §4 示例为缩写示意；完整 hash 保证导出可还原且证据可验证，08 §10.6）。
 */
@Service
public class SessionExportService {

    /** 导出条目数上限（防御性，正常会话远小于此；05 §7 上限设计 10 万条目）。 */
    private static final int EXPORT_ENTRY_CAP = 100_000;

    /** 条目类型中文名（docs/06 §2 枚举，导出格式「类型名」列）。 */
    private static final Map<String, String> TYPE_LABELS = Map.ofEntries(
            Map.entry("goal", "目标"),
            Map.entry("context", "背景"),
            Map.entry("prompt", "指令"),
            Map.entry("action", "操作"),
            Map.entry("artifact", "产出"),
            Map.entry("decision", "决策"),
            Map.entry("error", "错误"),
            Map.entry("test", "验证"),
            Map.entry("review", "复盘"),
            Map.entry("next", "下一步"),
            Map.entry("note", "备注"));

    private static final DateTimeFormatter HM = DateTimeFormatter.ofPattern("HH:mm");

    private final SessionMapper sessionMapper;
    private final WorkspaceMapper workspaceMapper;
    private final EntryService entryService;

    public SessionExportService(SessionMapper sessionMapper, WorkspaceMapper workspaceMapper,
                                EntryService entryService) {
        this.sessionMapper = sessionMapper;
        this.workspaceMapper = workspaceMapper;
        this.entryService = entryService;
    }

    public String exportMarkdown(Long sessionId) {
        Session s = sessionMapper.selectById(sessionId);
        if (s == null) {
            throw new NotFoundException("会话不存在");
        }
        Workspace ws = workspaceMapper.selectById(s.getWorkspaceId());
        List<Entry> entries = entryService.page(sessionId, 1, EXPORT_ENTRY_CAP).entries();

        StringBuilder sb = new StringBuilder();
        sb.append("---\n");
        sb.append("format: trailmind-session\n");
        sb.append("version: 1\n");
        sb.append("session:\n");
        sb.append("  title: ").append(yamlValue(s.getTitle())).append('\n');
        sb.append("  status: ").append(s.getStatus()).append('\n');
        sb.append("  workspace: ").append(yamlValue(ws == null ? null : ws.getName())).append('\n');
        sb.append("  startedAt: ").append(yamlValue(fmt(s.getStartedAt()))).append('\n');
        sb.append("  endedAt: ").append(yamlValue(fmt(s.getEndedAt()))).append('\n');
        sb.append("  repoPath: ").append(yamlValue(s.getRepoPath())).append('\n');
        sb.append("  gitRange: [").append(hashOrNull(s.getStartHead())).append(", ")
                .append(hashOrNull(s.getEndHead())).append("]\n");
        sb.append("entries: ").append(entries.size()).append('\n');
        sb.append("---\n\n");

        sb.append("# 会话：").append(s.getTitle()).append("\n\n");
        for (Entry e : entries) {
            sb.append("## [").append(e.getType()).append("] ")
                    .append(fmtHm(e.getCreatedAt())).append(" · ")
                    .append(TYPE_LABELS.getOrDefault(e.getType(), e.getType())).append('\n');
            String content = e.getContentMd();
            sb.append(content);
            if (!content.endsWith("\n")) {
                sb.append('\n');
            }
            for (String hash : e.getCommits()) {
                sb.append("> git: `").append(hash).append("`\n");
            }
            if (!e.getTags().isEmpty()) {
                sb.append("> 标签：");
                for (String tag : e.getTags()) {
                    sb.append('`').append(tag).append("` ");
                }
                sb.setLength(sb.length() - 1); // 去掉末尾空格
                sb.append('\n');
            }
            sb.append('\n');
        }
        return sb.toString();
    }

    /** YAML 字符串值：加引号并转义；null 输出裸 null（与 06 §4 可选字段语义一致）。 */
    private String yamlValue(String v) {
        if (v == null) {
            return "null";
        }
        return '"' + v.replace("\\", "\\\\").replace("\"", "\\\"").replace("\n", "\\n") + '"';
    }

    private String fmt(LocalDateTime t) {
        return t == null ? null : t.toString();
    }

    private String fmtHm(LocalDateTime t) {
        return t == null ? "00:00" : t.format(HM);
    }

    private String hashOrNull(String hash) {
        return hash == null ? "null" : '"' + hash + '"';
    }
}
