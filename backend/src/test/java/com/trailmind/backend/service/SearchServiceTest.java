package com.trailmind.backend.service;

import com.trailmind.backend.common.BadRequestException;
import com.trailmind.backend.repository.SearchMapper;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.time.LocalDateTime;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * 搜索服务编排单测（M4 任务一）：类型校验、按类型分组映射（片段/节点定位/上下文回填）、
 * 单字 LIKE 降级、workspaceId 透传、结果缓存（同键 30s 内第二次调用不触 mapper）。
 */
@ExtendWith(MockitoExtension.class)
class SearchServiceTest {

    @Mock
    private SearchMapper mapper;

    @InjectMocks
    private SearchService service;

    private SearchMapper.EntryRow entryRow(long id, String content, int seq) {
        SearchMapper.EntryRow r = new SearchMapper.EntryRow();
        r.setId(id);
        r.setSessionId(100L);
        r.setWorkspaceId(3L);
        r.setWorkspaceName("产品工作区");
        r.setSessionTitle("会话标题");
        r.setSeq(seq);
        r.setType("action");
        r.setContentMd(content);
        r.setCreatedAt(LocalDateTime.of(2025, 6, 1, 9, 0));
        return r;
    }

    private SearchMapper.MindmapRow mindmapRow(long id, String searchText, String contentJson) {
        SearchMapper.MindmapRow r = new SearchMapper.MindmapRow();
        r.setId(id);
        r.setWorkspaceId(3L);
        r.setWorkspaceName("产品工作区");
        r.setName("导图名");
        r.setSearchText(searchText);
        r.setContentJson(contentJson);
        r.setNodeCount(5);
        r.setUpdatedAt(LocalDateTime.of(2025, 6, 1, 9, 0));
        return r;
    }

    private SearchMapper.SessionRow sessionRow(long id, String title) {
        SearchMapper.SessionRow r = new SearchMapper.SessionRow();
        r.setId(id);
        r.setWorkspaceId(3L);
        r.setWorkspaceName("产品工作区");
        r.setTitle(title);
        r.setStatus("active");
        r.setStartedAt(LocalDateTime.of(2025, 6, 1, 9, 0));
        return r;
    }

    @Test
    void search_groups_results_by_type_with_snippet_and_nodeId() {
        when(mapper.searchMindmaps(eq(SearchQueryUtil.MODE_FULLTEXT), eq("+布局"), isNull(), isNull()))
                .thenReturn(List.of(mindmapRow(7L, "导图名 布局算法节点", "{\"nodes\":{\"n2\":{\"text\":\"布局算法\"}}}")));
        when(mapper.searchEntries(eq(SearchQueryUtil.MODE_FULLTEXT), eq("+布局"), isNull(), isNull()))
                .thenReturn(List.of(entryRow(11L, "条目正文 布局算法", 3)));
        when(mapper.searchSessions(eq(List.of("布局")), isNull())).thenReturn(List.of(sessionRow(5L, "布局算法会话")));

        SearchService.SearchResult r = service.search("布局", "all", null);

        assertEquals(1, r.mindmaps().size());
        assertEquals(7L, r.mindmaps().get(0).id());
        assertEquals("n2", r.mindmaps().get(0).nodeId());
        assertEquals(1, r.entries().size());
        assertEquals(11L, r.entries().get(0).id());
        assertEquals(100L, r.entries().get(0).sessionId());
        assertEquals(3, r.entries().get(0).seq());
        assertEquals(1, r.sessions().size());
        assertEquals(5L, r.sessions().get(0).id());
    }

    @Test
    void search_singleChar_uses_like_mode_for_entries_and_mindmaps() {
        when(mapper.searchEntries(eq(SearchQueryUtil.MODE_LIKE), isNull(), eq("搜"), isNull())).thenReturn(List.of());
        when(mapper.searchMindmaps(eq(SearchQueryUtil.MODE_LIKE), isNull(), eq("搜"), isNull())).thenReturn(List.of());
        when(mapper.searchSessions(eq(List.of("搜")), isNull())).thenReturn(List.of());

        SearchService.SearchResult r = service.search("搜", "all", null);

        assertEquals(0, r.entries().size());
        verify(mapper).searchEntries(eq(SearchQueryUtil.MODE_LIKE), isNull(), eq("搜"), isNull());
    }

    @Test
    void search_typeFilter_onlyQueries_requested_type() {
        when(mapper.searchEntries(eq(SearchQueryUtil.MODE_FULLTEXT), eq("+布局"), isNull(), anyLong()))
                .thenReturn(List.of(entryRow(1L, "x 布局", 1)));

        SearchService.SearchResult r = service.search("布局", "entry", 3L);

        assertEquals(1, r.entries().size());
        verify(mapper).searchEntries(eq(SearchQueryUtil.MODE_FULLTEXT), eq("+布局"), isNull(), eq(3L));
        verify(mapper, never()).searchMindmaps(any(), any(), any(), any());
        verify(mapper, never()).searchSessions(any(), any());
    }

    @Test
    void search_invalidType_throws_400() {
        assertThrows(BadRequestException.class, () -> service.search("布局", "bogus", null));
    }

    @Test
    void search_blankQuery_throws_400_without_touching_mapper() {
        assertThrows(BadRequestException.class, () -> service.search("  ", "all", null));
        verify(mapper, never()).searchEntries(any(), any(), any(), any());
    }

    @Test
    void search_caches_same_key_within_ttl() {
        when(mapper.searchEntries(eq(SearchQueryUtil.MODE_FULLTEXT), eq("+缓存"), isNull(), isNull()))
                .thenReturn(List.of(entryRow(1L, "缓存词", 1)));
        when(mapper.searchMindmaps(eq(SearchQueryUtil.MODE_FULLTEXT), eq("+缓存"), isNull(), isNull())).thenReturn(List.of());
        when(mapper.searchSessions(eq(List.of("缓存")), isNull())).thenReturn(List.of());

        service.search("缓存", "all", null);
        SearchService.SearchResult second = service.search("缓存", "all", null);

        assertEquals(1, second.entries().size());
        verify(mapper, times(1)).searchEntries(eq(SearchQueryUtil.MODE_FULLTEXT), eq("+缓存"), isNull(), isNull());
    }

    @Test
    void search_different_params_bypass_cache() {
        when(mapper.searchEntries(eq(SearchQueryUtil.MODE_FULLTEXT), eq("+甲词"), isNull(), isNull())).thenReturn(List.of());
        when(mapper.searchMindmaps(eq(SearchQueryUtil.MODE_FULLTEXT), eq("+甲词"), isNull(), isNull())).thenReturn(List.of());
        when(mapper.searchSessions(eq(List.of("甲词")), isNull())).thenReturn(List.of());
        when(mapper.searchEntries(eq(SearchQueryUtil.MODE_FULLTEXT), eq("+乙词"), isNull(), isNull())).thenReturn(List.of());
        when(mapper.searchMindmaps(eq(SearchQueryUtil.MODE_FULLTEXT), eq("+乙词"), isNull(), isNull())).thenReturn(List.of());
        when(mapper.searchSessions(eq(List.of("乙词")), isNull())).thenReturn(List.of());

        service.search("甲词", "all", null);
        service.search("乙词", "all", null);

        verify(mapper).searchEntries(eq(SearchQueryUtil.MODE_FULLTEXT), eq("+甲词"), isNull(), isNull());
        verify(mapper).searchEntries(eq(SearchQueryUtil.MODE_FULLTEXT), eq("+乙词"), isNull(), isNull());
    }
}
