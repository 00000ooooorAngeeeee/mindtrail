package com.trailmind.backend.service;

import com.trailmind.backend.common.BadRequestException;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * 搜索查询工具单测（M4 任务一，08 §6「关键逻辑补单测」）：
 * 分词与模式判定（多字 FULLTEXT / 单字 LIKE / 全运算符输入）、布尔运算符剔除、LIKE 转义、
 * 片段窗口与省略号、节点定位（含大小写不敏感、非法 JSON 容错）。
 */
class SearchQueryUtilTest {

    @Test
    void analyze_multiCharTokens_uses_fulltext_and_clause() {
        SearchQueryUtil.Analysis a = SearchQueryUtil.analyze("布局 算法");
        assertEquals(SearchQueryUtil.MODE_FULLTEXT, a.mode());
        assertEquals(List.of("布局", "算法"), a.tokens());
        assertEquals("+布局 +算法", a.clause());
        assertNull(a.pattern());
    }

    @Test
    void analyze_strips_boolean_operators() {
        SearchQueryUtil.Analysis a = SearchQueryUtil.analyze("+布局 -算法 \"引号\" (括号)");
        assertEquals("+布局 +算法 +引号 +括号", a.clause());
    }

    @Test
    void analyze_singleCjkChar_falls_back_to_like() {
        SearchQueryUtil.Analysis a = SearchQueryUtil.analyze("搜");
        assertEquals(SearchQueryUtil.MODE_LIKE, a.mode());
        assertEquals(List.of("搜"), a.tokens());
        assertEquals("搜", a.pattern());
        assertNull(a.clause());
    }

    @Test
    void analyze_singleAsciiChar_falls_back_to_like() {
        SearchQueryUtil.Analysis a = SearchQueryUtil.analyze("A");
        assertEquals(SearchQueryUtil.MODE_LIKE, a.mode());
    }

    @Test
    void analyze_mixedShortToken_falls_back_to_like() {
        // 「字」为单字词：ngram 无 unigram token，整体 LIKE 而非只靠其它词
        SearchQueryUtil.Analysis a = SearchQueryUtil.analyze("字 测试");
        assertEquals(SearchQueryUtil.MODE_LIKE, a.mode());
        assertEquals(List.of("字 测试"), a.tokens());
    }

    @Test
    void analyze_onlyOperators_falls_back_to_like_with_raw() {
        // + 不是 LIKE 通配符，escapeLike 仅转义 % _ \，故 pattern 保持原文
        SearchQueryUtil.Analysis a = SearchQueryUtil.analyze("+++");
        assertEquals(SearchQueryUtil.MODE_LIKE, a.mode());
        assertEquals("+++", a.pattern());
    }

    @Test
    void analyze_blank_query_throws_400() {
        assertThrows(BadRequestException.class, () -> SearchQueryUtil.analyze("   "));
        assertThrows(BadRequestException.class, () -> SearchQueryUtil.analyze(null));
    }

    @Test
    void analyze_tooLong_query_throws_400() {
        String longQuery = "词".repeat(SearchQueryUtil.MAX_QUERY_LENGTH + 1);
        assertThrows(BadRequestException.class, () -> SearchQueryUtil.analyze(longQuery));
    }

    @Test
    void analyze_maxLength_query_ok() {
        String q = "词".repeat(SearchQueryUtil.MAX_QUERY_LENGTH);
        assertEquals(SearchQueryUtil.MODE_FULLTEXT, SearchQueryUtil.analyze(q).mode());
    }

    @Test
    void escapeLike_escapes_percent_underscore_backslash() {
        assertEquals("a\\%b\\_c\\\\d", SearchQueryUtil.escapeLike("a%b_c\\d"));
        assertNull(SearchQueryUtil.escapeLike(null));
    }

    @Test
    void snippet_windows_around_first_token_with_ellipsis() {
        String text = "前文填充".repeat(20) + "布局算法命中词" + "后文填充".repeat(20);
        String s = SearchQueryUtil.snippet(text, List.of("布局算法"));
        assertTrue(s.startsWith("…"));
        assertTrue(s.endsWith("…"));
        assertTrue(s.contains("布局算法"));
        assertTrue(s.length() <= 86); // 2 个省略号 + 命中词 4 字 + 两侧各 40 字符窗口
    }

    @Test
    void snippet_noTruncation_when_text_short() {
        String s = SearchQueryUtil.snippet("短文本 布局算法", List.of("布局算法"));
        assertEquals("短文本 布局算法", s);
    }

    @Test
    void snippet_flattens_newlines() {
        String s = SearchQueryUtil.snippet("第一行\n第二行 布局算法", List.of("布局算法"));
        assertTrue(s.contains("第一行 第二行"));
    }

    @Test
    void snippet_falls_back_to_head_when_no_token() {
        String text = "完全无关的文本";
        String s = SearchQueryUtil.snippet(text, List.of("不存在"));
        assertEquals("完全无关的文本", s);
    }

    @Test
    void findMatchNodeId_finds_first_node_containing_token() {
        String json = """
                {"version":1,"rootNodeId":"n1","nodes":{
                  "n1":{"id":"n1","text":"根节点","note":"","tags":[],"parentId":null,"layout":null,"collapsed":false},
                  "n2":{"id":"n2","text":"","note":"备注里有 布局算法","tags":[],"parentId":"n1","layout":null,"collapsed":false},
                  "n3":{"id":"n3","text":"","note":"","tags":["布局算法"],"parentId":"n1","layout":null,"collapsed":false}
                },"edges":[]}
                """;
        assertEquals("n2", SearchQueryUtil.findMatchNodeId(json, List.of("布局算法")));
    }

    @Test
    void findMatchNodeId_is_case_insensitive() {
        String json = """
                {"version":1,"rootNodeId":"n1","nodes":{"n1":{"id":"n1","text":"React Flow","note":"","tags":[],"parentId":null,"layout":null,"collapsed":false}},"edges":[]}
                """;
        assertEquals("n1", SearchQueryUtil.findMatchNodeId(json, List.of("react flow")));
    }

    @Test
    void findMatchNodeId_invalid_json_returns_null() {
        assertNull(SearchQueryUtil.findMatchNodeId("不是 JSON", List.of("x")));
        assertNull(SearchQueryUtil.findMatchNodeId(null, List.of("x")));
        assertNull(SearchQueryUtil.findMatchNodeId("{}", List.of()));
    }
}
