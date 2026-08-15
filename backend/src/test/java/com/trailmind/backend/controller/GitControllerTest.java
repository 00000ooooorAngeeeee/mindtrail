package com.trailmind.backend.controller;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.SerializationFeature;
import com.fasterxml.jackson.datatype.jsr310.JavaTimeModule;
import com.trailmind.backend.git.GitRepoService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.junit.jupiter.api.extension.ExtendWith;
import org.springframework.http.converter.json.MappingJackson2HttpMessageConverter;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

import java.time.LocalDateTime;
import java.util.List;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * Git 接口路由与参数透传单测（mock service；真实仓库行为由 GitRepoServiceTest 覆盖）：
 * GET /git/repo/status、GET /git/repo/commits（since/until/limit 透传与默认值）。
 */
@ExtendWith(MockitoExtension.class)
class GitControllerTest {

    @Mock
    private GitRepoService gitRepoService;

    @InjectMocks
    private GitController controller;

    private MockMvc mockMvc;

    @BeforeEach
    void setUp() {
        // standalone 环境补 JavaTimeModule，与 Spring Boot 自动配置的序列化一致（LocalDateTime → ISO 字符串）
        ObjectMapper mapper = new ObjectMapper().registerModule(new JavaTimeModule());
        mapper.disable(SerializationFeature.WRITE_DATES_AS_TIMESTAMPS);
        mockMvc = MockMvcBuilders.standaloneSetup(controller)
                .setMessageConverters(new MappingJackson2HttpMessageConverter(mapper))
                .build();
    }

    @Test
    void status_returns_head_and_branch() throws Exception {
        when(gitRepoService.status("D:/repo")).thenReturn(
                new GitRepoService.RepoStatus("D:/repo", "a".repeat(40), "master"));

        mockMvc.perform(get("/api/v1/git/repo/status").param("path", "D:/repo"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(0))
                .andExpect(jsonPath("$.data.head").value("a".repeat(40)))
                .andExpect(jsonPath("$.data.branch").value("master"));

        verify(gitRepoService).status("D:/repo");
    }

    @Test
    void commits_passes_since_until_limit_and_maps_fields() throws Exception {
        LocalDateTime time = LocalDateTime.of(2025, 6, 1, 9, 0, 0);
        when(gitRepoService.commits(eq("D:/repo"), eq("b".repeat(40)), eq("c".repeat(40)), eq(10)))
                .thenReturn(List.of(new GitRepoService.CommitInfo(
                        "a".repeat(40), "验证者", "v@trailmind.local", time, "提交消息", List.of("x.txt"))));

        mockMvc.perform(get("/api/v1/git/repo/commits")
                        .param("path", "D:/repo")
                        .param("since", "b".repeat(40))
                        .param("until", "c".repeat(40))
                        .param("limit", "10"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(0))
                .andExpect(jsonPath("$.data[0].hash").value("a".repeat(40)))
                .andExpect(jsonPath("$.data[0].author").value("验证者"))
                .andExpect(jsonPath("$.data[0].time").value("2025-06-01T09:00:00"))
                .andExpect(jsonPath("$.data[0].message").value("提交消息"))
                .andExpect(jsonPath("$.data[0].files[0]").value("x.txt"));

        verify(gitRepoService).commits("D:/repo", "b".repeat(40), "c".repeat(40), 10);
    }

    @Test
    void commits_omitted_params_use_defaults() throws Exception {
        when(gitRepoService.commits(eq("D:/repo"), eq(null), eq(null), eq(null)))
                .thenReturn(List.of());

        mockMvc.perform(get("/api/v1/git/repo/commits").param("path", "D:/repo"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(0))
                .andExpect(jsonPath("$.data").isArray());

        verify(gitRepoService).commits(eq("D:/repo"), eq(null), eq(null), any());
    }
}
