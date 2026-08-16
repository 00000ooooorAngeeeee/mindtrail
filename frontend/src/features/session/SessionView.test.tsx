import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { SessionView } from './SessionView'
import { exportSessionJson, exportSessionMarkdown, getSession, updateSession } from '../../api/sessions'
import { addEntry, deleteEntry, updateEntry } from '../../api/entries'
import { bindCommits, getCommitDetail, getCommitDiff, getCommits, getSessionCommits, unbindCommit } from '../../api/git'
import { filterEntriesByTag, listTags } from '../../api/tags'
import { MockIntersectionObserver } from '../../test/intersectionObserver'
import { ENTRY_TYPE_STORAGE_KEY } from './typeMemory'
import { gitSuggestKey } from './gitTimeline'
import type { Entry, GitCommit, Session } from '../../api/types'

vi.mock('../../api/sessions', () => ({
  getSession: vi.fn(),
  updateSession: vi.fn(),
  exportSessionMarkdown: vi.fn(),
  exportSessionJson: vi.fn(),
}))
vi.mock('../../api/entries', () => ({
  addEntry: vi.fn(),
  updateEntry: vi.fn(),
  deleteEntry: vi.fn(),
}))
vi.mock('../../api/git', () => ({
  getCommits: vi.fn(),
  getSessionCommits: vi.fn(),
  bindCommits: vi.fn(),
  unbindCommit: vi.fn(),
  getCommitDetail: vi.fn(),
  getCommitDiff: vi.fn(),
}))
vi.mock('../../api/tags', () => ({
  listTags: vi.fn(),
  filterEntriesByTag: vi.fn(),
}))

const getMock = vi.mocked(getSession)
const updateSessionMock = vi.mocked(updateSession)
const exportMock = vi.mocked(exportSessionMarkdown)
const exportJsonMock = vi.mocked(exportSessionJson)
const addMock = vi.mocked(addEntry)
const updateEntryMock = vi.mocked(updateEntry)
const deleteEntryMock = vi.mocked(deleteEntry)
const getCommitsMock = vi.mocked(getCommits)
const getSessionCommitsMock = vi.mocked(getSessionCommits)
const bindMock = vi.mocked(bindCommits)
const unbindMock = vi.mocked(unbindCommit)
const detailMock = vi.mocked(getCommitDetail)
const diffMock = vi.mocked(getCommitDiff)
const listTagsMock = vi.mocked(listTags)
const filterEntriesMock = vi.mocked(filterEntriesByTag)

const H1 = '1'.repeat(40)
const H2 = '2'.repeat(40)

const activeSession = (): Session => ({
  id: 1,
  title: '测试会话',
  status: 'active',
  repoPath: null,
  startedAt: '2025-06-01T09:00:00',
  endedAt: null,
  entryTotal: 2,
  entries: [
    { id: 11, sessionId: 1, seq: 1, type: 'goal', contentMd: '完成目标', tags: ['技术选型'], createdAt: '2025-06-01T09:02:00' },
    { id: 12, sessionId: 1, seq: 2, type: 'error', contentMd: '报错了', tags: [], createdAt: '2025-06-01T09:10:00' },
  ],
})

/** 带仓库的会话（触发 Git 轮询与面板）。 */
const gitSession = (): Session => ({
  ...activeSession(),
  repoPath: 'D:/repo',
  startHead: 'a'.repeat(40),
})

const commit = (hash: string, message: string, files = ['a.txt']): GitCommit => ({
  hash,
  author: '验证者',
  time: '2025-06-01T09:30:00',
  message,
  files,
})

