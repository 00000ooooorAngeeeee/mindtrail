import type { ApiResponse } from './types'

// Vite dev proxy 会把 /api 转发到后端（见 vite.config.ts），
// 因此这里用相对路径，开发与生产（Electron 加载产物）均适用。
const BASE_URL = '/api/v1'

export class ApiError extends Error {
  constructor(
    public code: number,
    message: string,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

/** 请求超时（人工验收反馈：请求挂起会让 creating 状态永久卡死，输入框被禁用无法再创建）。 */
const REQUEST_TIMEOUT_MS = 10000

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  let res: Response
  try {
    res = await fetch(`${BASE_URL}${path}`, {
      ...options,
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json', ...(options.headers ?? {}) },
    })
  } catch (e) {
    if (controller.signal.aborted) throw new ApiError(-2, '请求超时，请重试')
    throw new ApiError(-1, '无法连接后端服务，请确认后端已启动')
  } finally {
    clearTimeout(timer)
  }

  let body: ApiResponse<T>
  try {
    body = (await res.json()) as ApiResponse<T>
  } catch {
    throw new ApiError(res.status, `后端响应解析失败（HTTP ${res.status}）`)
  }

  if (body.code !== 0) {
    throw new ApiError(body.code, body.message || '请求失败')
  }
  return body.data
}

export function get<T>(path: string): Promise<T> {
  return request<T>(path, { method: 'GET' })
}

export function post<T>(path: string, body?: unknown): Promise<T> {
  return request<T>(path, {
    method: 'POST',
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

export function put<T>(path: string, body?: unknown): Promise<T> {
  return request<T>(path, {
    method: 'PUT',
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

export function del<T>(path: string): Promise<T> {
  return request<T>(path, { method: 'DELETE' })
}
