import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { SessionView } from './SessionView'
import { getSession, updateSession } from '../../api/sessions'
import { addEntry, deleteEntry, updateEntry } from '../../api/entries'
import type { Entry, Session } from '../../api/types'

vi.mock('../../api/sessions', () => ({
  getSession: vi.fn(),
  updateSession: vi.fn(),
}))
vi.mock('../../api/entries', () => ({
  addEntry: vi.fn(),
  updateEntry: vi.fn(),
  deleteEntry: vi.fn(),
}))

const getMock = vi.mocked(getSession)
const updateSessionMock = vi.mocked(updateSession)
const addMock = vi.mocked(addEntry)
const updateEntryMock = vi.mocked(updateEntry)
const deleteEntryMock = vi.mocked(deleteEntry)

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

describe('SessionView 会话详情页（时间线条目）', () => {
  beforeEach(() => {
    getMock.mockReset()
    updateSessionMock.mockReset()
    addMock.mockReset()
    updateEntryMock.mockReset()
    deleteEntryMock.mockReset()
    getMock.mockResolvedValue(activeSession())
  })

  it('渲染标题、状态徽标与时间线条目（类型名 + 内容 + 时间戳）', async () => {
    render(<SessionView sessionId={1} onBack={() => {}} />)

    expect(await screen.findByText('测试会话')).toBeInTheDocument()
    expect(screen.getByText('进行中')).toBeInTheDocument()
    const list = screen.getByRole('list')
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

  it('加载更多：已加载条目数小于总数时请求下一页', async () => {
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

    fireEvent.click(screen.getByText('加载更多'))

    await waitFor(() => expect(getMock).toHaveBeenLastCalledWith(1, 2, 50))
    expect(await screen.findByText('最后1')).toBeInTheDocument()
  })
})
