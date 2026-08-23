/**
 * 自适应缩放判定纯函数（v1.1 P1，PRD §5 P1「自适应缩放」）：
 * 内容变化后（增删/折叠/拖拽/窗口缩放）仅当节点包围盒超出视口（含边距）时才需要自动适应视图，
 * 未超出保持用户当前视野——避免每次编辑都打断视图（"不打扰"语义）。
 */

/** React Flow viewport（flow 坐标：x/y 为视口左上角在 flow 坐标中的负偏移，zoom 为缩放）。 */
export interface FlowViewport {
  x: number
  y: number
  zoom: number
}

/** 节点包围盒（flow 坐标）。 */
export interface ContentBounds {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

/**
 * 内容是否超出视口可见区：
 * 可见区（flow 坐标）= { left: -x/zoom, top: -y/zoom, w: 视口宽/zoom, h: 视口高/zoom }；
 * 任一边超出可见区 ± padRatio×对应边距即返回 true。
 */
export function contentExceedsViewport(
  bounds: ContentBounds,
  viewport: FlowViewport,
  viewportWidth: number,
  viewportHeight: number,
  padRatio = 0.08,
): boolean {
  const zoom = viewport.zoom > 0 ? viewport.zoom : 1
  const left = -viewport.x / zoom
  const top = -viewport.y / zoom
  const w = viewportWidth / zoom
  const h = viewportHeight / zoom
  const padX = w * padRatio
  const padY = h * padRatio
  return (
    bounds.minX < left - padX ||
    bounds.maxX > left + w + padX ||
    bounds.minY < top - padY ||
    bounds.maxY > top + h + padY
  )
}

/** 节点坐标点（flow 坐标，节点左上角）。 */
export interface NodePoint {
  x: number
  y: number
}

/**
 * 由节点坐标 + 节点尺寸确定性计算「适应视口」（首开导图自动适应的兜底）。
 *
 * 不依赖 React Flow 测量时序：包围盒 = 各节点 [x,y]~[x+nodeW,y+nodeH] 的并集，按 padding 在两侧
 * 缩进后居中，zoom = min(vpW/boundsW, vpH/boundsH) 并 clamp 到 [minZoom,maxZoom]。
 * 返回 React Flow viewport（x/y 为视口左上角在 flow 坐标中的负偏移）；positions 为空或视口为 0 返回 null。
 *
 * 用途：useNodesInitialized 理论上必翻转（节点 min-width≥72 保证非零尺寸必被 ResizeObserver 测量），
 * 但作为 defense-in-depth，若该信号未翻转（真实环境不应发生；jsdom 无真实布局则不翻转），
 * 仍能在固定时延后给出正确适应视口，根除「部分测量→残缺包围盒→错配需多次缩放」的时序竞态。
 */
export function computeFitViewport(
  positions: Array<NodePoint>,
  viewportWidth: number,
  viewportHeight: number,
  nodeWidth: number,
  nodeHeight: number,
  padding: number,
  minZoom: number,
  maxZoom: number,
): { x: number; y: number; zoom: number } | null {
  if (positions.length === 0 || viewportWidth <= 0 || viewportHeight <= 0) return null
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const p of positions) {
    if (p.x < minX) minX = p.x
    if (p.y < minY) minY = p.y
    if (p.x + nodeWidth > maxX) maxX = p.x + nodeWidth
    if (p.y + nodeHeight > maxY) maxY = p.y + nodeHeight
  }
  const boundsW = maxX - minX
  const boundsH = maxY - minY
  // 两侧各留 padding 比例的边距（保守，保证内容完全可见并居中）。
  const availW = viewportWidth - 2 * viewportWidth * padding
  const availH = viewportHeight - 2 * viewportHeight * padding
  let zoom: number
  if (boundsW <= 0 && boundsH <= 0) {
    zoom = maxZoom
  } else {
    zoom = Math.min(availW / boundsW, availH / boundsH)
    if (!Number.isFinite(zoom) || zoom <= 0) zoom = maxZoom
  }
  zoom = Math.min(Math.max(zoom, minZoom), maxZoom)
  const cx = minX + boundsW / 2
  const cy = minY + boundsH / 2
  return {
    x: viewportWidth / 2 - cx * zoom,
    y: viewportHeight / 2 - cy * zoom,
    zoom,
  }
}
