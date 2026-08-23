package com.trailmind.backend.repository;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.trailmind.backend.entity.EntryCommit;
import org.apache.ibatis.annotations.Delete;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;

import java.time.LocalDateTime;
import java.util.List;

/**
 * entry_commit 表 Mapper（M3 任务三）：
 * 绑定写入走 BaseMapper.insert；查询按条目/按会话批量取（回填与 Git 面板，避免 N+1）；
 * 解绑按 (entry_id, commit_hash) 删除。级联清理复用 EntryMapper.deleteEntryCommitsByEntry/BySession。
 */
@Mapper
public interface EntryCommitMapper extends BaseMapper<EntryCommit> {

    @Select("SELECT commit_hash FROM entry_commit WHERE entry_id = #{entryId} ORDER BY bound_at")
    List<String> selectHashesByEntry(@Param("entryId") Long entryId);

    /** 会话内全部绑定（条目 id + hash + 来源仓库），供详情回填与 Git 面板「未绑定缓冲」计算。 */
    @Select("SELECT entry_id, commit_hash, repo_path, bound_at FROM entry_commit " +
            "WHERE entry_id IN (SELECT id FROM entry WHERE session_id = #{sessionId}) " +
            "ORDER BY entry_id, bound_at")
    List<CommitRow> selectBySession(@Param("sessionId") Long sessionId);

    @Delete("DELETE FROM entry_commit WHERE entry_id = #{entryId} AND commit_hash = #{commitHash}")
    int deleteByEntryAndHash(@Param("entryId") Long entryId, @Param("commitHash") String commitHash);

    /** 全量恢复前清空整表（DML DELETE，事务内可回滚；供 BackupRestoreService）。 */
    @Delete("DELETE FROM entry_commit")
    int deleteAll();

    /** 投影行（MyBatis 按下划线转驼峰自动映射）。 */
    class CommitRow {
        private Long entryId;
        private String commitHash;
        private String repoPath;
        private LocalDateTime boundAt;

        public Long getEntryId() {
            return entryId;
        }

        public void setEntryId(Long entryId) {
            this.entryId = entryId;
        }

        public String getCommitHash() {
            return commitHash;
        }

        public void setCommitHash(String commitHash) {
            this.commitHash = commitHash;
        }

        public String getRepoPath() {
            return repoPath;
        }

        public void setRepoPath(String repoPath) {
            this.repoPath = repoPath;
        }

        public LocalDateTime getBoundAt() {
            return boundAt;
        }

        public void setBoundAt(LocalDateTime boundAt) {
            this.boundAt = boundAt;
        }
    }
}
