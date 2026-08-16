package com.trailmind.backend.common;

import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

/**
 * 全局异常处理：未捕获异常统一转 ApiResponse，避免把堆栈透出给前端。
 */
@RestControllerAdvice
public class GlobalExceptionHandler {

    @ExceptionHandler(BadRequestException.class)
    public ApiResponse<Void> handleBadRequest(BadRequestException e) {
        return ApiResponse.error(400, e.getMessage());
    }

    /** 请求体不可读（JSON 语法错误 / 字段类型不匹配，如补记时间格式非法）→ 400 而非 500（C2.4 校验链路）。 */
    @ExceptionHandler(HttpMessageNotReadableException.class)
    public ApiResponse<Void> handleNotReadable(HttpMessageNotReadableException e) {
        return ApiResponse.error(400, "请求体格式错误：" + e.getMostSpecificCause().getMessage());
    }

    @ExceptionHandler(NotFoundException.class)
    public ApiResponse<Void> handleNotFound(NotFoundException e) {
        return ApiResponse.error(404, e.getMessage());
    }

    @ExceptionHandler(ConflictException.class)
    public ApiResponse<Void> handleConflict(ConflictException e) {
        return ApiResponse.error(409, e.getMessage());
    }

    @ExceptionHandler(Exception.class)
    public ApiResponse<Void> handleException(Exception e) {
        return ApiResponse.error(500, e.getMessage());
    }
}
