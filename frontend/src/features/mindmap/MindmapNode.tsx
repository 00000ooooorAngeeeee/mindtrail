// 导图节点卡片（React Flow 自定义节点）。圆角卡片 + 选中态 + 浮动工具条 + 折叠/展开 + 子节点数徽标。
// 交互：双击进入编辑（Enter 确认 / Esc 取消 / Shift+Enter 换行，PRD B1.3、03 §4）。
// 画布模式（data.connectable）：渲染左右连接手柄（自由连线，PRD B2.2），隐藏折叠按钮与徽标（画布忽略折叠，05 §4）。
import { useState, type CSSProperties, type KeyboardEvent } from 'react'
import { Handle, Position, type Node, type NodeProps } from '@xyflow/react'
import { useMindmapStore } from '../../store/useMindmapStore'
import type { MindmapNodeStyle } from './content'
import { nodeColor } from './nodeStyle'
import './mindmap.css'

export type MindmapNodeData = {
  text: string
  style: MindmapNodeStyle
  isRoot: boolean
  hasChildren: boolean
  childCount: number
  collapsed: boolean
  /** 画布模式：渲染连接手柄。 */
  connectable?: boolean
  /** 画布模式：节点当前坐标（工具栏「加子节点」在节点旁落点用）。 */
  position?: { x: number; y: number }
  /** 拖拽悬停时的候选落点（拖拽改层级高亮，03 §4）。 */
  hover?: boolean
}

export type MindmapRFNode = Node<MindmapNodeData, 'mindmap'>

export function MindmapNode({ id, data, selected }: NodeProps<MindmapRFNode>) {
  const updateText = useMindmapStore((s) => s.updateText)
  const addChild = useMindmapStore((s) => s.addChild)
  const deleteNode = useMindmapStore((s) => s.deleteNode)
  const toggleCollapse = useMindmapStore((s) => s.toggleCollapse)

  // 画布模式加子节点：落在当前节点右下（层级仍挂本节点，PRD B3.4 一致性）。
  const onAddChild = () => {
    if (data.connectable && data.position) {
      addChild(id, { x: data.position.x + 40, y: data.position.y + 60 })
    } else {
      addChild(id)
    }
  }

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

  const color = nodeColor(data.style.color)

  return (
    <div
      className={`mm-node${selected ? ' selected' : ''}${data.isRoot ? ' root' : ''}${data.hover ? ' drop-target' : ''} shape-${data.style.shape}${data.style.bold ? ' bold' : ''}`}
      style={{ '--node-bg': color.bg, '--node-border': color.border } as CSSProperties}
      onDoubleClick={(e) => {
        e.stopPropagation()
        startEdit()
      }}
    >
      {data.connectable && (
        <>
          <Handle type="target" position={Position.Left} className="mm-handle" isConnectableStart={false} />
          <Handle type="source" position={Position.Right} className="mm-handle" isConnectableEnd={false} />
        </>
      )}

      {selected && !editing && (
        <div className="mm-node-toolbar">
          <button title="添加子节点" onClick={onAddChild}>
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

      {data.hasChildren && !data.connectable && (
        <button
          className="mm-collapse"
          title={data.collapsed ? '展开' : '折叠'}
          onClick={() => toggleCollapse(id)}
        >
          {data.collapsed ? '▸' : '▾'}
        </button>
      )}

      <div className="mm-node-body">
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
      </div>

      {data.collapsed && data.hasChildren && !data.connectable && (
        <span className="mm-node-badge">{data.childCount}</span>
      )}
    </div>
  )
}
