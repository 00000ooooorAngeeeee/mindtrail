// 导图编辑器（07 §4 树状 + §5 画布双模式）：React Flow 渲染 + 自研树布局。
// 树状：点选节点、双击编辑、拖拽改层级（悬停高亮）、折叠/展开、缩放/平移、双击空白加节点、快捷键。
// 画布（M2 任务一）：自由拖拽（layout 持久化）、自由连线（type=free，可删除）、树→画布平铺、画布→树严格树判定 + 三选一。
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Background,
  BackgroundVariant,
  Controls,
  MarkerType,
  MiniMap,
  ReactFlow,
  useEdgesState,
  useNodesState,
  useUpdateNodeInternals,
  type Connection,
  type Edge,
  type Node,
  type ReactFlowInstance,
  type XYPosition,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { exportMindmap, type MindmapExportType } from '../../api/mindmaps'
import { getMindmapLinks } from '../../api/linkage'
import { useMindmapStore } from '../../store/useMindmapStore'
import type { MindmapMode } from '../../store/useMindmapStore'
import { downloadBase64File, downloadTextFile } from '../../utils/download'
import { descendants } from './content'
import type { MindmapContent } from './content'
import { computeTreeLayout, type LayoutPoint } from './treeLayout'
import { contentExceedsViewport } from './fitCheck'
import { MindmapNode, type MindmapRFNode } from './MindmapNode'
import { FreeEdge, type FreeEdgeData } from './FreeEdge'
import { NODE_COLORS, NODE_SHAPES } from './nodeStyle'
import { NodeEntryLinkDialog } from '../linkage/NodeEntryLinkDialog'
import { NodeLinksPopover } from '../linkage/NodeLinksPopover'
import type { LinkedEntry } from '../../api/types'
import '../linkage/linkage.css'
import './mindmap.css'

// 节点估宽/高（用于拖拽落点中心判定；节点宽随文本变化，估算足够命中）。
const NODE_W = 160
const NODE_H = 44
// 判定「拖到某节点上」的最大中心距离。
const DROP_RADIUS = 120

const nodeTypes = { mindmap: MindmapNode }

// 自由连线自定义边（PRD B2.2 P1「可编辑标签」）：标签胶囊渲染 + 双击编辑。
const edgeTypes = { free: FreeEdge }

/**
 * 节点（重）建后显式触发 XYFlow 测量（M2 总验收 GUI 实测修复）。
 * 本应用的节点/手柄是异步重建的（内容加载、增删改、模式切换），XYFlow 的 ResizeObserver 自动测量
 * 在这些场景下不触发——未测量的节点保持 visibility:hidden（画布不可见）且 handleBounds 缺失（自由连线
 * 无法完成）。必须放在 <ReactFlow> 子树内：useUpdateNodeInternals 依赖 ReactFlow 内部 store 上下文，
 * 放在外面拿到的是外层 Provider 的空 store（本应用没有 Provider），调用会静默空转。
 * 进入导图的 fitView 由 ReactFlow 的 fitView prop 承担：其 fitViewQueued 会在本组件触发的
 * updateNodeInternals 测量完成时解析（React Flow 内部路径），不依赖 s.nodesInitialized
 * （该值只在 setNodes 时重算，首开导图仅一次 setNodes 时永远为 false——此前二次打开才生效的根因）。
 */
function NodeMeasureTrigger({ content }: { content: MindmapContent | null }) {
  const updateNodeInternals = useUpdateNodeInternals()
  useEffect(() => {
    if (!content) return
    const ids = Object.keys(content.nodes)
    const timer = setTimeout(() => updateNodeInternals(ids), 30)
    return () => clearTimeout(timer)
  }, [content, updateNodeInternals])
  return null
}

