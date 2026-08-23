package com.trailmind.backend.common;

import java.util.List;

/**
 * 批量删除请求体（04 §5：POST /&lt;entity&gt;/batch-delete，body {@code {"ids": [..]}}）。
 * ids 为待删实体主键集合；空集合视为幂等无操作（service 层直接返回）。
 */
public record BatchDeleteRequest(List<Long> ids) {
}
