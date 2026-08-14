package com.trailmind.backend.common;

/**
 * 资源不存在（查询/更新/删除目标 id 未命中），由 GlobalExceptionHandler 转 code=404。
 */
public class NotFoundException extends RuntimeException {

    public NotFoundException(String message) {
        super(message);
    }
}