describe('SessionView 会话详情页（时间线条目）', () => {
  beforeEach(() => {
    getMock.mockReset()
    updateSessionMock.mockReset()
    addMock.mockReset()
    updateEntryMock.mockReset()
    deleteEntryMock.mockReset()
    getCommitsMock.mockReset()
    getSessionCommitsMock.mockReset()
    bindMock.mockReset()
    unbindMock.mockReset()
    MockIntersectionObserver.reset()
    localStorage.clear()
    getMock.mockResolvedValue(activeSession())
    getCommitsMock.mockResolvedValue([])
    getSessionCommitsMock.mockResolvedValue([])
    detailMock.mockReset()
    diffMock.mockReset()
    diffMock.mockResolvedValue({ hash: H1, files: [], truncated: false }) // 弹层 diff 预览默认空（既有用例不关心）
    exportMock.mockReset()
    exportJsonMock.mockReset()
    listTagsMock.mockReset()
    filterEntriesMock.mockReset()
    listTagsMock.mockResolvedValue([])
    filterEntriesMock.mockResolvedValue([])
  })

  afterEach(() => {
    // 假定时器测试失败时防止污染后续用例（07 §6 轮询用例使用）
    vi.useRealTimers()
  })

  it('渲染标题、状态徽标与时间线条目（类型名 + 内容 + 时间戳）', async () => {
    render(<SessionView sessionId={1} onBack={() => {}} />)

    expect(await screen.findByText('测试会话')).toBeInTheDocument()
    expect(screen.getByText('进行中')).toBeInTheDocument()
    const list = screen.getByRole('list')
    expect(within(list).getByText('🎯')).toBeInTheDocument()
    expect(within(list).getByText('目标')).toBeInTheDocument()
    expect(within(list).getByText('完成目标')).toBeInTheDocument()
    expect(within(list).getByText('错误')).toBeInTheDocument()
    expect(within(list).getByText('报错了')).toBeInTheDocument()
    expect(within(list).getByText('09:02')).toBeInTheDocument()
    expect(screen.getByText(/条目 2 条/)).toBeInTheDocument()
  })

  it('追加条目：选类型输入内容回车提交（类型默认 action）', async () => {
    addMock.mockResolvedValue({ id: 13, sessionId: 1, seq: 3, type: 'action', contentMd: '新动作', tags: [], createdAt: '2025-06-01T09:20:00' })
    render(<SessionView sessionId={1} onBack={() => {}} />)
    await screen.findByText('测试会话')

    expect((screen.getByLabelText('类型') as HTMLSelectElement).value).toBe('action')
    fireEvent.change(screen.getByLabelText('记录内容'), { target: { value: '新动作' } })
    fireEvent.keyDown(screen.getByLabelText('记录内容'), { key: 'Enter' })

    await waitFor(() => expect(addMock).toHaveBeenCalledWith(1, { type: 'action', contentMd: '新动作' }))
    expect(await screen.findByText('新动作')).toBeInTheDocument()
  })

  it('Shift+Enter 换行不提交，空白内容不提交', async () => {
    render(<SessionView sessionId={1} onBack={() => {}} />)
    await screen.findByText('测试会话')

    fireEvent.change(screen.getByLabelText('记录内容'), { target: { value: '换行前' } })
    fireEvent.keyDown(screen.getByLabelText('记录内容'), { key: 'Enter', shiftKey: true })
    fireEvent.keyDown(screen.getByLabelText('记录内容'), { key: 'Enter', shiftKey: true })
    expect(addMock).not.toHaveBeenCalled()

    fireEvent.change(screen.getByLabelText('记录内容'), { target: { value: '   ' } })
    fireEvent.keyDown(screen.getByLabelText('记录内容'), { key: 'Enter' })
    expect(addMock).not.toHaveBeenCalled()
  })

  it('编辑条目：改内容保存调用更新接口并刷新显示', async () => {
    updateEntryMock.mockResolvedValue({ id: 12, sessionId: 1, seq: 2, type: 'error', contentMd: '改后的内容', tags: [], createdAt: '2025-06-01T09:10:00' })
    render(<SessionView sessionId={1} onBack={() => {}} />)
    await screen.findByText('报错了')

    fireEvent.click(screen.getAllByText('编辑')[1])
    fireEvent.change(screen.getByLabelText('编辑内容'), { target: { value: '改后的内容' } })
    fireEvent.click(screen.getByText('保存'))

    await waitFor(() => expect(updateEntryMock).toHaveBeenCalledWith(12, { contentMd: '改后的内容', type: 'error' }))
    expect(await screen.findByText('改后的内容')).toBeInTheDocument()
  })

  it('编辑条目补记时间：面板预填创建时间，改动后保存携带 createdAt（PRD C2.4）', async () => {
    updateEntryMock.mockResolvedValue({ id: 12, sessionId: 1, seq: 2, type: 'error', contentMd: '报错了', tags: [], createdAt: '2025-06-01T09:15:30' })
    render(<SessionView sessionId={1} onBack={() => {}} />)
    await screen.findByText('报错了')

    fireEvent.click(screen.getAllByText('编辑')[1])
    const timeInput = screen.getByLabelText('编辑时间') as HTMLInputElement
    // jsdom 对 datetime-local 归一化：秒为 0 时省略 ":00"
    expect(timeInput.value).toMatch(/^2025-06-01T09:10(?::00)?$/) // 预填原创建时间
    fireEvent.change(timeInput, { target: { value: '2025-06-01T09:15:30' } })
    fireEvent.click(screen.getByText('保存'))

    await waitFor(() =>
      expect(updateEntryMock).toHaveBeenCalledWith(12, {
        contentMd: '报错了',
        type: 'error',
        createdAt: '2025-06-01T09:15:30',
      }),
    )
    expect(await screen.findByText('09:15')).toBeInTheDocument() // 时间线时间戳随补记更新
  })

  it('编辑条目不改时间：保存不携带 createdAt（不覆盖原创建时间）', async () => {
    updateEntryMock.mockResolvedValue({ id: 12, sessionId: 1, seq: 2, type: 'error', contentMd: '报错了', tags: [], createdAt: '2025-06-01T09:10:00' })
    render(<SessionView sessionId={1} onBack={() => {}} />)
    await screen.findByText('报错了')

    fireEvent.click(screen.getAllByText('编辑')[1])
    fireEvent.click(screen.getByText('保存'))

    await waitFor(() => expect(updateEntryMock).toHaveBeenCalledWith(12, { contentMd: '报错了', type: 'error' }))
  })

  it('插入条目：面板预填当前时间，提交携带 afterSeq 与 createdAt 并重载时间线（PRD C2.5）', async () => {
    vi.setSystemTime(new Date('2025-06-01T10:30:00'))
    addMock.mockResolvedValue({ id: 13, sessionId: 1, seq: 2, type: 'action', contentMd: '插入的验证', tags: [], createdAt: '2025-06-01T10:30:00' })
    getMock
      .mockResolvedValueOnce(activeSession())
      .mockResolvedValueOnce({
        ...activeSession(),
        entryTotal: 3,
        entries: [
          ...(activeSession().entries ?? []),
          { id: 13, sessionId: 1, seq: 2, type: 'action', contentMd: '插入的验证', tags: [], createdAt: '2025-06-01T10:30:00' },
        ],
      })
    render(<SessionView sessionId={1} onBack={() => {}} />)
    await screen.findByText('报错了')

    fireEvent.click(screen.getAllByText('插入')[0]) // 第 1 条（seq=1）之后插入
    expect(screen.getByText('插入到 #1 之后')).toBeInTheDocument()
    const timeInput = screen.getByLabelText('插入时间') as HTMLInputElement
    expect(timeInput.value).toMatch(/^2025-06-01T10:30(?::00)?$/) // 默认当前时间（jsdom 省略 ":00"）

    fireEvent.change(screen.getByLabelText('插入内容'), { target: { value: '插入的验证' } })
    fireEvent.change(timeInput, { target: { value: '2025-06-01T09:45:00' } }) // 补录场景：改到过去
    const panel = screen.getByText('插入到 #1 之后').closest('.entry-card') as HTMLElement
    fireEvent.click(within(panel).getByText('插入'))

    await waitFor(() =>
      expect(addMock).toHaveBeenCalledWith(1, {
        type: 'action',
        contentMd: '插入的验证',
        afterSeq: 1,
        createdAt: '2025-06-01T09:45:00',
      }),
    )
    await waitFor(() => expect(getMock).toHaveBeenCalledTimes(2)) // 提交成功后重载（seq 重排）
    expect(await screen.findByText('插入的验证')).toBeInTheDocument()
  })

  it('插入条目：取消不提交，面板关闭', async () => {
    render(<SessionView sessionId={1} onBack={() => {}} />)
    await screen.findByText('报错了')

    fireEvent.click(screen.getAllByText('插入')[0])
    expect(screen.getByText('插入到 #1 之后')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('插入内容'), { target: { value: '不会提交' } })
    fireEvent.click(screen.getByText('取消'))

    expect(screen.queryByText('插入到 #1 之后')).not.toBeInTheDocument()
    expect(addMock).not.toHaveBeenCalled()
  })

  it('删除条目：二次确认后调用删除接口', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    deleteEntryMock.mockResolvedValue(undefined)
    render(<SessionView sessionId={1} onBack={() => {}} />)
    await screen.findByText('报错了')

    fireEvent.click(screen.getAllByText('删除')[1])

    await waitFor(() => expect(deleteEntryMock).toHaveBeenCalledWith(12))
  })

  it('结束会话：填写总结确认后置为已完成并重新加载', async () => {
    const completed: Session = {
      ...activeSession(),
      status: 'completed',
      summary: '总结内容',
      endedAt: '2025-06-01T11:00:00',
      entryTotal: 3,
      entries: [
        ...(activeSession().entries ?? []),
        { id: 13, sessionId: 1, seq: 3, type: 'review', contentMd: '总结内容', tags: [], createdAt: '2025-06-01T11:00:00' },
      ],
    }
    getMock.mockResolvedValueOnce(activeSession()).mockResolvedValueOnce(completed)
    updateSessionMock.mockResolvedValue(completed)
    render(<SessionView sessionId={1} onBack={() => {}} />)
    await screen.findByText('测试会话')

    fireEvent.click(screen.getByText('结束会话'))
    fireEvent.change(screen.getByLabelText('结束总结'), { target: { value: '总结内容' } })
    fireEvent.click(screen.getByText('确认结束'))

    await waitFor(() => expect(updateSessionMock).toHaveBeenCalledWith(1, { status: 'completed', summary: '总结内容' }))
    expect(await screen.findByText('已完成')).toBeInTheDocument()
  })

  it('已完成会话：类型下拉仅剩 review/note', async () => {
    getMock.mockResolvedValue({
      ...activeSession(),
      status: 'completed',
      endedAt: '2025-06-01T11:00:00',
    })
    render(<SessionView sessionId={1} onBack={() => {}} />)
    await screen.findByText('已完成')

    const select = screen.getByLabelText('类型') as HTMLSelectElement
    expect(Array.from(select.options).map((o) => o.value)).toEqual(['review', 'note'])
  })

  it('无限滚动：哨兵进入视口自动加载下一页（每页 50，无「加载更多」按钮）', async () => {
    const makeEntries = (from: number, count: number, content: string): Entry[] =>
      Array.from({ length: count }, (_, i) => ({
        id: from + i,
        sessionId: 1,
        seq: from + i,
        type: 'note',
        contentMd: `${content}${i + 1}`,
        tags: [],
        createdAt: '2025-06-01T09:00:00',
      }))
    getMock
      .mockResolvedValueOnce({ ...activeSession(), entryTotal: 51, entries: makeEntries(1, 50, '条目') })
      .mockResolvedValueOnce({ ...activeSession(), entryTotal: 51, entries: makeEntries(51, 1, '最后') })
    render(<SessionView sessionId={1} onBack={() => {}} />)
    await screen.findByText('条目1')

    expect(screen.queryByText('加载更多')).not.toBeInTheDocument()
    expect(MockIntersectionObserver.instances.length).toBeGreaterThan(0)
    const last = MockIntersectionObserver.instances[MockIntersectionObserver.instances.length - 1]
    last.triggerIntersect()

    await waitFor(() => expect(getMock).toHaveBeenLastCalledWith(1, 2, 50))
    expect(await screen.findByText('最后1')).toBeInTheDocument()
  })

  it('快速记录类型记忆：追加后重进页面恢复上次类型（03 §4）', async () => {
    addMock.mockResolvedValue({ id: 13, sessionId: 1, seq: 3, type: 'decision', contentMd: '记一次', tags: [], createdAt: '2025-06-01T09:20:00' })
    const { unmount } = render(<SessionView sessionId={1} onBack={() => {}} />)
    await screen.findByText('测试会话')

    fireEvent.change(screen.getByLabelText('类型'), { target: { value: 'decision' } })
    fireEvent.change(screen.getByLabelText('记录内容'), { target: { value: '记一次' } })
    fireEvent.keyDown(screen.getByLabelText('记录内容'), { key: 'Enter' })
    await waitFor(() => expect(addMock).toHaveBeenCalled())
    expect(localStorage.getItem(ENTRY_TYPE_STORAGE_KEY)).toBe('decision')

    unmount()
    render(<SessionView sessionId={1} onBack={() => {}} />)
    await screen.findByText('测试会话')

    expect((screen.getByLabelText('类型') as HTMLSelectElement).value).toBe('decision')
  })

  it('Ctrl+E 聚焦快速记录框（03 §5 快捷键）', async () => {
    render(<SessionView sessionId={1} onBack={() => {}} />)
    await screen.findByText('测试会话')

    fireEvent.keyDown(document, { key: 'e', ctrlKey: true })

    expect(screen.getByLabelText('记录内容')).toHaveFocus()
  })

  // ---------- Git 绑定（07 §6 任务三） ----------

  it('无仓库会话：不请求 Git 接口也不渲染面板', async () => {
    render(<SessionView sessionId={1} onBack={() => {}} />)
    await screen.findByText('测试会话')

    expect(getCommitsMock).not.toHaveBeenCalled()
    expect(getSessionCommitsMock).not.toHaveBeenCalled()
    expect(screen.queryByText(/Git 时间线/)).not.toBeInTheDocument()
  })

  it('Git 面板：展示提交（短 hash/信息/时间/作者/文件数）与绑定状态', async () => {
    getMock.mockResolvedValue(gitSession())
    getCommitsMock.mockResolvedValueOnce([commit(H1, 'feat: 第一个提交', ['a.txt', 'b.txt']), commit(H2, 'feat: 第二个提交')])
    getSessionCommitsMock.mockResolvedValueOnce([{ entryId: 11, commitHash: H1, repoPath: 'D:/repo' }])
    render(<SessionView sessionId={1} onBack={() => {}} />)
    await screen.findByText('测试会话')

    fireEvent.click(screen.getByText(/Git 时间线（2 个提交 · 1 未绑定）/))

    expect(await screen.findByText(H1.slice(0, 7))).toBeInTheDocument()
    expect(screen.getByText('feat: 第一个提交')).toBeInTheDocument()
    expect(screen.getByText(/2 文件/)).toBeInTheDocument()
    expect(screen.getByText('已绑定 #1')).toBeInTheDocument()
    expect(screen.getByText('feat: 第二个提交')).toBeInTheDocument()
  })

  it('Git 面板空态：无提交显示空态引导（PRD C3.6 + 03 §7.2）', async () => {
    getMock.mockResolvedValue(gitSession())
    getCommitsMock.mockResolvedValueOnce([])
    getSessionCommitsMock.mockResolvedValueOnce([])
    render(<SessionView sessionId={1} onBack={() => {}} />)
    await screen.findByText('测试会话')

    fireEvent.click(screen.getByText(/Git 时间线（0 个提交）/))

    expect(await screen.findByText(/尚未检测到提交，先关联仓库或完成一次 git commit/)).toBeInTheDocument()
  })

  it('5s 轮询发现新提交 → 建议卡片 → 一键绑定到最近条目并显示徽标', async () => {
    // shouldAdvanceTime 让假定时钟与真实时间 1:1 推进（RTL waitFor 可用），5s 间隔在约 5s 真实时间后触发，
    // 同时验证 07 §6 验收「新提交 ≤10s 内进入未绑定缓冲」的计时路径。
    vi.useFakeTimers({ shouldAdvanceTime: true })
    // 模拟后端绑定生效：初始 H1 已绑定到条目 11，绑定后 H2 进入绑定表 → 后续轮询不再弹建议
    const boundRows = [{ entryId: 11, commitHash: H1, repoPath: 'D:/repo' }]
    getMock.mockResolvedValue(gitSession())
    getCommitsMock
      .mockResolvedValueOnce([commit(H1, 'feat: 已有提交')])
      .mockResolvedValue([commit(H2, 'feat: 新提交'), commit(H1, 'feat: 已有提交')])
    getSessionCommitsMock.mockImplementation(async () => [...boundRows])
    bindMock.mockImplementation(async (_id, hashes) => {
      for (const h of hashes) boundRows.push({ entryId: 12, commitHash: h, repoPath: 'D:/repo' })
      return [...hashes]
    })
    render(<SessionView sessionId={1} onBack={() => {}} />)
    await screen.findByText('测试会话')
    expect(screen.queryByText(/检测到新提交/)).not.toBeInTheDocument()

    // 新提交经 5s 轮询进入未绑定缓冲 → 建议卡片出现（PRD C3.2）
    await waitFor(() => expect(screen.queryAllByText(/检测到新提交/).length).toBeGreaterThan(0), { timeout: 7000 })

    fireEvent.click(screen.getByText('绑定到最近条目'))

    await waitFor(() => expect(bindMock).toHaveBeenCalledWith(12, [H2]))
    await waitFor(() => expect(screen.queryAllByText(/检测到新提交/).length).toBe(0))
    expect(screen.getByTitle(`查看提交详情 ${H2}`)).toHaveTextContent(H2.slice(0, 7))

    // 绑定生效后继续轮询：不再重复弹出建议
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10000)
    })
    expect(screen.queryAllByText(/检测到新提交/).length).toBe(0)
    vi.useRealTimers()
  }, 15000)

  it('忽略建议：标记已见并持久化（同会话最多 3 次提醒配额见纯函数单测）', async () => {
    getMock.mockResolvedValue(gitSession())
    getCommitsMock.mockResolvedValue([commit(H1, 'feat: 提交')])
    getSessionCommitsMock.mockResolvedValue([])
    render(<SessionView sessionId={1} onBack={() => {}} />)
    await screen.findByText('测试会话')
    await waitFor(() => expect(screen.queryAllByText(/检测到新提交/).length).toBeGreaterThan(0))

    fireEvent.click(screen.getByText('忽略'))

    await waitFor(() => expect(screen.queryAllByText(/检测到新提交/).length).toBe(0))
    const state = JSON.parse(localStorage.getItem(gitSuggestKey(1)) ?? '{}') as { dismissed: number; seenHashes: string[] }
    expect(state.dismissed).toBe(1)
    expect(state.seenHashes).toContain(H1)
  })

  it('条目 commit 徽标：展示短 hash，点击打开详情弹层（缓存优先）并支持解绑', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    const s = gitSession()
    s.entries = [
      ...(s.entries ?? []),
      { id: 13, sessionId: 1, seq: 3, type: 'artifact', contentMd: '构建产物 13', tags: [], commits: [H1], createdAt: '2025-06-01T09:20:00' },
    ]
    getMock.mockResolvedValue(s)
    // 提交在 Git 面板缓存中 → 弹层直接展示，不再调详情接口
    getCommitsMock.mockResolvedValue([
      commit(H1, 'feat: 缓存提交\n\n正文第二行', ['a.txt', 'b.txt']),
    ])
    getSessionCommitsMock.mockResolvedValue([{ entryId: 13, commitHash: H1, repoPath: 'D:/repo' }])
    unbindMock.mockResolvedValue(undefined)
    render(<SessionView sessionId={1} onBack={() => {}} />)
    await screen.findByText('构建产物 13')

    const badge = screen.getByTitle(`查看提交详情 ${H1}`)
    expect(badge).toHaveTextContent(H1.slice(0, 7))
    fireEvent.click(badge)

    const dialog = await screen.findByRole('dialog', { name: '提交详情' })
    expect(within(dialog).getByText(H1)).toBeInTheDocument()
    expect(within(dialog).getByText(/验证者/)).toBeInTheDocument()
    expect(within(dialog).getByText(/feat: 缓存提交/)).toBeInTheDocument()
    expect(within(dialog).getByText('（2）')).toBeInTheDocument() // 变更文件数
    expect(within(dialog).getByText('a.txt')).toBeInTheDocument()
    expect(detailMock).not.toHaveBeenCalled() // 缓存命中

    fireEvent.click(within(dialog).getByText('解绑'))

    await waitFor(() => expect(unbindMock).toHaveBeenCalledWith(13, H1))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(screen.queryByTitle(`查看提交详情 ${H1}`)).not.toBeInTheDocument()
  })

  it('commit 详情弹层：缓存未命中时走详情接口（绑定提交超出面板 50 条窗口）', async () => {
    const s = gitSession()
    s.entries = [
      ...(s.entries ?? []),
      { id: 13, sessionId: 1, seq: 3, type: 'artifact', contentMd: '构建产物 13', tags: [], commits: [H1], createdAt: '2025-06-01T09:20:00' },
    ]
    getMock.mockResolvedValue(s)
    detailMock.mockResolvedValue(commit(H1, 'feat: 历史提交', ['old.txt']))
    render(<SessionView sessionId={1} onBack={() => {}} />)
    await screen.findByText('构建产物 13')

    fireEvent.click(screen.getByTitle(`查看提交详情 ${H1}`))

    const dialog = await screen.findByRole('dialog', { name: '提交详情' })
    await waitFor(() => expect(detailMock).toHaveBeenCalledWith('D:/repo', H1))
    expect(await within(dialog).findByText(/feat: 历史提交/)).toBeInTheDocument()
    expect(within(dialog).getByText('old.txt')).toBeInTheDocument()
  })

  it('条目卡片 Markdown 渲染：粗体/列表/代码块（06 §9）', async () => {
    const s = activeSession()
    s.entries = [
      ...(s.entries ?? []),
      { id: 13, sessionId: 1, seq: 3, type: 'note', contentMd: '**加粗文本** 与\n\n- 列表项甲\n- 列表项乙\n\n```js\nconst x = 1\n```', tags: [], createdAt: '2025-06-01T09:20:00' },
    ]
    getMock.mockResolvedValue(s)
    render(<SessionView sessionId={1} onBack={() => {}} />)

    const strong = await screen.findByText('加粗文本')
    expect(strong.tagName).toBe('STRONG')
    expect(screen.getByText('列表项甲').tagName).toBe('LI')
    expect(screen.getByText('const x = 1')).toBeInTheDocument()
  })

  it('导出 Markdown：调用导出接口并触发浏览器下载（03 §3.5 头部导出入口）', async () => {
    // jsdom 未实现 createObjectURL/revokeObjectURL：直接装桩并还原
    const origCreate = URL.createObjectURL
    const origRevoke = URL.revokeObjectURL
    const createSpy = vi.fn(() => 'blob:mock')
    const revokeSpy = vi.fn()
    URL.createObjectURL = createSpy
    URL.revokeObjectURL = revokeSpy
    try {
      exportMock.mockResolvedValue('---\nformat: trailmind-session\n---')
      render(<SessionView sessionId={1} onBack={() => {}} />)
      await screen.findByText('测试会话')

      fireEvent.click(screen.getByText('导出 Markdown'))

      await waitFor(() => expect(exportMock).toHaveBeenCalledWith(1))
      expect(createSpy).toHaveBeenCalled()
      expect(revokeSpy).toHaveBeenCalled()
    } finally {
      URL.createObjectURL = origCreate
      URL.revokeObjectURL = origRevoke
    }
  })

  it('导出 JSON：调用 JSON 导出接口并以机器可读格式触发下载（PRD C5）', async () => {
    const origCreate = URL.createObjectURL
    const origRevoke = URL.revokeObjectURL
    const createSpy = vi.fn(() => 'blob:mock')
    const revokeSpy = vi.fn()
    URL.createObjectURL = createSpy
    URL.revokeObjectURL = revokeSpy
    try {
      exportJsonMock.mockResolvedValue({
        format: 'trailmind-session-json',
        version: 1,
        session: {
          id: 1,
          title: '测试会话',
          status: 'active',
          workspaceId: 3,
          workspace: null,
          repoPath: null,
          startHead: null,
          endHead: null,
          summary: null,
          startedAt: '2025-06-01T09:00:00',
          endedAt: null,
          createdAt: null,
          updatedAt: null,
        },
        entries: [],
        entryCount: 0,
      })
      render(<SessionView sessionId={1} onBack={() => {}} />)
      await screen.findByText('测试会话')

      fireEvent.click(screen.getByText('导出 JSON'))

      await waitFor(() => expect(exportJsonMock).toHaveBeenCalledWith(1))
      expect(createSpy).toHaveBeenCalled()
      expect(revokeSpy).toHaveBeenCalled()
    } finally {
      URL.createObjectURL = origCreate
      URL.revokeObjectURL = origRevoke
    }
  })

  it('按标签过滤：选择标签后展示该标签命中条目，清除过滤恢复时间线（M4 任务二 D4）', async () => {
    const s = activeSession()
    s.workspaceId = 3
    getMock.mockResolvedValue(s)
    listTagsMock.mockResolvedValue([{ id: 7, workspaceId: 3, name: '技术选型', entryCount: 1 }])
    filterEntriesMock.mockResolvedValue([
      {
        id: 11,
        sessionId: 1,
        seq: 1,
        type: 'goal',
        contentMd: '完成目标',
        createdAt: '2025-06-01T09:02:00',
        sessionTitle: '测试会话',
        workspaceId: 3,
        workspaceName: '项目',
        tags: ['技术选型'],
      },
    ])
    render(<SessionView sessionId={1} onBack={() => {}} />)
    await screen.findByText('测试会话')

    // 时间线默认可见
    expect(screen.getByText('报错了')).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('标签过滤'), { target: { value: '7' } })

    await waitFor(() => expect(filterEntriesMock).toHaveBeenCalledWith(7, 1))
    expect(await screen.findByTestId('session-tag-filtered')).toBeInTheDocument()
    expect(within(screen.getByTestId('session-tag-filtered')).getByText('完成目标')).toBeInTheDocument()
    // 原时间线被替换
    expect(screen.queryByText('报错了')).not.toBeInTheDocument()

    fireEvent.click(screen.getByText('清除过滤'))
    await waitFor(() => expect(screen.getByText('报错了')).toBeInTheDocument())
  })
})
