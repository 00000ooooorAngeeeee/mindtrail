import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiError, get, post } from './client'

const ok = (data: unknown) => ({ code: 0, data, message: 'ok' })

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('api/client', () => {
  it('get 解包成功响应的 data', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        status: 200,
        json: async () => ok({ status: 'ok', app: 'trailmind', version: '0.0.1' }),
      }),
    )
    await expect(get('/health')).resolves.toEqual({
      status: 'ok',
      app: 'trailmind',
      version: '0.0.1',
    })
  })

  it('code≠0 时抛出 ApiError 并携带后端 message', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        status: 200,
        json: async () => ({ code: 400, data: null, message: '工作区名称不能为空' }),
      }),
    )
    const p = get('/workspaces')
    await expect(p).rejects.toBeInstanceOf(ApiError)
    await expect(p).rejects.toThrow('工作区名称不能为空')
  })

  it('网络异常时抛出「后端未连接」提示', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')))
    await expect(get('/health')).rejects.toThrow('无法连接后端服务')
  })

  it('请求挂起超过 10s 时中止并抛出「请求超时」', async () => {
    vi.useFakeTimers()
    // 模拟永不响应的请求：仅在 AbortSignal 触发时 reject（超时中止路径）
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(
        (_url: unknown, opts: { signal: AbortSignal }) =>
          new Promise((_resolve, reject) => {
            opts.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))
          }),
      ),
    )
    const p = get('/health')
    const assertion = expect(p).rejects.toThrow('请求超时')
    await vi.advanceTimersByTimeAsync(10000)
    await assertion
    vi.useRealTimers()
  })

  it('post 将请求体序列化为 JSON 并指向 /api/v1', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      status: 200,
      json: async () => ok({ id: 1, name: '测试' }),
    })
    vi.stubGlobal('fetch', fetchMock)
    await post('/workspaces', { name: '测试' })
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/workspaces',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ name: '测试' }),
      }),
    )
  })
})