function buildNodes(
  content: MindmapContent,
  positions: Map<string, LayoutPoint>,
  childCount: Map<string, number>,
  selectedIds: string[],
  mode: MindmapMode,
  flashId: string | null,
  linkage: {
    mindmapId: number
    links: Record<string, number[]>
    onShowNodeLinks: (nodeId: string) => void
    onManageLinks: (nodeId: string) => void
  },
): MindmapRFNode[] {
  const out: MindmapRFNode[] = []
  for (const [id, pos] of positions) {
    const n = content.nodes[id]
    if (!n) continue
    out.push({
      id,
      type: 'mindmap',
      position: pos,
      selected: selectedIds.includes(id),
      // 节点删除走 store + window 键处理（带确认），禁用 React Flow 内建删除避免双删（PRD B2.6 批量删除）。
      deletable: false,
      data: {
        text: n.text,
        style: n.style,
        sticky: n.sticky,
        isRoot: id === content.rootNodeId,
        hasChildren: (childCount.get(id) ?? 0) > 0,
        childCount: childCount.get(id) ?? 0,
        collapsed: n.collapsed,
        // 画布模式：渲染连接手柄；position 供工具栏「加子节点」在节点旁落点。
        connectable: mode === 'canvas',
        position: pos,
        // 搜索跳转定位（PRD D2）：目标节点闪烁提示。
        flash: id === flashId,
        // 联动（v1.1 P1）：挂接徽标/详情弹层/管理对话框。
        mindmapId: linkage.mindmapId,
        linkCount: linkage.links[id]?.length ?? 0,
        onShowNodeLinks: linkage.onShowNodeLinks,
        onManageLinks: linkage.onManageLinks,
      },
    })
  }
  return out
}

function buildEdges(
  content: MindmapContent,
  positions: Map<string, LayoutPoint>,
  mode: MindmapMode,
  onUpdateEdgeLabel: FreeEdgeData['onUpdateLabel'],
  selectedEdgeIds: Set<string> = new Set(),
): Edge[] {
  const out: Edge[] = []
  // 父链边（由 parentId 派生，05 §4 语义）：树模式主结构；画布模式保留展示但不可删除。
  for (const n of Object.values(content.nodes)) {
    if (!n.parentId || !positions.has(n.id) || !positions.has(n.parentId)) continue
    out.push({
      id: `pc:${n.id}`,
      source: n.parentId,
      target: n.id,
      type: 'smoothstep',
      deletable: false,
      selectable: mode === 'tree',
      style: { stroke: 'var(--edge, #c3c8d4)', strokeWidth: 1.5 },
    })
  }
  // 自由连线（type=free，PRD B2.2）：仅画布模式渲染，树视图忽略（PRD B3.3）。
  // 标签（PRD B2.2 P1「可编辑标签」）：自定义边 FreeEdge 渲染中点胶囊，双击编辑走 store。
  if (mode === 'canvas') {
    for (const e of content.edges) {
      if (!positions.has(e.source) || !positions.has(e.target)) continue
      out.push({
        id: e.id,
        source: e.source,
        target: e.target,
        type: 'free',
        deletable: true,
        // 保留当前选中态：点击选中边会联动取消节点选中 → selectedIds 变化触发本 effect 重建，
        // 若不带入 selected 标记会把刚选中的边立即「洗掉」，导致按 Delete 无法断开连线（人工验收反馈）。
        selected: selectedEdgeIds.has(e.id),
        // 颜色走 CSS 类（mm-free-edge）：内联 style 会压掉选中态变色，选中无高亮反馈（人工验收反馈）。
        className: 'mm-free-edge',
        markerEnd: { type: MarkerType.ArrowClosed, width: 18, height: 18 },
        label: e.label ?? undefined,
        data: { onUpdateLabel: onUpdateEdgeLabel },
      })
    }
  }
  return out
}

/** 计算拖拽落点：返回距离拖拽中心最近且在阈值内的目标节点 id（排除自身及其后代），无则 null。 */
function findDropTarget(
  draggedId: string,
  draggedPos: XYPosition,
  positions: Map<string, LayoutPoint>,
  exclude: Set<string>,
): string | null {
  const cx = draggedPos.x + NODE_W / 2
  const cy = draggedPos.y + NODE_H / 2
  let best: string | null = null
  let bestDist = DROP_RADIUS
  for (const [id, p] of positions) {
    if (id === draggedId || exclude.has(id)) continue
    const d = Math.hypot(p.x + NODE_W / 2 - cx, p.y + NODE_H / 2 - cy)
    if (d < bestDist) {
      bestDist = d
      best = id
    }
  }
  return best
}

