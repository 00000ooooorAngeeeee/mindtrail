import { describe, expect, it } from 'vitest'
import { computeFitViewport, contentExceedsViewport, nodesReadyForFit } from './fitCheck'

describe('自适应缩放判定（v1.1 P1）', () => {
  // 视口 1000×600、zoom=1、viewport {x:0,y:0} → 可见区 left=0 top=0 w=1000 h=600；pad=80/48
  const vp = { x: 0, y: 0, zoom: 1 }

  it('内容完全在视口内：不触发适应', () => {
    expect(
      contentExceedsViewport({ minX: 100, minY: 100, maxX: 900, maxY: 500 }, vp, 1000, 600),
    ).toBe(false)
  })

  it('内容在边距内：不触发适应（不打扰正常编辑视野）', () => {
    expect(
      contentExceedsViewport({ minX: -70, minY: -40, maxX: 1070, maxY: 640 }, vp, 1000, 600),
    ).toBe(false) // -70 > -80、1070 < 1080
  })

  it('右侧超出边距：触发适应', () => {
    expect(
      contentExceedsViewport({ minX: -70, minY: -40, maxX: 1100, maxY: 640 }, vp, 1000, 600),
    ).toBe(true) // 1100 > 1080
  })

  it('下侧超出边距：触发适应', () => {
    expect(
      contentExceedsViewport({ minX: -70, minY: -40, maxX: 1070, maxY: 700 }, vp, 1000, 600),
    ).toBe(true) // 700 > 648
  })

  it('左侧/上侧超出边距：触发适应', () => {
    expect(
      contentExceedsViewport({ minX: -200, minY: -40, maxX: 900, maxY: 500 }, vp, 1000, 600),
    ).toBe(true)
    expect(
      contentExceedsViewport({ minX: -70, minY: -300, maxX: 900, maxY: 500 }, vp, 1000, 600),
    ).toBe(true)
  })

  it('缩小视图（zoom<1）时可见区按 zoom 放大：原内容不触发', () => {
    // zoom=0.5 → 可见区 w=2000 h=1200，内容 100..900 完全在内
    expect(
      contentExceedsViewport({ minX: 100, minY: 100, maxX: 900, maxY: 500 }, { x: 0, y: 0, zoom: 0.5 }, 1000, 600),
    ).toBe(false)
  })

  it('平移后可见区偏移：超出判定随 viewport 变化', () => {
    // viewport.x=300 → 可见区 left=-300 right=700（pad 后 -380..780），内容 0..600 完全可见
    expect(
      contentExceedsViewport({ minX: 0, minY: 100, maxX: 600, maxY: 500 }, { x: 300, y: 0, zoom: 1 }, 1000, 600),
    ).toBe(false)
    // 同视口下内容延展到 900：超过可见区右侧 → 触发
    expect(
      contentExceedsViewport({ minX: 0, minY: 100, maxX: 900, maxY: 500 }, { x: 300, y: 0, zoom: 1 }, 1000, 600),
    ).toBe(true)
    // viewport.x=-1500 → 可见区 left=1500，内容整体在视野外
    expect(
      contentExceedsViewport({ minX: 100, minY: 100, maxX: 900, maxY: 500 }, { x: -1500, y: 0, zoom: 1 }, 1000, 600),
    ).toBe(true)
  })

  it('zoom 为 0 或负数时按 1 兜底（防御）', () => {
    expect(
      contentExceedsViewport({ minX: 100, minY: 100, maxX: 900, maxY: 500 }, { x: 0, y: 0, zoom: 0 }, 1000, 600),
    ).toBe(false)
  })

  it('自定义边距比例生效', () => {
    // padRatio=0.2 → 右侧边距 200：1070 不触发（<1200）
    expect(
      contentExceedsViewport({ minX: -70, minY: -40, maxX: 1070, maxY: 640 }, vp, 1000, 600, 0.2),
    ).toBe(false)
    // padRatio=0.05 → 右侧边距 50：1070 触发（>1050）
    expect(
      contentExceedsViewport({ minX: -70, minY: -40, maxX: 1070, maxY: 640 }, vp, 1000, 600, 0.05),
    ).toBe(true)
  })
})

