// 节点样式预设：形状与颜色色板（03 §6 视觉规范 / 05 §4 style.shape+color，PRD B2.4）。
// 颜色以「名称 → 浅底 + 描边」成对出现，浅底深描边保持「冷静不花哨」（03 §1 原则 4）。
// CSS 侧经 --node-bg/--node-border 变量消费（mindmap.css），色值单源在此维护。
import type { NodeShape } from './content'

export interface NodeColorOption {
  id: string
  label: string
  bg: string
  border: string
}

/** 预设色板；default 为白底灰边（现状），其余为浅色底 + 同系描边。 */
export const NODE_COLORS: NodeColorOption[] = [
  { id: 'default', label: '默认', bg: '#ffffff', border: '#d9dbe2' },
  { id: 'indigo', label: '靛蓝', bg: '#eef1ff', border: '#4f6bff' },
  { id: 'green', label: '绿', bg: '#eafaf1', border: '#2e9e5b' },
  { id: 'amber', label: '琥珀', bg: '#fff7e6', border: '#e0a100' },
  { id: 'red', label: '红', bg: '#fdecec', border: '#d64545' },
  { id: 'purple', label: '紫', bg: '#f3edff', border: '#7c4dff' },
  { id: 'cyan', label: '青', bg: '#e6f7fb', border: '#0aa0b8' },
  { id: 'pink', label: '粉', bg: '#fdeef5', border: '#e0558f' },
]

/** 按颜色名取色板，未知名回退默认（兼容旧数据/未知值）。 */
export function nodeColor(id: string | undefined): NodeColorOption {
  return NODE_COLORS.find((c) => c.id === id) ?? NODE_COLORS[0]
}

export interface NodeShapeOption {
  id: NodeShape
  label: string
}

export const NODE_SHAPES: NodeShapeOption[] = [
  { id: 'rounded', label: '圆角矩形' },
  { id: 'rect', label: '矩形' },
  { id: 'ellipse', label: '椭圆' },
  { id: 'diamond', label: '菱形' },
]
