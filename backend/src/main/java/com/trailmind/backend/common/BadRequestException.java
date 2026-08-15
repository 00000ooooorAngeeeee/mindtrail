package com.trailmind.backend.common;

/**
 * 业务请求非法（参数校验失败等），由 GlobalExceptionHandler 转 code=400。
 */
public class BadRequestException extends RuntimeException {

    public BadRequestException(String message) {
        super(message);
    }

    /** 携带根因（对外只透出 message，根因留在日志便于排查）。 */
    public BadRequestException(String message, Throwable cause) {
        super(message, cause);
    }
}