describe('computeFitViewport（首开适应兜底，确定性由坐标计算）', () => {
  // 节点估宽 160 / 估高 44（与画布 NODE_W/NODE_H 一致），视口 1000×600，padding 0.2，zoom ∈ [0.2, 2.5]
  const W = 160
  const H = 44
  const vp = { w: 1000, h: 600, pad: 0.2, min: 0.2, max: 2.5 }

  it('空坐标或零视口返回 null', () => {
    expect(computeFitViewport([], 1000, 600, W, H, 0.2, 0.2, 2.5)).toBeNull()
    expect(computeFitViewport([{ x: 0, y: 0 }], 0, 600, W, H, 0.2, 0.2, 2.5)).toBeNull()
    expect(computeFitViewport([{ x: 0, y: 0 }], 1000, 0, W, H, 0.2, 0.2, 2.5)).toBeNull()
  })

  it('单个小节点：zoom 上限 2.5，内容居中', () => {
    const r = computeFitViewport([{ x: 0, y: 0 }], vp.w, vp.h, W, H, vp.pad, vp.min, vp.max)
    expect(r).not.toBeNull()
    // 内容中心 (80,22) 落在视口中心 (500,300)：x + 80*zoom = 500、y + 22*zoom = 300
    expect(r!.zoom).toBe(2.5)
    expect(r!.x + 80 * r!.zoom).toBeCloseTo(500, 5)
    expect(r!.y + 22 * r!.zoom).toBeCloseTo(300, 5)
  })

  it('宽内容：zoom < 1 且居中', () => {
    // 两节点 0..1840 → 包围盒宽 2000（含节点宽）
    const r = computeFitViewport(
      [
        { x: 0, y: 0 },
        { x: 1840, y: 0 },
      ],
      vp.w,
      vp.h,
      W,
      H,
      vp.pad,
      vp.min,
      vp.max,
    )
    expect(r).not.toBeNull()
    expect(r!.zoom).toBeGreaterThan(vp.min)
    expect(r!.zoom).toBeLessThan(1)
    // 内容中心 cx=1000 落在视口中心 500：x + 1000*zoom = 500
    expect(r!.x + 1000 * r!.zoom).toBeCloseTo(500, 5)
  })

  it('超大内容：zoom 钳到下限 0.2', () => {
    const r = computeFitViewport(
      [
        { x: 0, y: 0 },
        { x: 100000, y: 0 },
      ],
      vp.w,
      vp.h,
      W,
      H,
      vp.pad,
      vp.min,
      vp.max,
    )
    expect(r).not.toBeNull()
    expect(r!.zoom).toBe(vp.min)
  })

  it('padding 越大 zoom 越小（边距越多）', () => {
    // 包围盒宽 800（640 + 节点宽 160）
    const pos = [
      { x: 0, y: 0 },
      { x: 640, y: 0 },
    ]
    const a = computeFitViewport(pos, vp.w, vp.h, W, H, 0.2, vp.min, vp.max)
    const b = computeFitViewport(pos, vp.w, vp.h, W, H, 0.4, vp.min, vp.max)
    expect(a!.zoom).toBeCloseTo(0.75, 5) // availW=600 / 800
    expect(b!.zoom).toBeCloseTo(0.25, 5) // availW=200 / 800
    expect(b!.zoom).toBeLessThan(a!.zoom)
  })

  it('负坐标内容仍正确居中（导图常以负坐标分布）', () => {
    // 单节点 x=-800、宽 160 → 包围盒 -800..-640，中心 cx=-720；zoom 钳到上限 2.5
    const r = computeFitViewport([{ x: -800, y: 0 }], vp.w, vp.h, W, H, vp.pad, vp.min, vp.max)
    expect(r).not.toBeNull()
    expect(r!.zoom).toBe(2.5)
    expect(r!.x + -720 * r!.zoom).toBeCloseTo(500, 5)
  })
})

describe('fit 前就绪判定 nodesReadyForFit（07 §25 切换导图 fit 竞态）', () => {
  const mk = (id: string, w = 100, h = 44) => ({ id, measured: { width: w, height: h } })
  const positions = new Map<string, unknown>([
    ['a', {}],
    ['b', {}],
    ['c', {}],
  ])

  it('store 节点恰好为本图全部且宽高齐：就绪', () => {
    expect(nodesReadyForFit([mk('a'), mk('b'), mk('c')], positions)).toBe(true)
  })

  it('store 为空：未就绪', () => {
    expect(nodesReadyForFit([], positions)).toBe(false)
  })

  it('切图后 store 残留上一图节点（数量不等）：未就绪', () => {
    expect(nodesReadyForFit([mk('a'), mk('b')], positions)).toBe(false)
  })

  it('数量相等但 id 不属于本图（两张同节点数导图切换）：未就绪', () => {
    expect(nodesReadyForFit([mk('x'), mk('y'), mk('z')], positions)).toBe(false)
  })

  it('宽度已测、高度缺失（包围盒纵向残缺）：未就绪', () => {
    const partial = [mk('a'), mk('b'), { id: 'c', measured: { width: 100 } }]
    expect(nodesReadyForFit(partial, positions)).toBe(false)
  })

  it('部分节点未测量：未就绪', () => {
    const partial = [mk('a'), mk('b'), { id: 'c' }]
    expect(nodesReadyForFit(partial, positions)).toBe(false)
  })
})
