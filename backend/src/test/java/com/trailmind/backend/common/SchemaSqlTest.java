package com.trailmind.backend.common;

import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * schema.sql 完整性冒烟：确保 8 张表齐全、ngram 全文索引存在（防止误删表）。
 * 真正的建库建表行为由运行时验证（见 docs/10 任务 0.3 验收）。
 */
class SchemaSqlTest {

    @Test
    void schema_contains_all_tables_and_ngram_fulltext() throws IOException {
        String sql = readSchema();

        for (String table : List.of(
                "workspace", "mindmap", "session", "entry",
                "tag", "entry_tag", "entry_commit", "setting")) {
            assertTrue(sql.contains("CREATE TABLE IF NOT EXISTS " + table),
                    "schema.sql 缺少表: " + table);
        }

        assertTrue(sql.contains("WITH PARSER ngram"), "缺少 ngram 全文索引");
    }

    private String readSchema() throws IOException {
        try (InputStream in = getClass().getClassLoader().getResourceAsStream("db/schema.sql")) {
            assert in != null : "db/schema.sql 未找到";
            return new String(in.readAllBytes(), StandardCharsets.UTF_8);
        }
    }
}
