// 树状模式节点卡片（React Flow 自定义节点）。圆角卡片 + 选中态 + 浮动工具条 + 折叠/展开 + 子节点数徽标。
// 交互：双击进入编辑（Enter 确认 / Esc 取消 / Shift+Enter 换行，PRD B1.3、03 §4）。
import { useState, type KeyboardEvent } from 'react'
import type { Node, NodeProps } from '@xyflow/react'
import { useMindmapStore } from '../../store/useMindmapStore'
import './mindmap.css'

export type MindmapNodeData = {
  text: string
  isRoot: boolean
  hasChildren: boolean
  childCount: number
  collapsed: boolean
  /** 拖拽悬停时的候选落点（拖拽改层级高亮，03 §4）。 */
  hover?: boolean
}

export type MindmapRFNode = Node<MindmapNodeData, 'mindmap'>

export function MindmapNode({ id, data, selected }: NodeProps<MindmapRFNode>) {
  const updateText = useMindmapStore((s) => s.updateText)
  const addChild = useMindmapStore((s) => s.addChild)
  const deleteNode = useMindmapStore((s) => s.deleteNode)
  const toggleCollapse = useMindmapStore((s) => s.toggleCollapse)

  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(data.text)

  const startEdit = () => {
    setDraft(data.text)
    setEditing(true)
  }

  const commit = () => {
    setEditing(false)
    if (draft.trim() !== data.text) updateText(id, draft.trim())
  }

  const cancel = () => setEditing(false)

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      commit()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      cancel()
    }
  }

  return (
    <div
      className={`mm-node${selected ? ' selected' : ''}${data.isRoot ? ' root' : ''}${data.hover ? ' drop-target' : ''}`}
      onDoubleClick={(e) => {
        e.stopPropagation()
        startEdit()
      }}
    >
      {selected && !editing && (
        <div className="mm-node-toolbar">
          <button title="添加子节点" onClick={() => addChild(id)}>
            ＋
          </button>
          <button title="编辑" onClick={startEdit}>
            ✎
          </button>
          {!data.isRoot && (
            <button title="删除" className="danger" onClick={() => deleteNode(id)}>
              🗑
            </button>
          )}
        </div>
      )}

      {data.hasChildren && (
        <button
          className="mm-collapse"
          title={data.collapsed ? '展开' : '折叠'}
          onClick={() => toggleCollapse(id)}
        >
          {data.collapsed ? '▸' : '▾'}
        </button>
      )}

      {editing ? (
        <textarea
          className="mm-node-input"
          value={draft}
          autoFocus
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={onKeyDown}
          rows={1}
        />
      ) : (
        <span className="mm-node-text">{data.text}</span>
      )}

      {data.collapsed && data.hasChildren && <span className="mm-node-badge">{data.childCount}</span>}
    </div>
  )
}
