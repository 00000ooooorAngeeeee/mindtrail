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

    /** JSON 导出时间：固定到秒（LocalDateTime.toString 会在秒为 0 时省略，机器协议需字段形态稳定）。 */
    private static final DateTimeFormatter ISO_SECONDS = DateTimeFormatter.ofPattern("yyyy-MM-dd'T'HH:mm:ss");

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
        Session s = requireSession(sessionId);
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

    /**
     * 导出会话为机器可读 JSON（M4 任务三，PRD C5）：格式标识 {@code trailmind-session-json}、version 1，
     * 含完整会话字段 + 全部条目（类型/正文/标签/绑定提交/ISO-8601 时间），可直接被外部工具按 06 §4 附录协议解析。
     * 与 Markdown 导出共用同一分页数据源，保证两种导出内容一致。
     */
    public SessionJsonExport exportJson(Long sessionId) {
        Session s = requireSession(sessionId);
        Workspace ws = workspaceMapper.selectById(s.getWorkspaceId());
        List<Entry> entries = entryService.page(sessionId, 1, EXPORT_ENTRY_CAP).entries();

        SessionJson sessionJson = new SessionJson(
                s.getId(),
                s.getTitle(),
                s.getStatus(),
                s.getWorkspaceId(),
                ws == null ? null : ws.getName(),
                s.getRepoPath(),
                s.getStartHead(),
                s.getEndHead(),
                s.getSummary(),
                fmtJson(s.getStartedAt()),
                fmtJson(s.getEndedAt()),
                fmtJson(s.getCreatedAt()),
                fmtJson(s.getUpdatedAt()));
        List<EntryJson> entryList = entries.stream()
                .map(e -> new EntryJson(
                        e.getId(),
                        e.getSessionId(),
                        e.getSeq(),
                        e.getType(),
                        e.getContentMd(),
                        e.getTags() == null ? List.of() : List.copyOf(e.getTags()),
                        e.getCommits() == null ? List.of() : List.copyOf(e.getCommits()),
                        fmtJson(e.getCreatedAt()),
                        fmtJson(e.getUpdatedAt())))
                .toList();
        return new SessionJsonExport("trailmind-session-json", 1, sessionJson, entryList, entryList.size());
    }

    /** 会话 JSON 导出协议（06 §4 附录）：format/version 为格式标识，条目数组与 Markdown 导出逐项对应。 */
    public record SessionJsonExport(String format, int version, SessionJson session,
                                    List<EntryJson> entries, int entryCount) {
    }

    /** 会话级字段；时间为 ISO-8601 本地时间字符串（08 §4.2），可选字段为 null。 */
    public record SessionJson(Long id, String title, String status, Long workspaceId, String workspace,
                              String repoPath, String startHead, String endHead, String summary,
                              String startedAt, String endedAt, String createdAt, String updatedAt) {
    }

    /** 条目级字段；tags/commits 永为数组（无则为空数组），与 06 §3 存储结构一致。 */
    public record EntryJson(Long id, Long sessionId, Integer seq, String type, String contentMd,
                            List<String> tags, List<String> commits, String createdAt, String updatedAt) {
    }

    private Session requireSession(Long sessionId) {
        Session s = sessionMapper.selectById(sessionId);
        if (s == null) {
            throw new NotFoundException("会话不存在");
        }
        return s;
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

    private String fmtJson(LocalDateTime t) {
        return t == null ? null : t.format(ISO_SECONDS);
    }

    private String fmtHm(LocalDateTime t) {
        return t == null ? "00:00" : t.format(HM);
    }

    private String hashOrNull(String hash) {
        return hash == null ? "null" : '"' + hash + '"';
    }
}
