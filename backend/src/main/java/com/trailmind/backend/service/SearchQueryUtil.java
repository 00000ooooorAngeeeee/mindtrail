package com.trailmind.backend.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.trailmind.backend.common.BadRequestException;

import java.util.ArrayList;
import java.util.Iterator;
import java.util.List;
import java.util.Locale;
import java.util.Map;

/**
 * 全局搜索纯函数工具（M4 任务一，04 §6.3 + 05 §5 + 09 风险表）：
 * 1. analyze：查询归一化。任一词长度 &lt; 2（中文单字 / 单字符——ngram_token_size=2 无法索引，实测
 *    NATURAL/BOOLEAN 模式均 0 命中）时整体降级 LIKE 兜底（09「中文 FULLTEXT 匹配不准 → 不满足则切换
 *    LIKE 方案」）；否则 FULLTEXT 布尔模式 +词1 +词2（AND 语义，规避自然语言模式 50% 常见词规则漏配）。
 * 2. escapeLike：转义 % _ \，防 LIKE 通配注入。
 * 3. snippet：首个命中词前后各 40 字符的纯文本片段（关键词高亮由前端做，后端只给片段，04 §6.3）。
 * 4. findMatchNodeId：从 content_json 定位首个含命中词的节点 id（D2 结果跳转定位用）。
 * 无 Spring 依赖，便于纯单测（08 §6「关键逻辑补单测」）。
 */
public final class SearchQueryUtil {

    /** 单次搜索关键词上限（防止超长查询与 LIKE 全表扫描失控）。 */
    public static final int MAX_QUERY_LENGTH = 100;
    /** snippet 窗口半径（命中词前后各取多少字符）。 */
    private static final int SNIPPET_WINDOW = 40;
    /** MySQL FULLTEXT 布尔模式运算符字符（查询中剔除，避免用户输入改变查询语义）。 */
    private static final String BOOLEAN_OPERATORS = "+-<>()~*\"@";

    private static final ObjectMapper MAPPER = new ObjectMapper();

    private SearchQueryUtil() {
    }

    /** FULLTEXT 布尔模式（+词 AND 语义）。 */
    public static final String MODE_FULLTEXT = "fulltext";
    /** LIKE 兜底（ngram 无法索引的短词/单字）。 */
    public static final String MODE_LIKE = "like";

    /**
     * 查询分析结果：mode（fulltext|like）、用于片段/节点定位的 tokens、
     * fulltext 模式下的布尔子句（如 "+布局 +算法"）、like 模式下的转义子串。
     */
    public record Analysis(String mode, List<String> tokens, String clause, String pattern) {
    }

    /** 归一化查询：空白分词 + 剔除布尔运算符 + 长度校验；任一词 &lt; 2 字符 → LIKE 模式。 */
    public static Analysis analyze(String rawQuery) {
        String q = rawQuery == null ? "" : rawQuery.trim();
        if (q.isEmpty()) {
            throw new BadRequestException("搜索关键词不能为空");
        }
        if (q.length() > MAX_QUERY_LENGTH) {
            throw new BadRequestException("搜索关键词不能超过 " + MAX_QUERY_LENGTH + " 字符");
        }

        if (q.length() < 2) {
            // 单字符（中文单字/单字母）：ngram_token_size=2 无 unigram token，FULLTEXT 必 0 命中 → LIKE
            return new Analysis(MODE_LIKE, List.of(q), null, escapeLike(q));
        }

        List<String> tokens = new ArrayList<>();
        for (String raw : q.split("\\s+")) {
            String token = stripBooleanOperators(raw);
            if (!token.isEmpty()) {
                tokens.add(token);
            }
        }
        if (tokens.isEmpty() || tokens.stream().anyMatch(t -> t.length() < 2)) {
            // 全运算符输入或含单字词：整体 LIKE（子串语义最贴近用户输入）
            return new Analysis(MODE_LIKE, List.of(q), null, escapeLike(q));
        }
        String clause = String.join(" ", tokens.stream().map(t -> "+" + t).toList());
        return new Analysis(MODE_FULLTEXT, List.copyOf(tokens), clause, null);
    }

