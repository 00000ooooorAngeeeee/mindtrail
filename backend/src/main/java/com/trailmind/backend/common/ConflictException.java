package com.trailmind.backend.common;

/**
 * 乐观锁冲突（整图保存时 updatedAt 不一致），由 GlobalExceptionHandler 转 code=409。
 */
public class ConflictException extends RuntimeException {

    public ConflictException(String message) {
        super(message);
    }
}
