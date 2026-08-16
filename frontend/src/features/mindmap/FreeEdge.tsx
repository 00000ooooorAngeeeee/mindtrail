// 画布自由连线自定义边（PRD B2.2 P1「可编辑标签」）：贝塞尔曲线 + 箭头 + 中点标签。
// 交互（与节点编辑同款，03 §4）：双击连线进入编辑——Enter 确认 / Esc 取消 / 失焦提交；空白视为清除标签。
// 数据流：提交经 data.onUpdateLabel → store updateEdgeLabel（统一 apply：撤销/重做 + 防抖保存，08 §4.3）。
// 注意：EdgeLabelRenderer 依赖 React Flow 内部 store（无 store 返回 null），故标签编辑框拆成
// EdgeLabelEditor 纯展示组件单独导出，便于脱离 React Flow 上下文单测交互逻辑。
import { useCallback, useRef, useState, type KeyboardEvent } from 'react'
import { BaseEdge, EdgeLabelRenderer, getBezierPath, type Edge, type EdgeProps } from '@xyflow/react'
import './mindmap.css'

export type FreeEdgeData = {
  /** 提交标签（空白 = 清除）。 */
  onUpdateLabel: (edgeId: string, label: string) => void
}

export type FreeRFEdge = Edge<FreeEdgeData, 'free'>

/** 连线标签编辑输入框（纯展示，位置由 FreeEdge 经 EdgeLabelRenderer 定位到连线中点）。 */
export function EdgeLabelEditor({
  initial,
  x,
  y,
  onCommit,
  onCancel,
}: {
  initial: string
  x: number
  y: number
  onCommit: (label: string) => void
  onCancel: () => void
}) {
  const [draft, setDraft] = useState(initial)

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      onCommit(draft)
    } else if (e.key === 'Escape') {
      e.preventDefault()
      onCancel()
    }
  }

  return (
    <div
      className="nodrag nopan"
      style={{
        position: 'absolute',
        transform: `translate(-50%, -50%) translate(${x}px, ${y}px)`,
        pointerEvents: 'all',
      }}
    >
      <input
        className="mm-edge-label-input"
        value={draft}
        autoFocus
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => onCommit(draft)}
        onKeyDown={onKeyDown}
        placeholder="连线标签（Enter 确认，空白清除）"
      />
    </div>
  )
}

export function FreeEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  markerEnd,
  label,
  data,
}: EdgeProps<FreeRFEdge>) {
  const [editing, setEditing] = useState(false)
  // Esc 取消后输入框卸载可能触发 blur → commit，用该标记让取消后的提交失效（避免误写回旧草稿）。
  const cancelledRef = useRef(false)

  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
  })

  const startEdit = useCallback(() => {
    cancelledRef.current = false
    setEditing(true)
  }, [])

  const commit = useCallback(
    (draft: string) => {
      if (cancelledRef.current) return
      setEditing(false)
      data?.onUpdateLabel(id, draft)
    },
    [data, id],
  )

  const cancel = useCallback(() => {
    cancelledRef.current = true
    setEditing(false)
  }, [])

  return (
    <g onDoubleClick={startEdit}>
      <BaseEdge id={id} path={edgePath} markerEnd={markerEnd} />
      {editing ? (
        <EdgeLabelRenderer>
          <EdgeLabelEditor initial={String(label ?? '')} x={labelX} y={labelY} onCommit={commit} onCancel={cancel} />
        </EdgeLabelRenderer>
      ) : label ? (
        <EdgeLabelRenderer>
          {/* 标签胶囊：pointer-events 继承 EdgeLabelRenderer 的 none，点击/双击穿透到连线本身，
              由 <g> 的 onDoubleClick 统一进入编辑（避免覆盖在连线上方挡住边的选中与删除）。 */}
          <div
            className="mm-edge-label"
            style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}
          >
            {String(label)}
          </div>
        </EdgeLabelRenderer>
      ) : null}
    </g>
  )
}