    /** 剔除布尔运算符字符（用户输入不应改变查询语义）；保留空白供后续判断。 */
    private static String stripBooleanOperators(String token) {
        StringBuilder sb = new StringBuilder(token.length());
        for (int i = 0; i < token.length(); i++) {
            char c = token.charAt(i);
            if (BOOLEAN_OPERATORS.indexOf(c) < 0) {
                sb.append(c);
            }
        }
        return sb.toString();
    }

    /** LIKE 模式子串转义（默认转义符 \）：防 %/_/\ 通配注入。 */
    public static String escapeLike(String s) {
        if (s == null || s.isEmpty()) {
            return s;
        }
        return s.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_");
    }

    /**
     * 生成结果片段：命中词前后各 {@link #SNIPPET_WINDOW} 字符，截断处补省略号；换行压成空格。
     * 未命中任何词时（理论上不可能：FULLTEXT/LIKE 命中必含 token 子串）防御性取文本开头。
     */
    public static String snippet(String text, List<String> tokens) {
        if (text == null || text.isEmpty()) {
            return "";
        }
        String flat = text.replace("\r", " ").replace("\n", " ").replaceAll("\\s+", " ");
        String lower = flat.toLowerCase(Locale.ROOT);
        int start = 0;
        int hitLen = 0;
        for (String token : tokens) {
            int idx = lower.indexOf(token.toLowerCase(Locale.ROOT));
            if (idx >= 0) {
                start = idx;
                hitLen = token.length();
                break;
            }
        }
        int begin = Math.max(0, start - SNIPPET_WINDOW);
        int end = Math.min(flat.length(), start + hitLen + SNIPPET_WINDOW);
        String out = flat.substring(begin, end);
        if (begin > 0) {
            out = "…" + out;
        }
        if (end < flat.length()) {
            out = out + "…";
        }
        return out;
    }

    /**
     * 定位首个含命中词的节点 id（D2 结果跳转）：遍历 content_json 的 nodes，取 text/note/tags
     * 拼接文本中首次出现任一 token（忽略大小写）的节点。解析失败或未命中返回 null（读取路径不抛错，
     * 跳转定位是增强而非刚性约束）。
     */
    public static String findMatchNodeId(String contentJson, List<String> tokens) {
        if (contentJson == null || contentJson.isBlank() || tokens == null || tokens.isEmpty()) {
            return null;
        }
        try {
            JsonNode nodes = MAPPER.readTree(contentJson).path("nodes");
            if (!nodes.isObject()) {
                return null;
            }
            Iterator<Map.Entry<String, JsonNode>> it = nodes.fields();
            while (it.hasNext()) {
                Map.Entry<String, JsonNode> entry = it.next();
                JsonNode node = entry.getValue();
                StringBuilder text = new StringBuilder();
                appendText(text, node.path("text"));
                appendText(text, node.path("note"));
                JsonNode tags = node.path("tags");
                if (tags.isArray()) {
                    for (JsonNode tag : tags) {
                        appendText(text, tag);
                    }
                }
                String lower = text.toString().toLowerCase(Locale.ROOT);
                for (String token : tokens) {
                    if (lower.contains(token.toLowerCase(Locale.ROOT))) {
                        return entry.getKey();
                    }
                }
            }
        } catch (Exception ignored) {
            return null;
        }
        return null;
    }

    private static void appendText(StringBuilder sb, JsonNode node) {
        if (node == null || node.isMissingNode() || node.isNull()) {
            return;
        }
        String s = node.isTextual() ? node.textValue() : node.toString();
        if (s != null && !s.isBlank()) {
            if (sb.length() > 0) {
                sb.append(' ');
            }
            sb.append(s);
        }
    }
}
