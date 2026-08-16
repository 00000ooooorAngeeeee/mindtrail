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