export function MindMapEditor({
  mindmapId,
  onBack,
  highlightNodeId = null,
  onOpenEntry,
}: {
  mindmapId: number
  onBack: () => void
  /** 搜索跳转定位（PRD D2）：加载后选中该节点并闪烁。 */
  highlightNodeId?: string | null
  /** 联动（v1.1 P1）：挂接详情弹层点击条目 → 跳转会话时间线定位该条目（复用 D2 跳转机制）。 */
  onOpenEntry?: (sessionId: number, entryId: number, seq: number) => void
}) {
  const load = useMindmapStore((s) => s.load)
  const select = useMindmapStore((s) => s.select)
  const setSelectedIds = useMindmapStore((s) => s.setSelectedIds)
  const addChild = useMindmapStore((s) => s.addChild)
  const addStickyNote = useMindmapStore((s) => s.addStickyNote)
  const updateStyles = useMindmapStore((s) => s.updateStyles)
  const deleteNodes = useMindmapStore((s) => s.deleteNodes)
  const moveNode = useMindmapStore((s) => s.moveNode)
  const moveNodesLayout = useMindmapStore((s) => s.moveNodesLayout)
  const addFreeEdge = useMindmapStore((s) => s.addFreeEdge)
  const removeFreeEdge = useMindmapStore((s) => s.removeFreeEdge)
  const updateEdgeLabel = useMindmapStore((s) => s.updateEdgeLabel)
  const switchMode = useMindmapStore((s) => s.switchMode)
  const forceTreeMode = useMindmapStore((s) => s.forceTreeMode)
  const ignoreFreeEdgesToTree = useMindmapStore((s) => s.ignoreFreeEdgesToTree)
  const save = useMindmapStore((s) => s.save)
  const undo = useMindmapStore((s) => s.undo)
  const redo = useMindmapStore((s) => s.redo)
  const clearError = useMindmapStore((s) => s.clearError)

  const mindmap = useMindmapStore((s) => s.mindmap)
  const content = useMindmapStore((s) => s.content)
  const history = useMindmapStore((s) => s.history)
  const selectedIds = useMindmapStore((s) => s.selectedIds)
  const mode = useMindmapStore((s) => s.mode)
  const loading = useMindmapStore((s) => s.loading)
  const error = useMindmapStore((s) => s.error)
  const saving = useMindmapStore((s) => s.saving)
  const dirty = useMindmapStore((s) => s.dirty)

  const [nodes, setNodes, onNodesChange] = useNodesState<MindmapRFNode>([])
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([])
  const [zoom, setZoom] = useState(1)
  // 画布→树遇非树边时的三选一对话框（07 §5）。
  const [dialogOpen, setDialogOpen] = useState(false)
  // 搜索跳转定位（PRD D2）：闪烁中的节点 id，闪烁结束清空。
  const [flashId, setFlashId] = useState<string | null>(null)
  // 导出（PRD B5，M4 任务三）：当前导图 → PNG/OPML；导出前若有未保存修改先保存，保证产物与画布一致。
  const [exporting, setExporting] = useState<MindmapExportType | null>(null)
  const [exportError, setExportError] = useState<string | null>(null)
  const dragging = useRef(false)
  const dropTargetRef = useRef<string | null>(null)
  const rfRef = useRef<ReactFlowInstance<MindmapRFNode, Edge> | null>(null)
  // 自适应缩放（v1.1 P1）：内容变化后的防抖检查定时器 + 画布容器 ref
  const autoFitTimerRef = useRef<number | null>(null)
  const mmCanvasRef = useRef<HTMLDivElement | null>(null)

  // 联动（v1.1 P1）：导图挂接图（nodeId → [entryId]）、挂接详情弹层、挂接管理对话框
  const [links, setLinks] = useState<Record<string, number[]>>({})
  const [linksPopover, setLinksPopover] = useState<{ nodeId: string; x: number; y: number } | null>(null)
  const [linkDialogNode, setLinkDialogNode] = useState<string | null>(null)

  const refreshLinks = useCallback(async () => {
    try {
      setLinks(await getMindmapLinks(mindmapId))
    } catch {
      setLinks({}) // 挂接图加载失败不阻塞画布（徽标暂时不展示）
    }
  }, [mindmapId])

  useEffect(() => {
    void refreshLinks()
  }, [refreshLinks])

  useEffect(() => {
    void load(mindmapId)
  }, [mindmapId, load])

  const positions = useMemo(() => {
    if (!content) return new Map<string, LayoutPoint>()
    // 画布模式折叠忽略（05 §4），树布局作为未摆放节点的回退坐标。
    const tree = computeTreeLayout(content, mode === 'canvas')
    if (mode === 'tree') return tree
    const m = new Map<string, LayoutPoint>()
    for (const [id, n] of Object.entries(content.nodes)) {
      m.set(id, n.layout ?? tree.get(id) ?? { x: 0, y: 0 })
    }
    return m
  }, [content, mode])

  // 搜索跳转定位：内容就绪后选中目标节点、居中视口并闪烁 2s（PRD D2「跳转后目标高亮闪烁」）。
  // highlightedRef 保证同一目标节点只处理一次（内容/坐标变化不重复触发）。
  const highlightedRef = useRef<string | null>(null)
  useEffect(() => {
    if (!highlightNodeId || !content || !content.nodes[highlightNodeId]) return
    if (highlightedRef.current === highlightNodeId) return
    highlightedRef.current = highlightNodeId
    select(highlightNodeId)
    setFlashId(highlightNodeId)
    const pos = positions.get(highlightNodeId)
    if (pos) {
      rfRef.current?.setCenter(pos.x + NODE_W / 2, pos.y + NODE_H / 2, { zoom: 1, duration: 300 })
    }
    const timer = setTimeout(() => setFlashId(null), 2000)
    return () => clearTimeout(timer)
  }, [content, positions, highlightNodeId, select])

  const childCount = useMemo(() => {
    const m = new Map<string, number>()
    if (!content) return m
    for (const n of Object.values(content.nodes)) {
      if (n.parentId) m.set(n.parentId, (m.get(n.parentId) ?? 0) + 1)
    }
    return m
  }, [content])

  // 联动：点 📎 徽标 → 在节点旁弹出挂接详情（flowToScreenPosition 换算屏幕锚点；画布平移/缩放时关闭）
  const openNodeLinks = useCallback(
    (nodeId: string) => {
      const pos = positions.get(nodeId)
      if (!pos || !rfRef.current) return
      const screen = rfRef.current.flowToScreenPosition({ x: pos.x + 100, y: pos.y + 22 })
      setLinksPopover({ nodeId, x: Math.round(screen.x), y: Math.round(screen.y) })
    },
    [positions],
  )

  const openLinkDialog = useCallback((nodeId: string) => {
    setLinksPopover(null)
    setLinkDialogNode(nodeId)
  }, [])

  /**
   * 自适应缩放（v1.1 P1，PRD §5 P1）：内容变化后仅当节点包围盒超出视口（含边距）才自动 fitView，
   * 未超出保持用户视野（"不打扰"语义）。实时节点取 React Flow 实例（拖拽后闭包 nodes 滞后）。
   */
  const autoFitIfNeeded = useCallback(() => {
    const inst = rfRef.current
    const wrap = mmCanvasRef.current
    if (!inst || !wrap || wrap.clientWidth === 0) return
    const b = inst.getNodesBounds(inst.getNodes())
    if (
      contentExceedsViewport(
        { minX: b.x, minY: b.y, maxX: b.x + b.width, maxY: b.y + b.height },
        inst.getViewport(),
        wrap.clientWidth,
        wrap.clientHeight,
      )
    ) {
      void inst.fitView({ padding: 0.12, duration: 300 })
    }
  }, [])

  /** 双 rAF 等 React Flow 完成节点测量后执行自适应检查（与首帧 fitView 同款时序）。 */
  const scheduleAutoFit = useCallback(() => {
    if (autoFitTimerRef.current != null) {
      window.clearTimeout(autoFitTimerRef.current)
    }
    autoFitTimerRef.current = window.setTimeout(() => {
      requestAnimationFrame(() => requestAnimationFrame(() => autoFitIfNeeded()))
    }, 300)
  }, [autoFitIfNeeded])

  /** 适应视图（用户建议：进入导图直接执行按钮同款函数并平滑处理）：
   *  工具栏「适应视图」按钮、模式切换共用同一函数，
   *  duration 300 平滑动画（与 v1.1 自适应缩放同节奏）。
   *  注意：进入/切换导图的首次 fitView 不再由本组件手动触发——由 ReactFlow 的
   *  fitView prop（fitViewOptions）承担，测量完成即解析（见 NodeMeasureTrigger 注释）。 */
  const fitToView = useCallback(() => {
    void rfRef.current?.fitView({ padding: 0.2, duration: 300 })
  }, [])

  // 组件卸载清理自适应防抖定时器。
  useEffect(() => () => {
    if (autoFitTimerRef.current != null) window.clearTimeout(autoFitTimerRef.current)
  }, [])

  // 窗口/面板尺寸变化：缩小导致内容超出时自动适应（React Flow v12 无 onResize prop，走 window resize）。
  useEffect(() => {
    const onResize = () => scheduleAutoFit()
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [scheduleAutoFit])

  // 布局/内容变化时同步节点与边（拖拽中跳过，避免打断拖拽）。
  useEffect(() => {
    if (!content || dragging.current) return
    setNodes(
      buildNodes(content, positions, childCount, selectedIds, mode, flashId, {
        mindmapId,
        links,
        onShowNodeLinks: openNodeLinks,
        onManageLinks: openLinkDialog,
      }),
    )
    // 函数式更新保留当前边选中态：点击选中边会联动取消节点选中（selectedIds 变化触发本 effect），
    // 直接重建会把刚选中的边洗掉，导致「选中边按 Delete 断开」失效（人工验收反馈修复）。
    setEdges((current) =>
      buildEdges(
        content,
        positions,
        mode,
        updateEdgeLabel,
        new Set(current.filter((e) => e.selected).map((e) => e.id)),
      ),
    )
    // 自适应缩放（v1.1 P1）：内容/布局变化后，仅当超出视口才自动适应（防抖 300ms）。
    // 首次进入的 fitView 由 ReactFlow fitView prop 在节点测量完成时解析（fitViewQueued 机制），
    // 本处为其兜底：若测量链路异常导致未 fit，内容超出默认视口时 300ms 后仍会自动适应。
    scheduleAutoFit()
  }, [content, positions, childCount, selectedIds, mode, flashId, mindmapId, links, openNodeLinks, openLinkDialog, updateEdgeLabel, setNodes, setEdges, scheduleAutoFit])

  // 切换模式后坐标来源变化（平铺/重排），重新适应视图（平滑动画与「适应视图」按钮同款）。
  useEffect(() => {
    requestAnimationFrame(() => requestAnimationFrame(() => fitToView()))
  }, [mode, fitToView])

  const trySwitch = useCallback(
    (next: MindmapMode) => {
      const r = switchMode(next)
      if (r === 'non-tree') setDialogOpen(true)
    },
    [switchMode],
  )

  const onNodeDragStart = useCallback(() => {
    dragging.current = true
    dropTargetRef.current = null
  }, [])

  const onNodeDrag = useCallback(
    (_e: unknown, node: Node) => {
      if (!content || mode !== 'tree') return
      const target = findDropTarget(node.id, node.position, positions, descendants(content, node.id))
      if (target === dropTargetRef.current) return
      dropTargetRef.current = target
      setNodes((nds) => nds.map((n) => ({ ...n, data: { ...n.data, hover: n.id === target } })))
    },
    [content, mode, positions, setNodes],
  )

  const onNodeDragStop = useCallback(
    (_e: unknown, node: Node, nodes: Node[]) => {
      dragging.current = false
      if (mode === 'canvas') {
        // 画布：自由摆放，落点坐标写入 layout 持久化（PRD B2.1/B2.6 批量移动：多选拖一个带动全体）。
        const moved = nodes.filter((n) => selectedIds.includes(n.id))
        moveNodesLayout(moved.map((n) => ({ id: n.id, x: n.position.x, y: n.position.y })))
        // 自适应缩放：拖出视野后自动拉回（双 rAF 等节点测量完成）
        requestAnimationFrame(() => requestAnimationFrame(() => autoFitIfNeeded()))
        return
      }
      const target = dropTargetRef.current
      dropTargetRef.current = null
      const newParent = target ?? content?.rootNodeId
      if (newParent) moveNode(node.id, newParent)
    },
    [mode, content, moveNode, moveNodesLayout, selectedIds, autoFitIfNeeded],
  )

  const onConnect = useCallback(
    (conn: Connection) => {
      if (conn.source && conn.target) addFreeEdge(conn.source, conn.target)
    },
    [addFreeEdge],
  )

  // 画布模式删除自由连线（父链边 deletable=false 不会走到这里）。
  const onEdgesDelete = useCallback(
    (deleted: Edge[]) => {
      for (const e of deleted) removeFreeEdge(e.id)
    },
    [removeFreeEdge],
  )

  const addNodeShortcut = useCallback(() => {
    if (!content) return
    addChild(selectedIds[0] ?? content.rootNodeId)
  }, [content, selectedIds, addChild])

  const deleteSelected = useCallback(() => {
    if (!content || selectedIds.length === 0) return
    // 过滤根节点（不可删）；批量删除走 deleteNodes 并集去重（PRD B2.6）。
    const deletable = selectedIds.filter((id) => content.nodes[id]?.parentId !== null)
    if (deletable.length === 0) return
    const subtree = deletable.reduce((sum, id) => sum + descendants(content, id).size, 0)
    const msg =
      deletable.length > 1
        ? `删除 ${deletable.length} 个节点${subtree > 0 ? `及其 ${subtree} 个子节点` : ''}？`
        : subtree > 0
          ? `删除该节点及其 ${subtree} 个子节点？`
          : '删除该节点？'
    if (window.confirm(msg)) deleteNodes(deletable)
  }, [selectedIds, content, deleteNodes])

  // 自由便签（PRD B2.5）：在视口中心落一张无文本备注卡。
  const addSticky = useCallback(() => {
    if (!content || !rfRef.current) return
    const p = rfRef.current.screenToFlowPosition({ x: window.innerWidth / 2, y: window.innerHeight / 2 })
    addStickyNote({ x: Math.round(p.x), y: Math.round(p.y) })
  }, [content, addStickyNote])

  /** 导出当前导图：先保存未落库修改（避免导出旧数据），再调后端生成产物并下载。 */
  const handleExport = async (type: MindmapExportType) => {
    if (!mindmap || exporting) return
    if (useMindmapStore.getState().dirty) {
      await useMindmapStore.getState().save()
    }
    if (useMindmapStore.getState().dirty) {
      setExportError('导图尚未保存成功，无法导出')
      return
    }
    setExporting(type)
    setExportError(null)
    try {
      const file = await exportMindmap(mindmap.id, type)
      if (type === 'PNG') {
        downloadBase64File(file.filename, file.content, file.contentType)
      } else {
        downloadTextFile(file.filename, file.content, file.contentType)
      }
    } catch (e) {
      setExportError(e instanceof Error ? e.message : '导出失败')
    } finally {
      setExporting(null)
    }
  }

  // 快捷键（08 §4.3 / 03 §5）：Ctrl+N 加节点、Delete 删除、Ctrl+S 保存、Ctrl+Z 撤销、Ctrl+Shift+Z/Ctrl+Y 重做、Ctrl+1/2 切换模式。
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'TEXTAREA' || t.tagName === 'INPUT')) return
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault()
        void save()
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        if (e.shiftKey) redo()
        else undo()
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
        e.preventDefault()
        redo()
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'n') {
        e.preventDefault()
        addNodeShortcut()
      } else if ((e.ctrlKey || e.metaKey) && e.key === '1') {
        e.preventDefault()
        trySwitch('tree')
      } else if ((e.ctrlKey || e.metaKey) && e.key === '2') {
        e.preventDefault()
        trySwitch('canvas')
      } else if (e.key === 'Delete') {
        // 人工验收反馈修复：原逻辑只要有选中节点就接管 Delete（带确认删节点），导致选中连线后
        // 按 Delete 无法断开连线（节点仍处选中态时被劫持去删节点）。现仅在「有选中节点且未选中
        // 自由边」时接管；选中边时放行给 React Flow 的删除链路（useKeyPress 监听 document）。
        const hasEdgeSelected = edges.some((ed) => ed.selected)
        if (selectedIds.length > 0 && !hasEdgeSelected) {
          e.preventDefault()
          deleteSelected()
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [save, undo, redo, addNodeShortcut, deleteSelected, selectedIds, trySwitch, edges])

  const nodeCount = content ? Object.keys(content.nodes).length : 0
  // 样式面板以「首个选中节点」样式为基准，操作批量应用到全部选中（PRD B2.6 批量设色）。
  const selectedNode = content && selectedIds.length > 0 ? (content.nodes[selectedIds[0]] ?? null) : null

  return (
    <div className="mm-editor">
      <div className="mm-toolbar">
        <button onClick={onBack}>← 返回</button>
        <span className="mm-title">{mindmap?.name ?? '加载中…'}</span>
        <div className="mm-mode-switch" role="group" aria-label="视图模式">
          <button className={mode === 'tree' ? 'active' : ''} onClick={() => trySwitch('tree')} title="树状模式 (Ctrl+1)">
            树状
          </button>
          <button
            className={mode === 'canvas' ? 'active' : ''}
            onClick={() => trySwitch('canvas')}
            title="画布模式 (Ctrl+2)"
          >
            画布
          </button>
        </div>
        <div className="mm-toolbar-actions">
          <button onClick={undo} disabled={history.past.length === 0} title="撤销 (Ctrl+Z)">
            ↶ 撤销
          </button>
          <button onClick={redo} disabled={history.future.length === 0} title="重做 (Ctrl+Shift+Z)">
            ↷ 重做
          </button>
          {mode === 'canvas' && (
            <button onClick={addSticky} title="自由便签（无文本备注卡，PRD B2.5）">
              ＋便签
            </button>
          )}
          <button onClick={() => void fitToView()}>适应视图</button>
          <button onClick={() => void save()} disabled={saving || !dirty}>
            {saving ? '保存中…' : dirty ? '保存*' : '已保存'}
          </button>
          <button onClick={() => void handleExport('PNG')} disabled={exporting != null} title="导出整图为 PNG">
            {exporting === 'PNG' ? 'PNG 导出中…' : '导出 PNG'}
          </button>
          <button onClick={() => void handleExport('OPML')} disabled={exporting != null} title="导出树状大纲为 OPML">
            {exporting === 'OPML' ? 'OPML 导出中…' : '导出 OPML'}
          </button>
        </div>
      </div>

      {selectedNode && (
        <div className="mm-style-panel" role="group" aria-label="节点样式">
          {selectedIds.length > 1 && <span className="mm-style-label">应用于 {selectedIds.length} 个节点</span>}
          <div className="mm-style-group">
            <span className="mm-style-label">形状</span>
            {NODE_SHAPES.map((s) => (
              <button
                key={s.id}
                className={selectedNode.style.shape === s.id ? 'active' : ''}
                title={s.label}
                onClick={() => updateStyles(selectedIds, { shape: s.id })}
              >
                <span className={`mm-shape-icon shape-${s.id}`} />
              </button>
            ))}
          </div>
          <div className="mm-style-group">
            <span className="mm-style-label">颜色</span>
            {NODE_COLORS.map((c) => (
              <button
                key={c.id}
                className={`mm-color-swatch${selectedNode.style.color === c.id ? ' active' : ''}`}
                title={c.label}
                style={{ background: c.bg, borderColor: c.border }}
                onClick={() => updateStyles(selectedIds, { color: c.id })}
              />
            ))}
          </div>
          <div className="mm-style-group">
            <button
              className={selectedNode.style.bold ? 'active' : ''}
              title="加粗"
              onClick={() => updateStyles(selectedIds, { bold: !selectedNode.style.bold })}
            >
              <strong>B</strong>
            </button>
          </div>
        </div>
      )}

      {(error || exportError) && content && (
        <div className="mm-toast" role="alert">
          <span>{error ?? exportError}</span>
          <button
            onClick={() => {
              clearError()
              setExportError(null)
            }}
            title="关闭"
          >
            ×
          </button>
        </div>
      )}

      {dialogOpen && (
        <div className="mm-dialog-mask">
          <div className="mm-dialog" role="alertdialog" aria-label="非树连线处理">
            <p className="mm-dialog-title">切回树状模式</p>
            <p>存在非树连线（自由连线会形成环或多父），树状视图将忽略它们。如何处理？</p>
            <div className="mm-dialog-actions">
              <button
                onClick={() => {
                  ignoreFreeEdgesToTree()
                  setDialogOpen(false)
                }}
              >
                忽略非树边
              </button>
              <button onClick={() => setDialogOpen(false)}>保持画布</button>
              <button
                onClick={() => {
                  forceTreeMode()
                  setDialogOpen(false)
                }}
              >
                仅重排树形部分
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 联动（v1.1 P1）：节点挂接详情弹层 + 挂接管理对话框 */}
      {linksPopover && content?.nodes[linksPopover.nodeId] && (
        <NodeLinksPopover
          mindmapId={mindmapId}
          nodeId={linksPopover.nodeId}
          nodeText={content.nodes[linksPopover.nodeId].text}
          x={linksPopover.x}
          y={linksPopover.y}
          onClose={() => setLinksPopover(null)}
          onOpenEntry={(entry: LinkedEntry) => onOpenEntry?.(entry.sessionId, entry.entryId, entry.seq)}
          onManage={() => openLinkDialog(linksPopover.nodeId)}
        />
      )}

      {linkDialogNode && content?.nodes[linkDialogNode] && mindmap?.workspaceId != null && (
        <NodeEntryLinkDialog
          mindmapId={mindmapId}
          nodeId={linkDialogNode}
          workspaceId={mindmap.workspaceId}
          initialEntryIds={links[linkDialogNode] ?? []}
          onClose={() => setLinkDialogNode(null)}
          onSaved={() => void refreshLinks()}
        />
      )}

      {loading && !content ? (
        <div className="mm-center muted">加载中…</div>
      ) : error && !content ? (
        <div className="mm-center error" role="alert">
          {error}
        </div>
      ) : (
        <div className="mm-canvas" ref={mmCanvasRef}>
          <ReactFlow<MindmapRFNode, Edge>
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onSelectionChange={(p) => setSelectedIds(p.nodes.map((n) => n.id))}
            selectionOnDrag={mode === 'canvas'}
            panOnDrag={mode === 'canvas' ? [1, 2] : true}
            deleteKeyCode={['Backspace', 'Delete']}
            onPaneClick={(e) => {
              if (e.detail === 2) {
                // 双击空白加节点（03 §4）：画布模式落在点击处。
                if (mode === 'canvas' && rfRef.current) {
                  const p = rfRef.current.screenToFlowPosition({ x: e.clientX, y: e.clientY })
                  if (content) addChild(selectedIds[0] ?? content.rootNodeId, { x: Math.round(p.x), y: Math.round(p.y) })
                } else {
                  addNodeShortcut()
                }
              } else {
                select(null)
              }
            }}
            onNodeDragStart={onNodeDragStart}
            onNodeDrag={onNodeDrag}
            onNodeDragStop={onNodeDragStop}
            onConnect={onConnect}
            onEdgesDelete={onEdgesDelete}
            onMove={(_, viewport) => {
              setZoom(viewport.zoom)
              setLinksPopover(null) // 画布平移/缩放时关闭挂接弹层（锚点随之失效）
            }}
            nodesConnectable={mode === 'canvas'}
            nodesFocusable={false}
            fitView
            fitViewOptions={{ padding: 0.2, duration: 300 }}
            minZoom={0.2}
            maxZoom={2.5}
            proOptions={{ hideAttribution: true }}
            onInit={(inst) => {
              rfRef.current = inst
            }}
          >
            <Background variant={BackgroundVariant.Dots} gap={24} size={1} />
            <Controls showInteractive={false} />
            <MiniMap pannable zoomable />
            <NodeMeasureTrigger content={content} />
          </ReactFlow>
        </div>
      )}

      <div className="mm-statusbar">
        <span>{nodeCount} 节点</span>
        <span>{mode === 'tree' ? '树状模式' : '画布模式'}</span>
        <span>{Math.round(zoom * 100)}%</span>
        <span className="muted">
          {mode === 'tree'
            ? '双击节点编辑 · 拖拽改层级 · 双击空白加节点'
            : '拖拽摆放 · 拖框/Shift 点选多选 · 从节点边缘拖出连线 · 双击连线编辑标签 · 选中边按 Delete 删除'}
        </span>
      </div>
    </div>
  )
}
